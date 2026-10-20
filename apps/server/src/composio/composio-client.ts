import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { Composio } from "@composio/core";
import {
  ComposioOperationError,
  ForwardCompatibleArray,
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
  readonly noAuth?: boolean | undefined;
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
    ) => Promise<ReadonlyArray<ComposioListedToolkit>>;
    /** One toolkit, including the auth schemes Composio lists for it. */
    getBySlug: (slug: string) => Promise<ComposioToolkitAuth>;
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
          readonly val: Readonly<Record<string, string>>;
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
    list: (query: { readonly toolkit: string }) => Promise<ComposioAuthConfigs>;
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

const Text = Schema.optional(Schema.NullOr(Schema.String));

const Flag = Schema.optional(Schema.NullOr(Schema.Boolean));

const Count = Schema.optional(Schema.NullOr(Schema.Number));

/** One auth field. Composio answers camelCase through the SDK and snake_case from the raw API. */
const AuthField = Schema.Struct({
  name: Schema.String,
  displayName: Text,
  display_name: Text,
  description: Text,
  type: Text,
  default: Text,
  isSecret: Flag,
  is_secret: Flag,
  userVisible: Flag,
  user_visible: Flag,
});

const AuthFieldGroup = Schema.optional(
  Schema.NullOr(
    Schema.Struct({
      required: Schema.optional(Schema.NullOr(ForwardCompatibleArray(AuthField))),
      optional: Schema.optional(Schema.NullOr(ForwardCompatibleArray(AuthField))),
    }),
  ),
);

const AuthSchemeDetail = Schema.Struct({
  mode: Schema.String,
  name: Text,
  fields: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        authConfigCreation: AuthFieldGroup,
        auth_config_creation: AuthFieldGroup,
        connectedAccountInitiation: AuthFieldGroup,
        connected_account_initiation: AuthFieldGroup,
      }),
    ),
  ),
});

const SchemeList = Schema.optional(Schema.NullOr(Schema.Array(Schema.String)));

const SchemeDetails = Schema.optional(Schema.NullOr(ForwardCompatibleArray(AuthSchemeDetail)));

/** The auth part of one toolkit. */
export const ComposioToolkitAuth = Schema.Struct({
  composioManagedAuthSchemes: SchemeList,
  composio_managed_auth_schemes: SchemeList,
  authConfigDetails: SchemeDetails,
  auth_config_details: SchemeDetails,
});

export type ComposioToolkitAuth = typeof ComposioToolkitAuth.Type;

const AuthConfig = Schema.Struct({
  id: Schema.String,
  name: Text,
  status: Text,
  authScheme: Text,
  auth_scheme: Text,
  isComposioManaged: Flag,
  is_composio_managed: Flag,
  noOfConnections: Count,
  no_of_connections: Count,
});

/** One page of an app's auth configs. */
export const ComposioAuthConfigs = Schema.Struct({ items: ForwardCompatibleArray(AuthConfig) });

export type ComposioAuthConfigs = typeof ComposioAuthConfigs.Type;

/** A toolkit in Composio's raw REST list. */
const RawToolkit = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  no_auth: Flag,
  noAuth: Flag,
  meta: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        description: Text,
        logo: Text,
        categories: Schema.optional(
          Schema.NullOr(ForwardCompatibleArray(Schema.Struct({ name: Schema.String }))),
        ),
        tools_count: Count,
        toolsCount: Count,
      }),
    ),
  ),
});

/** A tool in Composio's raw REST list. */
const RawTool = Schema.Struct({ slug: Schema.String, name: Schema.String, description: Text });

const page = <Item extends Schema.Top>(item: Item) =>
  Schema.Struct({
    items: Schema.optional(Schema.NullOr(ForwardCompatibleArray(item))),
    next_cursor: Text,
    nextCursor: Text,
  });

const decodeToolkitAuth = Schema.decodeUnknownPromise(ComposioToolkitAuth);

const decodeAuthConfigs = Schema.decodeUnknownPromise(ComposioAuthConfigs);

const decodeToolkitPage = Schema.decodeUnknownPromise(page(RawToolkit));

const decodeToolPage = Schema.decodeUnknownPromise(page(RawTool));

function text(value: string | null | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function secretName(name: string): boolean {
  return /secret|password|token|api_key|apikey/i.test(name);
}

function mapFields(
  fields: ReadonlyArray<typeof AuthField.Type> | null | undefined,
  required: boolean,
) {
  return (fields ?? []).flatMap((field) => {
    const name = text(field.name);

    if (!name || field.user_visible === false || field.userVisible === false) return [];

    const type = text(field.type);
    const description = text(field.description);
    const fallback = text(field.default);

    return [
      {
        name,
        displayName: text(field.displayName ?? field.display_name) ?? name,
        required,
        secret: field.is_secret === true || field.isSecret === true || secretName(name),
        ...(type ? { type } : {}),
        ...(description ? { description } : {}),
        ...(fallback ? { default: fallback } : {}),
      },
    ];
  });
}

/** The auth schemes on a toolkit, whether Composio returns them camelCase or as the raw API. */
export function normalizeToolkitAuth(toolkit: ComposioToolkitAuth) {
  const managedSchemes =
    toolkit.composioManagedAuthSchemes ?? toolkit.composio_managed_auth_schemes;

  const details = toolkit.authConfigDetails ?? toolkit.auth_config_details ?? [];

  const schemes = details.flatMap((detail) => {
    const mode = text(detail.mode);

    if (!mode) return [];

    const creation = detail.fields?.authConfigCreation ?? detail.fields?.auth_config_creation;

    const connection =
      detail.fields?.connectedAccountInitiation ?? detail.fields?.connected_account_initiation;

    return [
      {
        mode,
        name: text(detail.name) ?? mode,
        creationFields: [
          ...mapFields(creation?.required, true),
          ...mapFields(creation?.optional, false),
        ],
        connectionFields: [
          ...mapFields(connection?.required, true),
          ...mapFields(connection?.optional, false),
        ],
      },
    ];
  });

  return { managed: (managedSchemes?.length ?? 0) > 0, schemes };
}

/** Enabled custom auth configs for one app. Managed and disabled configs are not choices. */
export function normalizeAuthConfigs(configs: ComposioAuthConfigs) {
  return configs.items.flatMap((config) => {
    const id = text(config.id);

    if (!id || text(config.status) === "DISABLED") return [];

    if (config.isComposioManaged === true || config.is_composio_managed === true) return [];

    return [
      {
        id,
        name: text(config.name) ?? id,
        scheme: text(config.authScheme ?? config.auth_scheme) ?? "",
        connections: config.noOfConnections ?? config.no_of_connections ?? 0,
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
  query: Readonly<Record<string, string | undefined>>,
) {
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

  return response;
}

function listedToolkit(item: typeof RawToolkit.Type): ComposioListedToolkit | undefined {
  const slug = text(item.slug);
  const name = text(item.name);

  if (!slug || !name) return undefined;

  const description = text(item.meta?.description);
  const logo = text(item.meta?.logo);

  const categories = item.meta?.categories?.flatMap((category) => {
    const categoryName = text(category.name);

    return categoryName ? [{ name: categoryName }] : [];
  });

  const toolsCount = item.meta?.tools_count ?? item.meta?.toolsCount;

  return {
    slug,
    name,
    noAuth: item.no_auth === true || item.noAuth === true,
    meta: {
      ...(description ? { description } : {}),
      ...(logo ? { logo } : {}),
      ...(categories ? { categories } : {}),
      ...(toolsCount != null ? { toolsCount } : {}),
    },
  };
}

/** Up to 20 pages of one Composio REST list. */
async function listPages<Item>(
  apiKey: string,
  path: string,
  query: Readonly<Record<string, string | undefined>>,
  decodePage: (response: Awaited<ReturnType<typeof composioJson>>) => Promise<{
    readonly items?: ReadonlyArray<Item> | null | undefined;
    readonly next_cursor?: string | null | undefined;
    readonly nextCursor?: string | null | undefined;
  }>,
): Promise<ReadonlyArray<Item>> {
  const items: Item[] = [];
  let cursor: string | undefined;

  for (let index = 0; index < 20; index += 1) {
    const body = await decodePage(await composioJson(apiKey, path, { ...query, cursor }));
    const next = body.items ?? [];
    items.push(...next);
    cursor = text(body.next_cursor) ?? text(body.nextCursor);

    if (!cursor || next.length === 0) break;
  }

  return items;
}

export function createComposioClient(apiKey: string): ComposioClient {
  const sdk = new Composio({ apiKey });

  return {
    toolkits: {
      get: (...args) => sdk.toolkits.get(...args),
      getBySlug: async (slug) => decodeToolkitAuth(await sdk.toolkits.get(slug)),
      listCustom: async (userId) =>
        (
          await listPages(
            apiKey,
            "/toolkits",
            { type: "custom", user_id: userId, limit: "1000" },
            async (response) => decodeToolkitPage(await Effect.runPromise(response.json)),
          )
        ).flatMap((item) => {
          const toolkit = listedToolkit(item);

          return toolkit ? [toolkit] : [];
        }),
    },
    tools: {
      getRawComposioTools: (query) => sdk.tools.getRawComposioTools(query),
      listLatest: async (slug) =>
        (
          await listPages(
            apiKey,
            "/tools",
            { toolkit_slug: slug, toolkit_versions: "latest", limit: "1000" },
            async (response) => decodeToolPage(await Effect.runPromise(response.json)),
          )
        ).flatMap((tool) => {
          const toolSlug = text(tool.slug);
          const name = text(tool.name);
          const description = text(tool.description);

          if (!toolSlug || !name) return [];

          return [{ slug: toolSlug, name, ...(description ? { description } : {}) }];
        }),
    },
    connectedAccounts: {
      list: (...args) => sdk.connectedAccounts.list(...args),
      delete: (...args) => sdk.connectedAccounts.delete(...args),
      initiate: async (userId, authConfigId, options) =>
        connectRequest(
          // SAFETY: authScheme and the field names come from this toolkit's own Composio auth schemes;
          // the SDK types them as a literal union it cannot know for a runtime toolkit.
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
      list: async (query) =>
        decodeAuthConfigs(await sdk.authConfigs.list({ toolkit: query.toolkit, limit: 100 })),
      create: async (toolkit, options) => {
        // SAFETY: authScheme is one of this toolkit's own Composio auth schemes; the SDK types it as a
        // literal union it cannot know for a runtime toolkit.
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
