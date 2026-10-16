import {
  AuthAdministrativeScopes,
  AuthStandardClientScopes,
  type AuthEnvironmentScope,
} from "@otto/contracts";
import { HostProcessEnvironment } from "@otto/shared/hostProcess";
import { APIError } from "better-auth/api";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeSqlite from "node:sqlite";
import * as Nodemailer from "nodemailer";
import { ZodError } from "zod";
import { ServerConfig } from "../config.ts";
import { ServerSecretStore } from "./server-secret-store.ts";
import { resolveSessionCookieName } from "./utils.ts";
import { ServerEnvironmentIdentity } from "../environment/server-environment.ts";
import {
  createOrganizationAccountsRuntime,
  DESKTOP_RENDERER_ORIGINS,
  type AccountPerson,
  type AccountPrincipal,
  type OrganizationAccountsRuntime,
} from "./organization-accounts-runtime.ts";

export const organizationRoleScopes = (
  role: AccountPrincipal["role"],
): ReadonlyArray<AuthEnvironmentScope> =>
  role === "admin" ? AuthAdministrativeScopes : AuthStandardClientScopes;

export class OrganizationAccountsError extends Schema.TaggedErrorClass<OrganizationAccountsError>()(
  "OrganizationAccountsError",
  {},
) {}

export class OrganizationAccounts extends Context.Service<
  OrganizationAccounts,
  {
    readonly runtime: OrganizationAccountsRuntime;
    readonly mailConfigured: boolean;
    readonly authenticate: (
      headers: Headers,
    ) => Effect.Effect<AccountPrincipal | null, OrganizationAccountsError>;
    readonly getPrincipal: (
      sessionId: string,
    ) => Effect.Effect<AccountPrincipal | null, OrganizationAccountsError>;
    readonly listPeople: () => Effect.Effect<
      ReadonlyArray<AccountPerson>,
      OrganizationAccountsError
    >;
    readonly handle: (request: Request) => Effect.Effect<Response>;
  }
>()("@otto/server/auth/organization-accounts/OrganizationAccounts") {}

export const layer = Layer.effect(
  OrganizationAccounts,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const environment = yield* ServerEnvironmentIdentity;
    const secrets = yield* ServerSecretStore;
    const clock = yield* Clock.Clock;
    const variables = yield* HostProcessEnvironment;

    const database = yield* Effect.acquireRelease(
      Effect.try(() => new NodeSqlite.DatabaseSync(config.dbPath)),
      (connection) => Effect.sync(() => connection.close()),
    );

    database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );

    const origin =
      config.publicOrigin ?? config.devUrl?.origin ?? `http://localhost:${config.port}`;

    const mailConfigured = Boolean(variables.OTTO_SMTP_HOST && variables.OTTO_MAIL_FROM);
    const setupToken = variables.OTTO_SETUP_TOKEN?.trim() || undefined;

    const mailer = Nodemailer.createTransport({
      host: variables.OTTO_SMTP_HOST,
      port: Number(variables.OTTO_SMTP_PORT ?? "587"),
      secure: variables.OTTO_SMTP_SECURE === "true",
      ...(variables.OTTO_SMTP_USER
        ? { auth: { user: variables.OTTO_SMTP_USER, pass: variables.OTTO_SMTP_PASSWORD } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    yield* Effect.addFinalizer(() => Effect.sync(() => mailer.close()));
    const secret = yield* secrets.getOrCreateRandom("organization-account-signing-key", 32);
    const environmentId = yield* environment.getEnvironmentId;

    const runtime = yield* Effect.tryPromise(() =>
      createOrganizationAccountsRuntime({
        database,
        secret: Buffer.from(secret).toString("base64url"),
        origin,
        cookieName: resolveSessionCookieName({
          mode: config.mode,
          port: config.port,
          host: config.host,
          instanceKey: config.stateDir,
          environmentId,
          development: config.devUrl !== undefined,
        }),
        mailConfigured,
        setupToken,
        requireSetupToken: variables.OTTO_REMOTE_CONTAINER === "1",
        now: () => clock.currentTimeMillisUnsafe(),
        sendEmail: async (mail) => {
          try {
            await mailer.sendMail({ ...mail, from: variables.OTTO_MAIL_FROM });
          } catch {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "EMAIL_DELIVERY_FAILED",
              message: "Email could not be delivered. Check the organization's mail configuration.",
            });
          }
        },
      }),
    );

    const handle = (request: Request) =>
      Effect.tryPromise(async () => {
        const path = new URL(request.url).pathname;

        if (path === "/api/organization" && request.method === "GET") {
          const session = await runtime.auth.api.getSession({ headers: request.headers });
          const principal = session ? runtime.getPrincipal(session.session.id) : null;

          return Response.json(
            {
              organization: runtime.getOrganization(),
              user: session
                ? {
                    id: session.user.id,
                    email: session.user.email,
                    firstName: session.user.firstName,
                    lastName: session.user.lastName,
                    emailVerified: session.user.emailVerified,
                  }
                : null,
              role: principal?.role ?? null,
              mailConfigured,
              setupCodeRequired: setupToken !== undefined,
            },
            { headers: { "cache-control": "no-store" } },
          );
        }

        if (path === "/api/organization/setup" && request.method === "POST") {
          if (
            ![new URL(origin).origin, ...DESKTOP_RENDERER_ORIGINS].includes(
              request.headers.get("origin") ?? "",
            )
          ) {
            return Response.json({ message: "Invalid request origin." }, { status: 403 });
          }

          return Response.json(await runtime.setup(await request.json()), {
            headers: { "cache-control": "no-store" },
          });
        }

        return runtime.handle(request);
      }).pipe(
        Effect.catch((failure) => {
          const cause = failure.cause;

          if (cause instanceof APIError) {
            return Effect.succeed(
              Response.json(
                {
                  message: cause.body?.message ?? "Account request failed.",
                  code: cause.body?.code,
                },
                { status: cause.statusCode },
              ),
            );
          }

          return Effect.succeed(
            Response.json(
              {
                message:
                  cause instanceof ZodError
                    ? "Check the supplied account details."
                    : "Account request failed.",
              },
              { status: cause instanceof ZodError ? 400 : 500 },
            ),
          );
        }),
      );

    return OrganizationAccounts.of({
      runtime,
      mailConfigured,
      authenticate: (headers) =>
        Effect.tryPromise({
          try: () => runtime.authenticate(headers),
          catch: () => new OrganizationAccountsError({}),
        }),
      getPrincipal: (sessionId) =>
        Effect.try({
          try: () => runtime.getPrincipal(sessionId),
          catch: () => new OrganizationAccountsError({}),
        }),
      listPeople: () =>
        Effect.try({
          try: () => runtime.listPeople(),
          catch: () => new OrganizationAccountsError({}),
        }),
      handle,
    });
  }),
);
