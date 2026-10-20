import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import type { ServerSecretStore } from "../../auth/server-secret-store.ts";
import type { ComposioAuthConfigs, ComposioToolkitAuth } from "../composio-client.ts";

export const viewer = { personId: "person-ana", displayName: "Ana" };

export const ben = { personId: "person-ben", displayName: "Ben" };

export type FakeAccount = {
  readonly id: string;
  readonly toolkit: { readonly slug: string };
  readonly status: "ACTIVE" | "FAILED" | "INITIATED";
  readonly alias?: string | null;
  readonly state?: unknown;
};

/** Composio's own rule: one alias per user and app. Everyone in Otto is that one user. */
export function composioProject(accounts: FakeAccount[]) {
  return async (toolkit: string, options?: { readonly alias?: string }) => {
    if (
      options?.alias !== undefined &&
      accounts.some(
        (account) => account.toolkit.slug === toolkit && account.alias === options.alias,
      )
    ) {
      throw Object.assign(new Error("Alias already exists for this user and toolkit"), {
        status: 409,
      });
    }

    const id = `connection-${accounts.length + 1}`;
    accounts.push({
      id,
      toolkit: { slug: toolkit },
      status: "INITIATED",
      alias: options?.alias ?? null,
    });

    return { id, redirectUrl: "https://connect.composio.dev/link" };
  };
}

export const noBot = { botId: null, ownerPersonId: null };

export const botOwnedBy = (ownerPersonId: string) => ({
  botId: `bot-${ownerPersonId}`,
  ownerPersonId,
});

export function makeSecretStore(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(
    Object.entries(initial).map(([name, value]) => [name, new TextEncoder().encode(value)]),
  );

  const store = {
    get: (name: string) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name: string, value: Uint8Array) =>
      Effect.sync(() => void values.set(name, new Uint8Array(value))),
    create: (name: string, value: Uint8Array) =>
      Effect.sync(() => void values.set(name, new Uint8Array(value))),
    getOrCreateRandom: (name: string, bytes: number) =>
      Effect.sync(() => {
        const existing = values.get(name);

        if (existing) return existing;
        const value = new Uint8Array(bytes).fill(7);
        values.set(name, value);

        return value;
      }),
    remove: (name: string) => Effect.sync(() => void values.delete(name)),
  } satisfies ServerSecretStore["Service"];

  return { store, values };
}

export function fakeClient(input?: {
  readonly accounts?: ReadonlyArray<FakeAccount>;
  readonly toolkits?: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly noAuth?: boolean;
    readonly meta: {
      readonly description?: string;
      readonly logo?: string;
      readonly toolsCount?: number;
      readonly categories?: ReadonlyArray<{ readonly name: string }>;
    };
  }>;
  readonly customToolkits?: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly noAuth?: boolean;
    readonly meta: {
      readonly description?: string;
      readonly logo?: string;
      readonly toolsCount?: number;
    };
  }>;
  readonly tools?: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
  readonly latestTools?: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly description?: string;
  }>;
  readonly triggerTypes?: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly config?: object;
  }>;
  readonly authorize?: (
    toolkit: string,
    options?: { readonly alias?: string },
  ) => Promise<{
    readonly id: string;
    readonly redirectUrl?: string;
  }>;
  readonly toolkitAuth?: ComposioToolkitAuth;
  readonly authConfigs?: ComposioAuthConfigs;
  readonly deleteSession?: () => Promise<void>;
  readonly sessionCreationGate?: Promise<void>;
  readonly sessionCreationGates?: readonly Promise<void>[];
}) {
  const sessionDeletes: Array<ReturnType<typeof vi.fn<() => Promise<void>>>> = [];

  const createSession = vi.fn(async () => {
    await (input?.sessionCreationGates?.[createSession.mock.calls.length - 1] ??
      input?.sessionCreationGate);
    const deleteSession = vi.fn(input?.deleteSession ?? (async () => undefined));
    sessionDeletes.push(deleteSession);

    return {
      mcp: {
        url: "https://app.composio.dev/tool_router/v3/session/mcp",
        headers: { "x-api-key": "project-key" },
      },
      authorize: vi.fn(
        input?.authorize ??
          (async () => ({
            id: "connection-new",
            redirectUrl: "https://connect.composio.dev/link",
          })),
      ),
      delete: deleteSession,
    };
  });

  /** Composio's trigger instances on the project, as listActive reports them. */
  const triggers: Array<{
    id: string;
    connectedAccountId: string;
    triggerName: string;
    disabledAt: string | null;
  }> = [];

  const setDisabledAt = (triggerId: string, disabledAt: string | null) => {
    const trigger = triggers.find((candidate) => candidate.id === triggerId);

    if (!trigger) throw Object.assign(new Error("Trigger not found"), { status: 404 });
    trigger.disabledAt = disabledAt;
  };

  const client = {
    toolkits: {
      get: vi.fn(async () => input?.toolkits ?? []),
      getBySlug: vi.fn(
        async () =>
          input?.toolkitAuth ?? {
            composioManagedAuthSchemes: ["OAUTH2"],
            authConfigDetails: [],
          },
      ),
      listCustom: vi.fn(async () => input?.customToolkits ?? []),
    },
    tools: {
      getRawComposioTools: vi.fn(async () => input?.tools ?? []),
      listLatest: vi.fn(async () => input?.latestTools ?? input?.tools ?? []),
    },
    connectedAccounts: {
      list: vi.fn(async () => ({ items: input?.accounts ?? [], totalPages: 1 })),
      delete: vi.fn(async () => ({})),
      initiate: vi.fn(
        async (): Promise<{
          id: string;
          redirectUrl?: string | null;
          status?: string | null;
        }> => ({
          id: "connection-initiated",
          redirectUrl: "https://connect.composio.dev/link",
          status: "INITIATED",
        }),
      ),
      link: vi.fn(async () => ({
        id: "connection-linked",
        redirectUrl: "https://connect.composio.dev/link",
      })),
    },
    authConfigs: {
      list: vi.fn(async () => input?.authConfigs ?? { items: [] }),
      create: vi.fn(async () => ({ id: "ac_created" })),
    },
    triggers: {
      listTypes: vi.fn(async () => ({ items: input?.triggerTypes ?? [] })),
      listActive: vi.fn(async (query: { readonly connectedAccountIds: string[] }) => ({
        items: triggers.filter((trigger) =>
          query.connectedAccountIds.includes(trigger.connectedAccountId),
        ),
        nextCursor: null,
      })),
      create: vi.fn(
        async (_userId: string, slug: string, body: { readonly connectedAccountId: string }) => {
          const id = `trigger-${triggers.length + 1}`;
          triggers.push({
            id,
            connectedAccountId: body.connectedAccountId,
            triggerName: slug,
            disabledAt: null,
          });

          return { triggerId: id };
        },
      ),
      enable: vi.fn(async (triggerId: string) => {
        setDisabledAt(triggerId, null);

        return {};
      }),
      disable: vi.fn(async (triggerId: string) => {
        setDisabledAt(triggerId, "2026-10-18T00:00:00.000Z");

        return {};
      }),
      delete: vi.fn(async (triggerId: string) => {
        const index = triggers.findIndex((candidate) => candidate.id === triggerId);

        if (index === -1) throw Object.assign(new Error("Trigger not found"), { status: 404 });
        triggers.splice(index, 1);

        return {};
      }),
      setWebhookSubscription: vi.fn(async () => ({ id: "subscription-1", secret: "whsec-1" })),
      // Composio signs the id, timestamp and body with the secret; the fake signs the secret.
      verifyWebhook: vi.fn(
        async (params: { readonly payload: string; secret: string; signature: string }) => {
          if (params.signature !== `v1,${params.secret}`) throw new Error("Invalid signature");

          return { payload: JSON.parse(params.payload) as { id: string } };
        },
      ),
    },
    sessions: { create: createSession },
  };

  return { client, createSession, sessionDeletes, triggers };
}
