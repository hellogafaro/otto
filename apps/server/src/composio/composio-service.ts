import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { Composio } from "@composio/core";
import {
  ComposioOperationError,
  type ComposioAuthorizeInput,
  type ComposioAuthorizeResult,
  type ComposioConnection,
  type ComposioStatus,
  type ComposioToolkit,
  type ComposioToolkitDetail,
  type ComposioUpdateConnectionInput,
  type ComposioVisibility,
  type McpServer,
  McpServerId,
  TrimmedNonEmptyString,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerSecretStore } from "../auth/server-secret-store.ts";
import { withMcpRuntimeHeaders } from "../provider/mcp-server-config.ts";

const API_KEY_SECRET = "composio-api-key";

const USER_ID_SECRET = "composio-user-id";

const COMPOSIO_MCP_SERVER_ID = McpServerId.make("composio-session");

const textDecoder = new TextDecoder();

const textEncoder = new TextEncoder();

type ComposioSdk = InstanceType<typeof Composio>;

type HostedSession = Awaited<ReturnType<ComposioSdk["sessions"]["create"]>>;

type ComposioClient = {
  toolkits: {
    get: (...args: Parameters<ComposioSdk["toolkits"]["get"]>) => Promise<
      ReadonlyArray<{
        slug: string;
        name: string;
        meta: {
          description?: string | null | undefined;
          logo?: string | null | undefined;
          categories?: ReadonlyArray<{ name: string }> | null | undefined;
          toolsCount?: number | null | undefined;
        };
      }>
    >;
  };
  tools: {
    getRawComposioTools: (query: {
      readonly toolkits: string[];
      readonly limit: number;
    }) => Promise<
      ReadonlyArray<{ slug: string; name: string; description?: string | null | undefined }>
    >;
  };
  connectedAccounts: {
    list: (
      ...args: Parameters<ComposioSdk["connectedAccounts"]["list"]>
    ) => Promise<{ items: ReadonlyArray<Parameters<typeof toConnection>[0]> }>;
    delete: (...args: Parameters<ComposioSdk["connectedAccounts"]["delete"]>) => Promise<object>;
  };
  sessions: {
    create: (
      userId: string,
      options: Parameters<ComposioSdk["sessions"]["create"]>[1] & { mcp: true },
    ) => Promise<{
      mcp: { url: string; headers?: Record<string, string> | undefined };
      authorize: (
        ...args: Parameters<HostedSession["authorize"]>
      ) => Promise<{ id: string; redirectUrl?: string | null | undefined }>;
      delete: () => Promise<object | void>;
    }>;
  };
};

type ComposioClientFactory = (apiKey: string) => ComposioClient;

/** Otto's record of one connected account: Composio itself only knows the server's one user. */
export interface ComposioAccountRecord {
  readonly connectionId: string;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  readonly visibility: ComposioVisibility;
  /** Per-bot choices that differ from the default, by bot id. */
  readonly botAccess: Readonly<Record<string, boolean>>;
}

export interface ComposioAccountStore {
  readonly list: Effect.Effect<readonly ComposioAccountRecord[], ComposioOperationError>;
  readonly save: (record: ComposioAccountRecord) => Effect.Effect<void, ComposioOperationError>;
  readonly remove: (connectionId: string) => Effect.Effect<void, ComposioOperationError>;
}

/** The signed-in person managing accounts. */
export interface ComposioViewer {
  readonly personId: string;
  readonly displayName: string;
}

/**
 * Workspace accounts (and accounts connected before Otto recorded owners) serve
 * everyone. A personal account serves the person who connected it and the bots that
 * person owns: anyone chatting with such a bot uses it without seeing it.
 */
export function composioAccountVisibleTo(
  record: ComposioAccountRecord | undefined,
  personId: string | null,
): boolean {
  return (
    record === undefined ||
    record.visibility === "organization" ||
    (personId !== null && record.createdBy === personId)
  );
}

/** The bot a chat runs as: which one, and the person who owns it. */
export interface ComposioBot {
  readonly botId: string | null;
  readonly ownerPersonId: string | null;
}

/**
 * Whether an account serves a bot: its per-bot switch when set, else the default (team
 * accounts serve every bot, a personal account the bots its owner owns).
 */
export function composioAccountServesBot(
  record: ComposioAccountRecord | undefined,
  bot: ComposioBot,
): boolean {
  const choice = bot.botId === null ? undefined : record?.botAccess[bot.botId];

  return choice ?? composioAccountVisibleTo(record, bot.ownerPersonId);
}

const decodeBotAccess = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Boolean)),
);

function manageableBy(record: ComposioAccountRecord | undefined, personId: string): boolean {
  return record === undefined || record.createdBy === null || record.createdBy === personId;
}

export function inMemoryComposioAccounts(): ComposioAccountStore {
  const records = new Map<string, ComposioAccountRecord>();

  return {
    list: Effect.sync(() => [...records.values()]),
    save: (record) => Effect.sync(() => void records.set(record.connectionId, record)),
    remove: (connectionId) => Effect.sync(() => void records.delete(connectionId)),
  };
}

const sqlComposioAccounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) => operationError(operation, cause);

  const store: ComposioAccountStore = {
    list: sql<{
      readonly connection_id: string;
      readonly created_by: string | null;
      readonly created_by_name: string | null;
      readonly visibility: ComposioVisibility;
      readonly bot_access_json: string;
    }>`SELECT connection_id, created_by, created_by_name, visibility, bot_access_json FROM composio_accounts`.pipe(
      Effect.map((rows) =>
        rows.map(
          (row): ComposioAccountRecord => ({
            connectionId: row.connection_id,
            createdBy: row.created_by,
            createdByName: row.created_by_name,
            visibility: row.visibility,
            botAccess: Option.getOrElse(decodeBotAccess(row.bot_access_json), () => ({})),
          }),
        ),
      ),
      Effect.mapError(fail("load account owners")),
    ),
    save: (record) =>
      sql`
        INSERT INTO composio_accounts (connection_id, created_by, created_by_name, visibility, bot_access_json, created_at)
        VALUES (${record.connectionId}, ${record.createdBy}, ${record.createdByName}, ${record.visibility}, ${JSON.stringify(record.botAccess)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT (connection_id) DO UPDATE SET
          visibility = excluded.visibility,
          bot_access_json = excluded.bot_access_json,
          created_by = COALESCE(composio_accounts.created_by, excluded.created_by),
          created_by_name = COALESCE(composio_accounts.created_by_name, excluded.created_by_name)
      `.pipe(Effect.asVoid, Effect.mapError(fail("save the account owner"))),
    remove: (connectionId) =>
      sql`DELETE FROM composio_accounts WHERE connection_id = ${connectionId}`.pipe(
        Effect.asVoid,
        Effect.mapError(fail("forget the account owner")),
      ),
  };

  return store;
});

export interface ComposioServiceShape {
  readonly isConfigured: Effect.Effect<boolean, ComposioOperationError>;
  readonly getStatus: (
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioStatus, ComposioOperationError>;
  readonly configure: (
    apiKey: string,
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioStatus, ComposioOperationError>;
  readonly remove: Effect.Effect<ComposioStatus, ComposioOperationError>;
  readonly searchToolkits: (input: {
    readonly query?: string | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<readonly ComposioToolkit[], ComposioOperationError>;
  readonly getToolkit: (
    slug: string,
  ) => Effect.Effect<ComposioToolkitDetail, ComposioOperationError>;
  readonly authorize: (
    input: ComposioAuthorizeInput,
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioAuthorizeResult, ComposioOperationError>;
  readonly disconnect: (
    connectionId: string,
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioStatus, ComposioOperationError>;
  readonly updateConnection: (
    input: ComposioUpdateConnectionInput,
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioStatus, ComposioOperationError>;
  /** Apps with an active account the bot can use. */
  readonly connectedToolkits: (
    bot: ComposioBot,
  ) => Effect.Effect<readonly string[], ComposioOperationError>;
  /** The hosted MCP server for one chat, with the accounts its bot can use. */
  readonly resolveRuntimeMcpServer: (
    resourceId: string,
    bot: ComposioBot,
  ) => Effect.Effect<McpServer | undefined, ComposioOperationError>;
}

export class ComposioService extends Context.Service<ComposioService, ComposioServiceShape>()(
  "@otto/server/composio/composio-service/ComposioService",
) {}

/** The HTTP status of a Composio failure. The SDK wraps API errors, so the status can sit on `cause`. */
function composioStatus(cause: unknown): number | undefined {
  if (!Predicate.isObjectOrArray(cause)) return undefined;

  if ("status" in cause && cause.status !== undefined) return Number(cause.status);

  return "cause" in cause ? composioStatus(cause.cause) : undefined;
}

function operationError(operation: string, cause: unknown): ComposioOperationError {
  const status = composioStatus(cause);

  const message = Match.value(status).pipe(
    Match.when(401, () => "The Composio API key is invalid."),
    Match.when(403, () => "The Composio API key does not have permission for this operation."),
    Match.when(429, () => "Composio rate-limited this request. Try again shortly."),
    Match.orElse(() => {
      // Otto: keep Composio's own reason so a failed run says why, not just what.
      const reason = cause instanceof Error ? cause.message.trim().slice(0, 300) : "";

      return reason
        ? `Composio could not ${operation}: ${reason}`
        : `Composio could not ${operation}.`;
    }),
  );

  return new ComposioOperationError({ operation, message });
}

function isNotFoundError(cause: unknown): boolean {
  return composioStatus(cause) === 404;
}

const tryComposio = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => operationError(operation, cause),
  });

function bytesToId(bytes: Uint8Array): string {
  return `otto_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Composio fills `state.val.displayName` with the provider's account, such as an email. */
const decodeAccountName = Schema.decodeUnknownOption(
  Schema.Struct({ val: Schema.Struct({ displayName: TrimmedNonEmptyString }) }),
);

function toConnection(input: {
  readonly id: string;
  readonly toolkit: { readonly slug: string };
  readonly status: ComposioConnection["status"];
  readonly alias?: string | null;
  readonly state?: unknown;
}): Pick<ComposioConnection, "id" | "toolkitSlug" | "status" | "alias" | "accountName"> {
  const accountName = decodeAccountName(input.state);

  return {
    id: input.id,
    toolkitSlug: input.toolkit.slug,
    status: input.status,
    ...(input.alias ? { alias: input.alias } : {}),
    ...(Option.isSome(accountName) ? { accountName: accountName.value.val.displayName } : {}),
  };
}

function createComposioClient(apiKey: string): ComposioClient {
  const sdk = new Composio({ apiKey });

  return {
    toolkits: { get: (...args) => sdk.toolkits.get(...args) },
    tools: { getRawComposioTools: (query) => sdk.tools.getRawComposioTools(query) },
    connectedAccounts: {
      list: (...args) => sdk.connectedAccounts.list(...args),
      delete: (...args) => sdk.connectedAccounts.delete(...args),
    },
    sessions: { create: (userId, options) => sdk.sessions.create(userId, options) },
  };
}

export function make(
  secretStore: ServerSecretStore["Service"],
  accounts: ComposioAccountStore,
  createClient: ComposioClientFactory = createComposioClient,
): ComposioServiceShape {
  let runtimeConfigurationGeneration = 0;
  let catalog: Promise<readonly ComposioToolkit[]> | null = null;
  const pendingHostedSessionDeletes = new Set<() => Promise<void>>();

  const pendingRuntimeResolutions = new Map<
    string,
    {
      readonly generation: number;
      readonly promise: Promise<McpServer | undefined>;
    }
  >();

  const runtimeCache = new Map<
    string,
    {
      readonly fingerprint: string;
      readonly server: McpServer;
      readonly deleteSession: () => Promise<void>;
    }
  >();

  const deleteCachedSession = async (resourceId: string) => {
    const cached = runtimeCache.get(resourceId);

    if (!cached) return;

    try {
      await cached.deleteSession();
    } catch (cause) {
      if (!isNotFoundError(cause)) throw cause;
    }

    if (runtimeCache.get(resourceId) === cached) runtimeCache.delete(resourceId);
  };

  const clearRuntimeCache = async () => {
    for (const resourceId of runtimeCache.keys()) {
      await deleteCachedSession(resourceId);
    }
  };

  const deletePendingHostedSession = async (deleteSession: () => Promise<void>) => {
    try {
      await deleteSession();
    } catch (cause) {
      if (!isNotFoundError(cause)) throw cause;
    }

    pendingHostedSessionDeletes.delete(deleteSession);
  };

  const clearPendingHostedSessions = async () => {
    for (const deleteSession of pendingHostedSessionDeletes) {
      await deletePendingHostedSession(deleteSession);
    }
  };

  const clearHostedSessions = async () => {
    await clearRuntimeCache();
    await clearPendingHostedSessions();
  };

  const invalidateHostedSessions = async () => {
    runtimeConfigurationGeneration += 1;
    catalog = null;
    await clearHostedSessions();
  };

  const readApiKey = secretStore.get(API_KEY_SECRET).pipe(
    Effect.mapError((cause) => operationError("read its API key", cause)),
    Effect.map(Option.map((bytes) => textDecoder.decode(bytes).trim())),
    Effect.map(Option.filter((apiKey) => apiKey.length > 0)),
  );

  const readUserId = secretStore.getOrCreateRandom(USER_ID_SECRET, 16).pipe(
    Effect.map(bytesToId),
    Effect.mapError((cause) => operationError("prepare its local user", cause)),
  );

  const withClient = <A>(
    operation: string,
    run: (client: ComposioClient, userId: string) => Promise<A>,
  ) =>
    Effect.gen(function* () {
      const apiKey = yield* readApiKey;

      if (Option.isNone(apiKey)) {
        return yield* new ComposioOperationError({
          operation,
          message: "Connect Composio in Settings first.",
        });
      }

      const userId = yield* readUserId;

      return yield* tryComposio(operation, () => run(createClient(apiKey.value), userId));
    });

  const listConnections = (client: ComposioClient, userId: string) =>
    client.connectedAccounts
      .list({ userIds: [userId], accountType: "ALL", limit: 100 })
      .then((response) => response.items.map(toConnection));

  const isConfigured: ComposioServiceShape["isConfigured"] = readApiKey.pipe(
    Effect.map(Option.isSome),
  );

  const getStatus: ComposioServiceShape["getStatus"] = (viewer) =>
    Effect.gen(function* () {
      const apiKey = yield* readApiKey;

      if (Option.isNone(apiKey)) return { configured: false, connections: [] };
      const userId = yield* readUserId;

      const client = createClient(apiKey.value);

      const [connections, toolkits] = yield* tryComposio("load connected accounts", () =>
        Promise.all([
          listConnections(client, userId),
          loadCatalog(client).catch((): readonly ComposioToolkit[] => []),
        ]),
      );

      const apps = new Map(toolkits.map((toolkit) => [toolkit.slug, toolkit]));

      const records = new Map(
        (yield* accounts.list).map((record) => [record.connectionId, record]),
      );

      return {
        configured: true,
        connections: connections.flatMap((connection): ComposioConnection[] => {
          const record = records.get(connection.id);

          if (!composioAccountVisibleTo(record, viewer.personId)) return [];
          const mine = record?.createdBy === viewer.personId;
          const app = apps.get(connection.toolkitSlug);

          return [
            {
              ...connection,
              ...(app ? { toolkitName: app.name } : {}),
              ...(app?.logoUrl ? { logoUrl: app.logoUrl } : {}),
              visibility: record?.visibility ?? "organization",
              manageable: manageableBy(record, viewer.personId),
              ...(!mine && record?.createdByName ? { ownerName: record.createdByName } : {}),
              botAccess: record?.botAccess ?? {},
            },
          ];
        }),
      };
    });

  const configure: ComposioServiceShape["configure"] = (apiKey, viewer) =>
    Effect.gen(function* () {
      const normalized = apiKey.trim();

      if (!normalized) {
        return yield* new ComposioOperationError({
          operation: "save its API key",
          message: "Enter a Composio API key.",
        });
      }

      const client = createClient(normalized);
      yield* tryComposio("validate its API key", () => client.toolkits.get({ limit: 1 }));
      yield* tryComposio("delete hosted tool sessions", invalidateHostedSessions);
      yield* secretStore
        .set(API_KEY_SECRET, textEncoder.encode(normalized))
        .pipe(Effect.mapError((cause) => operationError("save its API key", cause)));
      yield* tryComposio("delete hosted tool sessions", invalidateHostedSessions);

      return yield* getStatus(viewer);
    });

  const remove: ComposioServiceShape["remove"] = Effect.gen(function* () {
    yield* tryComposio("delete hosted tool sessions", invalidateHostedSessions);
    yield* secretStore
      .remove(API_KEY_SECRET)
      .pipe(Effect.mapError((cause) => operationError("remove its API key", cause)));
    yield* tryComposio("delete hosted tool sessions", invalidateHostedSessions);

    return { configured: false, connections: [] };
  });

  /** Composio's whole app catalog, most used first, fetched once per key: its list has no search. */
  const loadCatalog = (client: ComposioClient) => {
    catalog ??= client.toolkits
      .get({ limit: 1000, sortBy: "usage" })
      .then((toolkits) =>
        toolkits.map(
          (toolkit): ComposioToolkit => ({
            slug: toolkit.slug,
            name: toolkit.name,
            ...(toolkit.meta.description ? { description: toolkit.meta.description } : {}),
            ...(toolkit.meta.logo ? { logoUrl: toolkit.meta.logo } : {}),
            categories: toolkit.meta.categories?.map((category) => category.name) ?? [],
            toolsCount: toolkit.meta.toolsCount ?? 0,
          }),
        ),
      )
      .catch((cause: unknown) => {
        catalog = null;
        throw cause;
      });

    return catalog;
  };

  const searchToolkits: ComposioServiceShape["searchToolkits"] = (input) =>
    withClient("load toolkits", async (client) => {
      const limit = input.limit ?? 50;
      const query = input.query?.trim().toLowerCase() ?? "";
      const toolkits = await loadCatalog(client);

      if (!query) return toolkits.slice(0, limit);

      const matches = toolkits.filter((toolkit) =>
        [toolkit.name, toolkit.slug, toolkit.description ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );

      return matches
        .toSorted(
          (left, right) =>
            Number(!left.name.toLowerCase().startsWith(query)) -
            Number(!right.name.toLowerCase().startsWith(query)),
        )
        .slice(0, limit);
    });

  const getToolkit: ComposioServiceShape["getToolkit"] = (slug) =>
    withClient("load the app", async (client) => {
      const toolkit = (await loadCatalog(client)).find((candidate) => candidate.slug === slug);

      if (!toolkit) throw new Error(`Composio does not list ${slug}.`);
      const tools = await client.tools.getRawComposioTools({ toolkits: [slug], limit: 1000 });

      return {
        toolkit,
        tools: tools.map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
        })),
      };
    });

  const authorize: ComposioServiceShape["authorize"] = (input, viewer) =>
    withClient("start account authorization", async (client, userId) => {
      await invalidateHostedSessions();

      const session = await client.sessions.create(userId, {
        mcp: true,
        toolkits: [input.toolkitSlug],
        manageConnections: true,
        multiAccount: { enable: true, maxAccountsPerToolkit: 10 },
      });

      const deleteSession = () => session.delete().then(() => undefined);
      pendingHostedSessionDeletes.add(deleteSession);

      const authorization = await session
        .authorize(input.toolkitSlug, input.alias ? { alias: input.alias } : undefined)
        .then((request) => {
          if (!request.redirectUrl) {
            throw new Error("Composio did not return an authorization URL.");
          }

          return { connectionId: request.id, redirectUrl: request.redirectUrl };
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (cause: unknown) => ({ ok: false as const, error: cause }),
        );

      const cleanup = await deletePendingHostedSession(deleteSession).then(
        () => ({ ok: true as const }),
        (cause: unknown) => ({ ok: false as const, error: cause }),
      );

      if (!authorization.ok) {
        if (!cleanup.ok) {
          throw new AggregateError(
            [authorization.error, cleanup.error],
            "Composio authorization and hosted-session cleanup both failed.",
            { cause: authorization.error },
          );
        }

        throw authorization.error;
      }

      if (!cleanup.ok) {
        throw cleanup.error;
      }

      return authorization.value;
    }).pipe(
      Effect.tap(({ connectionId }) =>
        accounts.save({
          connectionId,
          createdBy: viewer.personId,
          createdByName: viewer.displayName,
          visibility: input.visibility ?? "user",
          botAccess: {},
        }),
      ),
    );

  const requireManageable = (connectionId: string, personId: string) =>
    accounts.list.pipe(
      Effect.map((records) => records.find((record) => record.connectionId === connectionId)),
      Effect.flatMap((record) =>
        manageableBy(record, personId)
          ? Effect.succeed(record)
          : Effect.fail(
              new ComposioOperationError({
                operation: "change an account",
                message: "Only the person who connected this account can change it.",
              }),
            ),
      ),
    );

  const updateConnection: ComposioServiceShape["updateConnection"] = (input, viewer) =>
    Effect.gen(function* () {
      const records = yield* accounts.list;
      const existing = records.find((candidate) => candidate.connectionId === input.connectionId);

      // Otto: Anyone switches a team account for a bot; only its owner changes who it is for
      // or lends a personal account to a bot.
      const record =
        input.visibility === undefined &&
        (existing?.visibility ?? "organization") === "organization"
          ? existing
          : yield* requireManageable(input.connectionId, viewer.personId);

      const botAccess = { ...record?.botAccess };

      if (input.bot) botAccess[input.bot.botId] = input.bot.enabled;

      yield* accounts.save({
        connectionId: input.connectionId,
        createdBy: record?.createdBy ?? (input.visibility === undefined ? null : viewer.personId),
        createdByName:
          record?.createdByName ?? (input.visibility === undefined ? null : viewer.displayName),
        visibility: input.visibility ?? record?.visibility ?? "organization",
        botAccess,
      });
      yield* tryComposio("delete hosted tool sessions", invalidateHostedSessions);

      return yield* getStatus(viewer);
    });

  const disconnect: ComposioServiceShape["disconnect"] = (connectionId, viewer) =>
    requireManageable(connectionId, viewer.personId).pipe(
      Effect.andThen(
        withClient("disconnect an account", async (client) => {
          await invalidateHostedSessions();
          await client.connectedAccounts.delete(connectionId);
          await invalidateHostedSessions();
        }),
      ),
      Effect.andThen(accounts.remove(connectionId)),
      Effect.andThen(getStatus(viewer)),
    );

  const connectedToolkits: ComposioServiceShape["connectedToolkits"] = (bot) =>
    Effect.flatMap(accounts.list, (records) => {
      const owners = new Map(records.map((record) => [record.connectionId, record]));

      return withClient("list connected apps", async (client, userId) => [
        ...new Set(
          (await listConnections(client, userId))
            .filter(
              (connection) =>
                connection.status === "ACTIVE" &&
                composioAccountServesBot(owners.get(connection.id), bot),
            )
            .map((connection) => connection.toolkitSlug),
        ),
      ]);
    });

  const resolveRuntimeMcpServer: ComposioServiceShape["resolveRuntimeMcpServer"] = (
    resourceId,
    bot,
  ) =>
    Effect.flatMap(accounts.list, (records) => {
      const owners = new Map(records.map((record) => [record.connectionId, record]));

      return withClient("prepare connected tools", async (client, userId) => {
        const configurationGeneration = runtimeConfigurationGeneration;
        const pending = pendingRuntimeResolutions.get(resourceId);

        if (pending?.generation === configurationGeneration) return pending.promise;

        const resolving = (async () => {
          const connections = (await listConnections(client, userId)).filter(
            (connection) =>
              connection.status === "ACTIVE" &&
              composioAccountServesBot(owners.get(connection.id), bot),
          );

          if (connections.length === 0) {
            await deleteCachedSession(resourceId);

            return undefined;
          }

          const connectedAccounts = Object.groupBy(
            connections,
            (connection) => connection.toolkitSlug,
          );

          const accountMap = Object.fromEntries(
            Object.entries(connectedAccounts).map(([toolkit, accounts]) => [
              toolkit,
              (accounts ?? []).map((account) => account.id),
            ]),
          );

          const fingerprint = JSON.stringify(
            Object.entries(accountMap)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([toolkit, accountIds]) => [toolkit, [...accountIds].sort()]),
          );

          const cached = runtimeCache.get(resourceId);

          if (cached?.fingerprint === fingerprint) return cached.server;
          await deleteCachedSession(resourceId);

          if (runtimeCache.size >= 100) {
            const oldest = runtimeCache.keys().next().value;

            if (oldest !== undefined) await deleteCachedSession(oldest);
          }

          const session = await client.sessions.create(userId, {
            mcp: true,
            toolkits: Object.keys(accountMap),
            connectedAccounts: accountMap,
            manageConnections: false,
            multiAccount: {
              enable: true,
              maxAccountsPerToolkit: 10,
              requireExplicitSelection: true,
            },
          });

          const deleteSession = () => session.delete().then(() => undefined);

          if (configurationGeneration !== runtimeConfigurationGeneration) {
            pendingHostedSessionDeletes.add(deleteSession);
            await deletePendingHostedSession(deleteSession);

            return undefined;
          }

          const now = "1970-01-01T00:00:00.000Z";

          const server = withMcpRuntimeHeaders(
            {
              id: COMPOSIO_MCP_SERVER_ID,
              name: "Composio",
              transport: "url",
              url: session.mcp.url,
              enabled: true,
              createdAt: now,
              updatedAt: now,
            },
            session.mcp.headers ?? {},
          );

          runtimeCache.set(resourceId, {
            fingerprint,
            server,
            deleteSession,
          });

          return server;
        })();

        const pendingResolution = { generation: configurationGeneration, promise: resolving };
        pendingRuntimeResolutions.set(resourceId, pendingResolution);

        try {
          return await resolving;
        } finally {
          if (pendingRuntimeResolutions.get(resourceId) === pendingResolution) {
            pendingRuntimeResolutions.delete(resourceId);
          }
        }
      });
    }).pipe(
      Effect.catch((error) =>
        error.message === "Connect Composio in Settings first."
          ? Effect.as(Effect.void, undefined)
          : Effect.fail(error),
      ),
    );

  return {
    isConfigured,
    getStatus,
    configure,
    remove,
    searchToolkits,
    getToolkit,
    authorize,
    disconnect,
    updateConnection,
    connectedToolkits,
    resolveRuntimeMcpServer,
  };
}

export const layer = Layer.effect(
  ComposioService,
  Effect.gen(function* () {
    const secretStore = yield* ServerSecretStore;

    return make(secretStore, yield* sqlComposioAccounts);
  }),
);
