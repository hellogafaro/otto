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

type ComposioSdk = InstanceType<typeof Composio>;

type HostedSession = Awaited<ReturnType<ComposioSdk["sessions"]["create"]>>;

/** The part of the Composio SDK Otto uses, so tests can stand in for it. */
export type ComposioClient = {
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

export function createComposioClient(apiKey: string): ComposioClient {
  const sdk = new Composio({ apiKey });

  return {
    toolkits: { get: (...args) => sdk.toolkits.get(...args) },
    tools: { getRawComposioTools: (query) => sdk.tools.getRawComposioTools(query) },
    connectedAccounts: {
      list: (...args) => sdk.connectedAccounts.list(...args),
      delete: (...args) => sdk.connectedAccounts.delete(...args),
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
