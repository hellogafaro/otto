import {
  ComposioLabelTakenError,
  ComposioOperationError,
  type ComposioAuthSetup,
  type ComposioAuthorizeInput,
  type ComposioAuthorizeResult,
  type ComposioConnection,
  type ComposioCreateAuthConfigInput,
  type ComposioCreateAuthConfigResult,
  type ComposioStatus,
  type ComposioToolkit,
  type ComposioToolkitDetail,
  type ComposioUpdateConnectionInput,
  type McpServer,
  McpServerId,
  type OttoRoutineAppTriggerInput,
  type RoutineAppTrigger,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { HostProcessEnvironment } from "@otto/shared/hostProcess";

import { ServerSecretStore } from "../auth/server-secret-store.ts";
import { withMcpRuntimeHeaders } from "../provider/mcp-server-config.ts";
import {
  accountLabel,
  type ComposioAccountStore,
  composioAccountAlias,
  type ComposioBot,
  composioAccountServesBot,
  composioAccountVisibleTo,
  type ComposioViewer,
  manageableBy,
  sqlComposioAccounts,
} from "./composio-accounts.ts";
import {
  type ComposioClient,
  type ComposioClientFactory,
  composioStatus,
  createComposioClient,
  isNotFoundError,
  normalizeAuthConfigs,
  normalizeToolkitAuth,
  operationError,
  toConnection,
  tryComposio,
} from "./composio-client.ts";

const USER_ID_SECRET = "composio-user-id";

const WEBHOOK_SECRET = "composio-webhook-secret";

const COMPOSIO_MCP_SERVER_ID = McpServerId.make("composio-session");

const isLabelTaken = Schema.is(ComposioLabelTakenError);

/** The settings an app event needs, from the JSON schema Composio gives for its config. */
const decodeRequiredConfig = Schema.decodeUnknownOption(
  Schema.Struct({ required: Schema.Array(Schema.String) }),
);

/** One of the server's app triggers in Composio. */
export interface ComposioTriggerRecord {
  readonly id: string;
  readonly connectionId: string;
  readonly event: string;
  readonly enabled: boolean;
}

/** A webhook delivery whose signature checked out: the trigger that fired and its event data. */
export interface ComposioWebhookDelivery {
  readonly triggerId: string;
  readonly data: object;
}

export interface ComposioServiceShape {
  readonly isConfigured: Effect.Effect<boolean, ComposioOperationError>;
  readonly getStatus: (
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioStatus, ComposioOperationError>;
  readonly searchToolkits: (input: {
    readonly query?: string | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<readonly ComposioToolkit[], ComposioOperationError>;
  readonly getToolkit: (
    slug: string,
  ) => Effect.Effect<ComposioToolkitDetail, ComposioOperationError>;
  readonly getAuthSetup: (slug: string) => Effect.Effect<ComposioAuthSetup, ComposioOperationError>;
  readonly createAuthConfig: (
    input: ComposioCreateAuthConfigInput,
  ) => Effect.Effect<ComposioCreateAuthConfigResult, ComposioOperationError>;
  readonly authorize: (
    input: ComposioAuthorizeInput,
    viewer: ComposioViewer,
  ) => Effect.Effect<ComposioAuthorizeResult, ComposioOperationError | ComposioLabelTakenError>;
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
  /**
   * A bot's pick of an app event as a routine trigger: the event must be one the app reports,
   * the account one the person sees and the bot may use, and the settings the event needs set.
   */
  readonly prepareTrigger: (
    input: OttoRoutineAppTriggerInput,
    bot: ComposioBot,
    personId: string | null,
  ) => Effect.Effect<RoutineAppTrigger, ComposioOperationError>;
  /** Why a trigger's account cannot start runs for the bot, or null when it can. */
  readonly checkTriggerAccount: (
    connectionId: string,
    bot: ComposioBot,
  ) => Effect.Effect<string | null, ComposioOperationError>;
  /** The app triggers on the server's accounts, enabled or not. */
  readonly listTriggers: Effect.Effect<readonly ComposioTriggerRecord[], ComposioOperationError>;
  /** Creates the trigger in Composio, or finds the same one, and returns its id. */
  readonly createTrigger: (
    trigger: RoutineAppTrigger,
  ) => Effect.Effect<string, ComposioOperationError>;
  readonly setTriggerEnabled: (
    triggerId: string,
    enabled: boolean,
  ) => Effect.Effect<void, ComposioOperationError>;
  readonly deleteTrigger: (triggerId: string) => Effect.Effect<void, ComposioOperationError>;
  /** Points the Composio project's webhook at this server and keeps its signing secret. */
  readonly subscribeWebhook: (webhookUrl: string) => Effect.Effect<void, ComposioOperationError>;
  /** The delivery a signed webhook carries, or null when its signature or age does not check. */
  readonly verifyWebhook: (input: {
    readonly id: string;
    readonly timestamp: string;
    readonly signature: string;
    readonly body: string;
  }) => Effect.Effect<ComposioWebhookDelivery | null, ComposioOperationError>;
}

export class ComposioService extends Context.Service<ComposioService, ComposioServiceShape>()(
  "@otto/server/composio/composio-service/ComposioService",
) {}

function bytesToId(bytes: Uint8Array): string {
  return `otto_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** `apiKey` is the server's COMPOSIO_API_KEY: one Composio project for the whole workspace. */
export function make(
  secretStore: ServerSecretStore["Service"],
  accounts: ComposioAccountStore,
  apiKey: string | undefined,
  createClient: ComposioClientFactory = createComposioClient,
  readUserId: Effect.Effect<string, ComposioOperationError> = secretStore
    .getOrCreateRandom(USER_ID_SECRET, 16)
    .pipe(
      Effect.map(bytesToId),
      Effect.mapError((cause) => operationError("prepare its local user", cause)),
    ),
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

  const readApiKey = Effect.succeed(Option.fromUndefinedOr(apiKey?.trim() || undefined));

  const withClient = <A>(
    operation: string,
    run: (client: ComposioClient, userId: string) => Promise<A>,
  ) =>
    Effect.gen(function* () {
      const apiKey = yield* readApiKey;

      if (Option.isNone(apiKey)) {
        return yield* new ComposioOperationError({
          operation,
          message: "Set COMPOSIO_API_KEY on the server first.",
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

          const alias = accountLabel(record, connection);

          return [
            {
              ...connection,
              ...(alias ? { alias } : {}),
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

      const [tools, triggers] = await Promise.all([
        client.tools.getRawComposioTools({ toolkits: [slug], limit: 1000 }),
        listTriggerTypes(client, slug),
      ]);

      return {
        toolkit,
        tools: tools.map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
        })),
        triggers: triggers.map((trigger) => ({
          slug: trigger.slug,
          name: trigger.name,
          ...(trigger.description ? { description: trigger.description } : {}),
        })),
      };
    });

  const listTriggerTypes = (client: ComposioClient, toolkitSlug: string) =>
    client.triggers
      .listTypes({ toolkits: [toolkitSlug], limit: 1000 })
      .then((response) => response.items);

  /**
   * Refuses a label the person already gave one of their accounts for this app, and returns the
   * refusal for a conflict Composio reports itself.
   */
  const claimLabel = (toolkitSlug: string, label: string, personId: string) =>
    Effect.gen(function* () {
      const records = new Map(
        (yield* accounts.list).map((record) => [record.connectionId, record]),
      );

      const [connections, toolkits] = yield* withClient(
        "check your account labels",
        (client, userId) =>
          Promise.all([
            listConnections(client, userId),
            loadCatalog(client).catch((): readonly ComposioToolkit[] => []),
          ]),
      );

      const toolkitName =
        toolkits.find((toolkit) => toolkit.slug === toolkitSlug)?.name ?? toolkitSlug;

      const taken = new ComposioLabelTakenError({
        toolkitSlug,
        label,
        message: `You already have an account called ${label} for ${toolkitName}.`,
      });

      const used = connections.some((connection) => {
        const record = records.get(connection.id);

        return (
          connection.toolkitSlug === toolkitSlug &&
          record?.createdBy === personId &&
          accountLabel(record, connection)?.toLowerCase() === label.toLowerCase()
        );
      });

      return used ? yield* taken : taken;
    });

  const IMMEDIATE_SCHEMES = new Set(["API_KEY", "BASIC", "BEARER_TOKEN"]);

  const filledFields = (fields: Readonly<Record<string, string>> | undefined) =>
    Object.fromEntries(Object.entries(fields ?? {}).filter(([, value]) => value.trim() !== ""));

  const getAuthSetup: ComposioServiceShape["getAuthSetup"] = (slug) =>
    withClient("load auth setup", async (client) => {
      const toolkit = normalizeToolkitAuth(await client.toolkits.getBySlug(slug));

      return {
        managed: toolkit.managed,
        schemes: toolkit.schemes,
        configs: toolkit.managed
          ? []
          : normalizeAuthConfigs(await client.authConfigs.list({ toolkit: slug })),
      };
    });

  const createAuthConfig: ComposioServiceShape["createAuthConfig"] = (input) =>
    withClient("create an auth config", async (client) => {
      const created = await client.authConfigs.create(input.toolkitSlug, {
        authScheme: input.scheme,
        credentials: filledFields(input.credentials),
      });

      return { authConfigId: created.id };
    });

  const authorizeWithConfig = async (
    client: ComposioClient,
    userId: string,
    input: ComposioAuthorizeInput,
    alias: string | undefined,
  ) => {
    const authConfigId = input.authConfigId;

    if (!authConfigId) throw new Error("Choose an auth config before connecting.");

    const connection = filledFields(input.connection);
    const scheme = input.authScheme ?? "OAUTH2";
    const request =
      Object.keys(connection).length > 0
        ? await client.connectedAccounts.initiate(userId, authConfigId, {
            allowMultiple: true,
            ...(alias ? { alias } : {}),
            config: {
              authScheme: scheme,
              val: {
                status: IMMEDIATE_SCHEMES.has(scheme) ? "ACTIVE" : "INITIALIZING",
                ...connection,
              },
            },
          })
        : await client.connectedAccounts.link(userId, authConfigId, {
            allowMultiple: true,
            ...(alias ? { alias } : {}),
          });
    const redirectUrl = request.redirectUrl?.trim() || undefined;
    const active = request.status === "ACTIVE" || (!redirectUrl && IMMEDIATE_SCHEMES.has(scheme));

    if (!redirectUrl && !active) {
      throw new Error("Composio did not return an authorization URL.");
    }

    return {
      connectionId: request.id,
      ...(redirectUrl ? { redirectUrl } : {}),
    };
  };

  const authorize: ComposioServiceShape["authorize"] = (input, viewer) =>
    Effect.gen(function* () {
      const label = input.alias;

      const labelTaken =
        label === undefined
          ? undefined
          : yield* claimLabel(input.toolkitSlug, label, viewer.personId);

      const alias = label === undefined ? undefined : composioAccountAlias(viewer, label);

      const authorization = input.authConfigId
        ? yield* withClient("start account authorization", async (client, userId) => {
            try {
              return await authorizeWithConfig(client, userId, input, alias);
            } catch (cause) {
              if (labelTaken && composioStatus(cause) === 409) return labelTaken;
              throw cause;
            }
          })
        : yield* withClient("start account authorization", async (client, userId) => {
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
              .authorize(input.toolkitSlug, alias === undefined ? undefined : { alias })
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

              if (labelTaken && composioStatus(authorization.error) === 409) return labelTaken;

              throw authorization.error;
            }

            if (!cleanup.ok) {
              throw cleanup.error;
            }

            return authorization.value;
          });

      if (isLabelTaken(authorization)) return yield* authorization;

      yield* accounts.save({
        connectionId: authorization.connectionId,
        createdBy: viewer.personId,
        createdByName: viewer.displayName,
        label: label ?? null,
        visibility: input.visibility ?? "user",
        botAccess: {},
      });

      return authorization;
    });

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
        label: record?.label ?? null,
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

  const prepareTrigger: ComposioServiceShape["prepareTrigger"] = (input, bot, personId) =>
    Effect.flatMap(accounts.list, (records) => {
      const owners = new Map(records.map((record) => [record.connectionId, record]));

      return withClient("set up the app trigger", async (client, userId) => {
        const app = input.app.trim().toLowerCase();

        const toolkit = (await loadCatalog(client)).find(
          (candidate) => candidate.slug === app || candidate.name.toLowerCase() === app,
        );

        if (!toolkit) throw new Error(`Composio does not list ${input.app}.`);
        const events = await listTriggerTypes(client, toolkit.slug);
        const wanted = input.event.trim().toLowerCase();

        const event = events.find(
          (candidate) =>
            candidate.slug.toLowerCase() === wanted || candidate.name.toLowerCase() === wanted,
        );

        if (!event) {
          throw new Error(
            events.length === 0
              ? `${toolkit.name} reports no events.`
              : `${toolkit.name} has no event ${input.event}. Its events: ${events.map((candidate) => `${candidate.slug} (${candidate.name})`).join(", ")}.`,
          );
        }

        const config = input.config ?? {};

        const required = Option.match(decodeRequiredConfig(event.config), {
          onNone: () => [],
          onSome: (schema) => schema.required,
        });

        const missing = required.filter((key) => config[key] === undefined);

        if (missing.length > 0) {
          throw new Error(`${event.name} needs ${missing.join(", ")} in config.`);
        }

        const usable = (await listConnections(client, userId)).filter(
          (connection) =>
            connection.toolkitSlug === toolkit.slug &&
            connection.status === "ACTIVE" &&
            composioAccountVisibleTo(owners.get(connection.id), personId) &&
            composioAccountServesBot(owners.get(connection.id), bot),
        );

        const names = (connection: (typeof usable)[number]) =>
          [accountLabel(owners.get(connection.id), connection), connection.accountName].filter(
            (name): name is string => name !== undefined,
          );

        const account = input.account?.trim().toLowerCase();

        const matches =
          account === undefined
            ? usable
            : usable.filter((connection) =>
                names(connection).some((name) => name.toLowerCase() === account),
              );

        const [connection] = matches;

        if (connection === undefined || matches.length > 1) {
          const choices = usable.map((candidate) => names(candidate).join(" / ")).join(", ");

          throw new Error(
            usable.length === 0
              ? `Connect a ${toolkit.name} account this bot may use first.`
              : account === undefined
                ? `Pick which ${toolkit.name} account to watch: ${choices}.`
                : `No ${toolkit.name} account is called ${input.account}. Accounts: ${choices}.`,
          );
        }

        return {
          type: "app" as const,
          app: toolkit.slug,
          event: event.slug,
          title: event.name,
          connectionId: connection.id,
          config,
          triggerId: null,
        };
      });
    });

  const checkTriggerAccount: ComposioServiceShape["checkTriggerAccount"] = (connectionId, bot) =>
    Effect.flatMap(accounts.list, (records) =>
      withClient("check the trigger's account", async (client, userId) => {
        const connection = (await listConnections(client, userId)).find(
          (candidate) => candidate.id === connectionId,
        );

        if (!connection) return "The app account this routine watches was disconnected.";

        if (connection.status !== "ACTIVE") {
          return "The app account this routine watches needs to be connected again.";
        }

        return composioAccountServesBot(
          records.find((record) => record.connectionId === connectionId),
          bot,
        )
          ? null
          : "The routine's bot may no longer use the app account it watches.";
      }),
    );

  const listTriggers: ComposioServiceShape["listTriggers"] = withClient(
    "list app triggers",
    async (client, userId) => {
      const connectedAccountIds = (await listConnections(client, userId)).map(
        (connection) => connection.id,
      );

      const triggers: ComposioTriggerRecord[] = [];
      let cursor: string | undefined;

      if (connectedAccountIds.length === 0) return triggers;

      do {
        const page = await client.triggers.listActive({
          connectedAccountIds,
          showDisabled: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });

        triggers.push(
          ...page.items.map((trigger) => ({
            id: trigger.id,
            connectionId: trigger.connectedAccountId,
            event: trigger.triggerName,
            enabled: trigger.disabledAt === null,
          })),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      return triggers;
    },
  );

  const createTrigger: ComposioServiceShape["createTrigger"] = (trigger) =>
    withClient("create the app trigger", (client, userId) =>
      client.triggers
        .create(userId, trigger.event, {
          connectedAccountId: trigger.connectionId,
          triggerConfig: trigger.config,
        })
        .then((created) => created.triggerId),
    );

  const setTriggerEnabled: ComposioServiceShape["setTriggerEnabled"] = (triggerId, enabled) =>
    withClient(enabled ? "turn on the app trigger" : "turn off the app trigger", (client) =>
      (enabled ? client.triggers.enable(triggerId) : client.triggers.disable(triggerId)).then(
        () => undefined,
      ),
    );

  const deleteTrigger: ComposioServiceShape["deleteTrigger"] = (triggerId) =>
    withClient("delete the app trigger", (client) =>
      client.triggers.delete(triggerId).then(
        () => undefined,
        (cause: unknown) => {
          if (!isNotFoundError(cause)) throw cause;
        },
      ),
    );

  // Otto: Composio returns the project's signing secret with its subscription, so the
  // secret kept here is the one it signs with since this server last started.
  const subscribeWebhook: ComposioServiceShape["subscribeWebhook"] = (webhookUrl) =>
    Effect.gen(function* () {
      const { secret } = yield* withClient("set up its webhook", (client) =>
        client.triggers.setWebhookSubscription({ webhookUrl }),
      );

      if (!secret) {
        return yield* new ComposioOperationError({
          operation: "set up its webhook",
          message: "Composio did not return the webhook signing secret.",
        });
      }

      yield* secretStore
        .set(WEBHOOK_SECRET, new TextEncoder().encode(secret))
        .pipe(Effect.mapError((cause) => operationError("keep its webhook secret", cause)));
    });

  const verifyWebhook: ComposioServiceShape["verifyWebhook"] = (input) =>
    Effect.gen(function* () {
      const stored = yield* secretStore
        .get(WEBHOOK_SECRET)
        .pipe(Effect.mapError((cause) => operationError("read its webhook secret", cause)));

      if (Option.isNone(stored)) return null;

      return yield* withClient("check a webhook", (client) =>
        client.triggers
          .verifyWebhook({
            id: input.id,
            payload: input.body,
            secret: new TextDecoder().decode(stored.value),
            signature: input.signature,
            timestamp: input.timestamp,
          })
          .then(
            (result): ComposioWebhookDelivery => ({
              triggerId: result.payload.id,
              data: result.payload.payload ?? {},
            }),
            () => null,
          ),
      );
    });

  return {
    isConfigured,
    getStatus,
    searchToolkits,
    getToolkit,
    getAuthSetup,
    createAuthConfig,
    authorize,
    disconnect,
    updateConnection,
    connectedToolkits,
    resolveRuntimeMcpServer,
    prepareTrigger,
    checkTriggerAccount,
    listTriggers,
    createTrigger,
    setTriggerEnabled,
    deleteTrigger,
    subscribeWebhook,
    verifyWebhook,
  };
}

export const layer = Layer.effect(
  ComposioService,
  Effect.gen(function* () {
    const secretStore = yield* ServerSecretStore;
    const sql = yield* SqlClient.SqlClient;
    const { COMPOSIO_API_KEY } = yield* HostProcessEnvironment;
    const readUserId = sql<{ readonly id: string }>`SELECT id FROM organizations LIMIT 1`.pipe(
      Effect.flatMap((rows) => {
        const id = rows[0]?.id?.trim();

        return id
          ? Effect.succeed(id)
          : Effect.fail(
              new ComposioOperationError({
                operation: "prepare its local user",
                message: "Set up the workspace before connecting apps.",
              }),
            );
      }),
      Effect.mapError((cause) =>
        Schema.is(ComposioOperationError)(cause)
          ? cause
          : operationError("prepare its local user", cause),
      ),
    );

    return make(
      secretStore,
      yield* sqlComposioAccounts,
      COMPOSIO_API_KEY,
      createComposioClient,
      readUserId,
    );
  }),
);
