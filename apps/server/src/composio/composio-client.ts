import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { Composio } from "@composio/core";
import {
  ComposioOperationError,
  type ComposioConnection,
  type RoutineAppTrigger,
  TrimmedNonEmptyString,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

type ComposioSdk = InstanceType<typeof Composio>;

type HostedSession = Awaited<ReturnType<ComposioSdk["sessions"]["create"]>>;

/** One app from Composio's catalog, native or a project custom MCP toolkit. */
export type ComposioListedToolkit = {
  readonly slug: string;
  readonly name: string;
  /** Custom MCP toolkits that need no connected account. */
  readonly noAuth?: boolean;
  readonly meta: {
    readonly description?: string | null | undefined;
    readonly logo?: string | null | undefined;
    readonly categories?: ReadonlyArray<{ readonly name: string }> | null | undefined;
    readonly toolsCount?: number | null | undefined;
  };
};

const COMPOSIO_API = "https://backend.composio.dev/api/v3.1";

/** The part of the Composio SDK Otto uses, so tests can stand in for it. */
export type ComposioClient = {
  toolkits: {
    get: (
      ...args: Parameters<ComposioSdk["toolkits"]["get"]>
    ) => ReturnType<ComposioSdk["toolkits"]["get"]>;
    /** One toolkit, including the auth schemes Composio lists for it. */
    getBySlug: (slug: string) => Promise<unknown>;
    /**
     * Project custom MCP toolkits. The SDK list does not forward `type` or `user_id`,
     * so a custom Infisical never appears in `get`.
     */
    listCustom: (userId: string) => Promise<ReadonlyArray<ComposioListedToolkit>>;
  };
  tools: {
    getRawComposioTools: (query: {
      readonly toolkits: string[];
      readonly limit: number;
    }) => Promise<
      ReadonlyArray<{ slug: string; name: string; description?: string | null | undefined }>
    >;
    /** Latest tools for a custom toolkit. The pinned v3 list can be empty after a sync. */
    listLatest: (
      slug: string,
    ) => Promise<
      ReadonlyArray<{ slug: string; name: string; description?: string | null | undefined }>
    >;
  };
  connectedAccounts: {
    list: (
      ...args: Parameters<ComposioSdk["connectedAccounts"]["list"]>
    ) => Promise<{ items: ReadonlyArray<Parameters<typeof toConnection>[0]> }>;
    delete: (...args: Parameters<ComposioSdk["connectedAccounts"]["delete"]>) => Promise<object>;
    initiate: (
      userId: string,
      authConfigId: string,
      options: {
        readonly allowMultiple?: boolean;
        readonly alias?: string;
        readonly config?: {
          readonly authScheme: string;
          readonly val: Record<string, unknown>;
        };
      },
    ) => Promise<{ id: string; redirectUrl?: string | null; status?: string | null }>;
    link: (
      userId: string,
      authConfigId: string,
      options: { readonly allowMultiple?: boolean; readonly alias?: string },
    ) => Promise<{ id: string; redirectUrl?: string | null; status?: string | null }>;
  };
  authConfigs: {
    list: (query: { readonly toolkit: string }) => Promise<unknown>;
    create: (
      toolkit: string,
      options: { readonly authScheme: string; readonly credentials: Record<string, string> },
    ) => Promise<{ id: string }>;
  };
  triggers: {
    listTypes: (query: { readonly toolkits: string[]; readonly limit: number }) => Promise<{
      items: ReadonlyArray<{
        slug: string;
        name: string;
        description?: string | null | undefined;
        config?: object | undefined;
      }>;
    }>;
    listActive: (query: {
      readonly connectedAccountIds: string[];
      readonly showDisabled: boolean;
      readonly limit: number;
      readonly cursor?: string | undefined;
    }) => Promise<{
      items: ReadonlyArray<{
        id: string;
        connectedAccountId: string;
        triggerName: string;
        disabledAt: string | null;
      }>;
      nextCursor?: string | null | undefined;
    }>;
    create: (
      userId: string,
      slug: string,
      body: { connectedAccountId: string; triggerConfig: RoutineAppTrigger["config"] },
    ) => Promise<{ triggerId: string }>;
    enable: (triggerId: string) => Promise<object>;
    disable: (triggerId: string) => Promise<object>;
    delete: (triggerId: string) => Promise<object>;
    setWebhookSubscription: (params: {
      webhookUrl: string;
    }) => Promise<{ id: string; secret?: string | undefined }>;
    verifyWebhook: (params: {
      id: string;
      payload: string;
      secret: string;
      signature: string;
      timestamp: string;
    }) => Promise<{ payload: { id: string; payload?: object | undefined } }>;
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

export type ComposioClientFactory = (apiKey: string) => ComposioClient;

/** The HTTP status of a Composio failure. The SDK wraps API errors, so the status can sit on `cause`. */
export function composioStatus(cause: unknown): number | undefined {
  if (!Predicate.isObjectOrArray(cause)) return undefined;

  if ("status" in cause && cause.status !== undefined) return Number(cause.status);

  return "cause" in cause ? composioStatus(cause.cause) : undefined;
}

export function operationError(operation: string, cause: unknown): ComposioOperationError {
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

export function isNotFoundError(cause: unknown): boolean {
  return composioStatus(cause) === 404;
}

export const tryComposio = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => operationError(operation, cause),
  });

/** Composio fills `state.val.displayName` with the provider's account, such as an email. */
const decodeAccountName = Schema.decodeUnknownOption(
  Schema.Struct({ val: Schema.Struct({ displayName: TrimmedNonEmptyString }) }),
);

export function toConnection(input: {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function secretName(name: string): boolean {
  return /secret|password|token|api_key|apikey/i.test(name);
}

function mapFields(value: unknown, required: boolean) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const field = asRecord(item);
    const name = text(field?.name);

    if (!field || !name) return [];
    if (field.user_visible === false || field.userVisible === false) return [];

    const displayName = text(field.displayName ?? field.display_name) ?? name;
    const description = text(field.description);
    const type = text(field.type);
    const fallback = field.default;
    const secret = field.is_secret === true || field.isSecret === true || secretName(name);

    return [
      {
        name,
        displayName,
        required,
        secret,
        ...(type ? { type } : {}),
        ...(description ? { description } : {}),
        ...(typeof fallback === "string" && fallback ? { default: fallback } : {}),
      },
    ];
  });
}

/** The auth schemes on a toolkit, whether Composio returns them camelCase or as the raw API. */
export function normalizeToolkitAuth(input: unknown): {
  readonly managed: boolean;
  readonly schemes: ReadonlyArray<{
    readonly mode: string;
    readonly name: string;
    readonly creationFields: ReturnType<typeof mapFields>;
    readonly connectionFields: ReturnType<typeof mapFields>;
  }>;
} {
  const record = asRecord(input) ?? {};
  const managedSchemes = record.composioManagedAuthSchemes ?? record.composio_managed_auth_schemes;
  const details = record.authConfigDetails ?? record.auth_config_details;
  const schemes = Array.isArray(details)
    ? details.flatMap((detail) => {
        const item = asRecord(detail);
        const mode = text(item?.mode);

        if (!item || !mode) return [];

        const fields = asRecord(item.fields) ?? {};
        const creation = asRecord(fields.authConfigCreation ?? fields.auth_config_creation) ?? {};
        const connection =
          asRecord(fields.connectedAccountInitiation ?? fields.connected_account_initiation) ?? {};

        return [
          {
            mode,
            name: text(item.name) ?? mode,
            creationFields: [
              ...mapFields(creation.required, true),
              ...mapFields(creation.optional, false),
            ],
            connectionFields: [
              ...mapFields(connection.required, true),
              ...mapFields(connection.optional, false),
            ],
          },
        ];
      })
    : [];

  return {
    managed: Array.isArray(managedSchemes) && managedSchemes.length > 0,
    schemes,
  };
}

/** Enabled custom auth configs for one app. Managed and disabled configs are not choices. */
export function normalizeAuthConfigs(input: unknown): ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly scheme: string;
  readonly connections: number;
}> {
  const record = asRecord(input);
  const items = Array.isArray(input) ? input : record?.items;

  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => {
    const config = asRecord(item);
    const id = text(config?.id);

    if (!config || !id) return [];
    if (text(config.status) === "DISABLED") return [];
    if (config.isComposioManaged === true || config.is_composio_managed === true) return [];

    const connections = config.noOfConnections ?? config.no_of_connections;

    return [
      {
        id,
        name: text(config.name) ?? id,
        scheme: text(config.authScheme ?? config.auth_scheme) ?? "",
        connections: typeof connections === "number" ? connections : 0,
      },
    ];
  });
}

function connectRequest(value: {
  readonly id?: string;
  readonly redirectUrl?: string | null;
  readonly redirect_url?: string | null;
  readonly status?: string | null;
  readonly connected_account_id?: string;
}) {
  const id = value.id ?? value.connected_account_id ?? "";

  if (!id) throw new Error("Composio did not return a connection id.");

  return {
    id,
    redirectUrl: value.redirectUrl ?? value.redirect_url ?? null,
    ...(value.status ? { status: value.status } : {}),
  };
}

async function composioJson(
  apiKey: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<unknown> {
  const url = new URL(`${COMPOSIO_API}${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await Effect.runPromise(
    HttpClient.execute(
      HttpClientRequest.get(url.toString()).pipe(HttpClientRequest.setHeader("x-api-key", apiKey)),
    ).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(`Composio returned ${response.status}.`), {
      status: response.status,
    });
  }

  return Effect.runPromise(response.json);
}

function listedToolkit(value: unknown): ComposioListedToolkit | undefined {
  const item = asRecord(value);
  const slug = text(item?.slug);
  const name = text(item?.name);

  if (!item || !slug || !name) return undefined;
  const meta = asRecord(item.meta);
  const categories = Array.isArray(meta?.categories)
    ? meta.categories.flatMap((category) => {
        const name = text(asRecord(category)?.name);

        return name ? [{ name }] : [];
      })
    : undefined;
  const toolsCount = meta?.tools_count ?? meta?.toolsCount;

  return {
    slug,
    name,
    noAuth: item.no_auth === true || item.noAuth === true,
    meta: {
      ...(text(meta?.description) ? { description: text(meta?.description) } : {}),
      ...(text(meta?.logo) ? { logo: text(meta?.logo) } : {}),
      ...(categories ? { categories } : {}),
      ...(typeof toolsCount === "number" ? { toolsCount } : {}),
    },
  };
}

async function listPages(
  apiKey: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<readonly unknown[]> {
  const items: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const body = asRecord(await composioJson(apiKey, path, { ...query, cursor }));
    const next = Array.isArray(body?.items) ? body.items : [];
    items.push(...next);
    cursor = text(body?.next_cursor) ?? text(body?.nextCursor);

    if (!cursor || next.length === 0) break;
  }

  return items;
}

export function createComposioClient(apiKey: string): ComposioClient {
  const sdk = new Composio({ apiKey });

  return {
    toolkits: {
      get: (...args) => sdk.toolkits.get(...args),
      getBySlug: (slug) => (sdk.toolkits.get as (slug: string) => Promise<unknown>)(slug),
      listCustom: async (userId) =>
        (
          await listPages(apiKey, "/toolkits", {
            type: "custom",
            user_id: userId,
            limit: "1000",
          })
        ).flatMap((item) => {
          const toolkit = listedToolkit(item);

          return toolkit ? [toolkit] : [];
        }),
    },
    tools: {
      getRawComposioTools: (query) => sdk.tools.getRawComposioTools(query),
      listLatest: async (slug) =>
        (
          await listPages(apiKey, "/tools", {
            toolkit_slug: slug,
            toolkit_versions: "latest",
            limit: "1000",
          })
        ).flatMap((item) => {
          const tool = asRecord(item);
          const toolSlug = text(tool?.slug);
          const name = text(tool?.name);

          if (!toolSlug || !name) return [];

          return [
            {
              slug: toolSlug,
              name,
              ...(text(tool?.description) ? { description: text(tool?.description) } : {}),
            },
          ];
        }),
    },
    connectedAccounts: {
      list: (...args) => sdk.connectedAccounts.list(...args),
      delete: (...args) => sdk.connectedAccounts.delete(...args),
      initiate: async (userId, authConfigId, options) =>
        connectRequest(
          await sdk.connectedAccounts.initiate(userId, authConfigId, {
            allowMultiple: options.allowMultiple ?? true,
            ...(options.alias ? { alias: options.alias } : {}),
            ...(options.config ? { config: options.config } : {}),
          } as Parameters<ComposioSdk["connectedAccounts"]["initiate"]>[2]),
        ),
      link: async (userId, authConfigId, options) =>
        connectRequest(
          await sdk.connectedAccounts.link(userId, authConfigId, {
            allowMultiple: options.allowMultiple ?? true,
            ...(options.alias ? { alias: options.alias } : {}),
          }),
        ),
    },
    authConfigs: {
      list: (query) => sdk.authConfigs.list({ toolkit: query.toolkit, limit: 100 }),
      create: async (toolkit, options) => {
        const created = await sdk.authConfigs.create(toolkit, {
          type: "use_custom_auth",
          authScheme: options.authScheme,
          credentials: options.credentials,
        } as Parameters<ComposioSdk["authConfigs"]["create"]>[1]);

        if (!created.id) throw new Error("Composio did not return an auth config id.");

        return { id: created.id };
      },
    },
    triggers: {
      listTypes: (query) => sdk.triggers.listTypes(query),
      listActive: (query) => sdk.triggers.listActive(query),
      create: (userId, slug, body) => sdk.triggers.create(userId, slug, body),
      enable: (triggerId) => sdk.triggers.enable(triggerId),
      disable: (triggerId) => sdk.triggers.disable(triggerId),
      delete: (triggerId) => sdk.triggers.delete(triggerId),
      setWebhookSubscription: (params) => sdk.triggers.setWebhookSubscription(params),
      verifyWebhook: (params) => sdk.triggers.verifyWebhook(params),
    },
    sessions: { create: (userId, options) => sdk.sessions.create(userId, options) },
  };
}
