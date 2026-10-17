import {
  type GitHubLinkCode,
  type GitHubLinkPollResult,
  GitHubOperationError,
  type GitHubStatus,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../auth/server-secret-store.ts";

/** The public "Otto by Hello Gafaro" GitHub App; device flow needs only its client id. */
const CLIENT_ID = process.env.OTTO_GITHUB_CLIENT_ID?.trim() || "Iv23liPQaEONwVhkPCQs";

const APP_SLUG = process.env.OTTO_GITHUB_APP_SLUG?.trim() || "otto-by-hello-gafaro";

export const GITHUB_INSTALL_URL = `https://github.com/apps/${APP_SLUG}/installations/new`;

/** Refresh a little before GitHub's 8-hour expiry so a turn never starts with a dying token. */
const REFRESH_MARGIN_MS = 60 * 60 * 1_000;

const StoredAccount = Schema.Struct({
  githubId: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  accessToken: Schema.String,
  accessExpiresAt: Schema.NullOr(Schema.Number),
  refreshToken: Schema.NullOr(Schema.String),
  refreshExpiresAt: Schema.NullOr(Schema.Number),
});

type StoredAccount = typeof StoredAccount.Type;

const PendingLink = Schema.Struct({
  deviceCode: Schema.String,
  intervalSeconds: Schema.Number,
  expiresAt: Schema.Number,
  nextPollAt: Schema.Number,
});

type PendingLink = typeof PendingLink.Type;

const decodeAccount = Schema.decodeUnknownOption(Schema.fromJsonString(StoredAccount));

const decodePending = Schema.decodeUnknownOption(Schema.fromJsonString(PendingLink));

const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  refresh_token: Schema.optional(Schema.String),
  refresh_token_expires_in: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
});

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});

const UserResponse = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

/** The team's link, which bots use for anyone who has not linked their own. */
const TEAM_ACCOUNT_SECRET = "github-team";

const accountSecret = (personId: string, team = false) =>
  team ? TEAM_ACCOUNT_SECRET : `github-user-${personId}`;

const pendingSecret = (personId: string, team = false) =>
  `github-device-${team ? "team-" : ""}${personId}`;

const textEncoder = new TextEncoder();

const textDecoder = new TextDecoder();

/** What a bot's computer needs to act as one person on GitHub for a turn. */
export interface GitHubTurnLogin {
  readonly githubId: number;
  readonly login: string;
  readonly name: string | null;
  readonly accessToken: string;
}

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

const failure = (message: string) => new GitHubOperationError({ message });

export function make(
  secretStore: ServerSecretStore["Service"],
  fetchImpl: GitHubFetch = globalThis.fetch,
) {
  const request = <A>(
    schema: Schema.Codec<A>,
    url: string,
    init: {
      readonly method: "GET" | "POST";
      readonly body?: Record<string, string>;
      readonly token?: string;
    },
  ) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetchImpl(url, {
          method: init.method,
          headers: {
            Accept: "application/json",
            "User-Agent": "Otto",
            ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          },
          ...(init.body ? { body: new URLSearchParams(init.body).toString() } : {}),
        });

        if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);

        return response.json();
      },
      catch: () => failure("Could not reach GitHub. Try again."),
    }).pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError(() => failure("GitHub sent an unexpected answer.")),
        ),
      ),
    );

  const readSecret = <A>(name: string, decode: (text: string) => Option.Option<A>) =>
    secretStore.get(name).pipe(
      Effect.mapError(() => failure("Could not read your GitHub link.")),
      Effect.map(Option.flatMap((bytes) => decode(textDecoder.decode(bytes)))),
    );

  const writeSecret = (name: string, value: StoredAccount | PendingLink) =>
    secretStore
      .set(name, textEncoder.encode(JSON.stringify(value)))
      .pipe(Effect.mapError(() => failure("Could not save your GitHub link.")));

  const removeSecret = (name: string) =>
    secretStore
      .remove(name)
      .pipe(Effect.mapError(() => failure("Could not remove your GitHub link.")));

  const loginOf = (account: Option.Option<StoredAccount>) =>
    Option.match(account, { onNone: () => null, onSome: (value) => value.login });

  const readAccount = (personId: string, team = false) =>
    readSecret(accountSecret(personId, team), decodeAccount);

  const getStatus = (personId: string) =>
    Effect.all([readAccount(personId), readAccount(personId, true)]).pipe(
      Effect.map(
        ([own, shared]): GitHubStatus => ({
          login: loginOf(own),
          teamLogin: loginOf(shared),
          installUrl: GITHUB_INSTALL_URL,
        }),
      ),
    );

  const now = Effect.map(DateTime.now, DateTime.toEpochMillis);

  const tokenAccount = (
    token: typeof TokenResponse.Type & { readonly access_token: string },
    issuedAt: number,
  ) =>
    request(UserResponse, "https://api.github.com/user", {
      method: "GET",
      token: token.access_token,
    }).pipe(
      Effect.map(
        (user): StoredAccount => ({
          githubId: user.id,
          login: user.login,
          name: user.name?.trim() || null,
          accessToken: token.access_token,
          accessExpiresAt:
            token.expires_in === undefined ? null : issuedAt + token.expires_in * 1_000,
          refreshToken: token.refresh_token ?? null,
          refreshExpiresAt:
            token.refresh_token_expires_in === undefined
              ? null
              : issuedAt + token.refresh_token_expires_in * 1_000,
        }),
      ),
    );

  const startLink = (personId: string, team = false) =>
    Effect.gen(function* () {
      const code = yield* request(DeviceCodeResponse, "https://github.com/login/device/code", {
        method: "POST",
        body: { client_id: CLIENT_ID },
      });

      const startedAt = yield* now;
      const expiresAt = startedAt + code.expires_in * 1_000;

      yield* writeSecret(pendingSecret(personId, team), {
        deviceCode: code.device_code,
        intervalSeconds: code.interval,
        expiresAt,
        nextPollAt: startedAt + code.interval * 1_000,
      } satisfies PendingLink);

      return {
        userCode: code.user_code,
        verificationUri: code.verification_uri,
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
        intervalSeconds: code.interval,
      } satisfies GitHubLinkCode;
    });

  const pollLink = (personId: string, team = false) =>
    Effect.gen(function* () {
      const finished = (state: GitHubLinkPollResult["state"]) =>
        removeSecret(pendingSecret(personId, team)).pipe(
          Effect.andThen(getStatus(personId)),
          Effect.map((current): GitHubLinkPollResult => ({ state, ...current })),
        );

      const pending = yield* readSecret(pendingSecret(personId, team), decodePending);

      if (Option.isNone(pending)) {
        const current = yield* getStatus(personId);

        return {
          state: (team ? current.teamLogin : current.login) ? "connected" : "expired",
          ...current,
        } satisfies GitHubLinkPollResult;
      }

      const polledAt = yield* now;

      if (polledAt >= pending.value.expiresAt) return yield* finished("expired");

      const stillPending: GitHubLinkPollResult = {
        state: "pending",
        ...(yield* getStatus(personId)),
      };

      if (polledAt < pending.value.nextPollAt) return stillPending;

      const token = yield* request(TokenResponse, "https://github.com/login/oauth/access_token", {
        method: "POST",
        body: {
          client_id: CLIENT_ID,
          device_code: pending.value.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
      });

      if (token.access_token === undefined) {
        if (token.error === "expired_token") return yield* finished("expired");

        if (token.error === "access_denied") return yield* finished("denied");

        if (token.error !== "authorization_pending" && token.error !== "slow_down")
          return yield* failure("GitHub could not link your account. Try again.");

        const intervalSeconds =
          token.error === "slow_down"
            ? (token.interval ?? pending.value.intervalSeconds + 5)
            : pending.value.intervalSeconds;

        yield* writeSecret(pendingSecret(personId, team), {
          ...pending.value,
          intervalSeconds,
          nextPollAt: polledAt + intervalSeconds * 1_000,
        } satisfies PendingLink);

        return stillPending;
      }

      const account = yield* tokenAccount({ ...token, access_token: token.access_token }, polledAt);

      yield* writeSecret(accountSecret(personId, team), account);

      return yield* finished("connected");
    });

  const disconnect = (personId: string, team = false) =>
    Effect.all([
      removeSecret(accountSecret(personId, team)),
      removeSecret(pendingSecret(personId, team)),
    ]).pipe(Effect.andThen(getStatus(personId)));

  /** One stored link, refreshed on the server when it is close to expiring. */
  const freshLogin = (secret: string) =>
    Effect.gen(function* () {
      const stored = yield* readSecret(secret, decodeAccount);

      if (Option.isNone(stored)) return Option.none<GitHubTurnLogin>();
      const account = stored.value;
      const checkedAt = yield* now;

      if (
        account.accessExpiresAt === null ||
        account.accessExpiresAt - checkedAt > REFRESH_MARGIN_MS
      )
        return Option.some<GitHubTurnLogin>(account);

      if (
        account.refreshToken === null ||
        (account.refreshExpiresAt !== null && account.refreshExpiresAt <= checkedAt)
      ) {
        yield* removeSecret(secret);

        return Option.none<GitHubTurnLogin>();
      }

      const token = yield* request(TokenResponse, "https://github.com/login/oauth/access_token", {
        method: "POST",
        body: {
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: account.refreshToken,
        },
      });

      if (token.access_token === undefined) {
        // GitHub refused the refresh token, so the link is gone; the person connects again.
        yield* removeSecret(secret);

        return Option.none<GitHubTurnLogin>();
      }

      const refreshed = yield* tokenAccount(
        { ...token, access_token: token.access_token },
        checkedAt,
      );

      yield* writeSecret(secret, refreshed);

      return Option.some<GitHubTurnLogin>(refreshed);
    });

  /**
   * The login for one bot turn: the asking person's own, else the team's. None when neither is
   * linked or neither can be refreshed.
   */
  const turnLogin = (personId: string) =>
    freshLogin(accountSecret(personId)).pipe(
      Effect.flatMap((own) =>
        Option.isSome(own) ? Effect.succeed(own) : freshLogin(TEAM_ACCOUNT_SECRET),
      ),
    );

  return { getStatus, startLink, pollLink, disconnect, turnLogin };
}

export class GitHubAccounts extends Context.Service<GitHubAccounts, ReturnType<typeof make>>()(
  "@otto/server/github/github-accounts/GitHubAccounts",
) {}

export const layer = Layer.effect(
  GitHubAccounts,
  Effect.map(ServerSecretStore, (store) => make(store)),
);
