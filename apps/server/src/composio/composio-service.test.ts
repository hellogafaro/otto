import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, vi } from "vite-plus/test";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";

import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { toClaudeMcpServers } from "../provider/mcp-server-config.ts";
import {
  composioAccountAlias,
  inMemoryComposioAccounts,
  make,
  sqlComposioAccounts,
} from "./composio-service.ts";

const viewer = { personId: "person-ana", displayName: "Ana" };

const ben = { personId: "person-ben", displayName: "Ben" };

type FakeAccount = {
  readonly id: string;
  readonly toolkit: { readonly slug: string };
  readonly status: "ACTIVE" | "FAILED" | "INITIATED";
  readonly alias?: string | null;
  readonly state?: unknown;
};

/** Composio's own rule: one alias per user and app. Everyone in Otto is that one user. */
function composioProject(accounts: FakeAccount[]) {
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

const noBot = { botId: null, ownerPersonId: null };

const botOwnedBy = (ownerPersonId: string) => ({ botId: `bot-${ownerPersonId}`, ownerPersonId });

function makeSecretStore(initial: Readonly<Record<string, string>> = {}) {
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

function fakeClient(input?: {
  readonly accounts?: ReadonlyArray<FakeAccount>;
  readonly toolkits?: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly meta: { readonly toolsCount?: number };
  }>;
  readonly tools?: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
  readonly authorize?: (
    toolkit: string,
    options?: { readonly alias?: string },
  ) => Promise<{
    readonly id: string;
    readonly redirectUrl?: string;
  }>;
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

  const client = {
    toolkits: { get: vi.fn(async () => input?.toolkits ?? []) },
    tools: { getRawComposioTools: vi.fn(async () => input?.tools ?? []) },
    connectedAccounts: {
      list: vi.fn(async () => ({ items: input?.accounts ?? [], totalPages: 1 })),
      delete: vi.fn(async () => ({})),
    },
    sessions: { create: createSession },
  };

  return { client, createSession, sessionDeletes };
}

describe("ComposioService", () => {
  it.effect("is off without COMPOSIO_API_KEY and never calls Composio", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const createClient = vi.fn(() => fakeClient().client);
      const service = make(store, inMemoryComposioAccounts(), "  ", createClient);

      expect(yield* service.isConfigured).toBe(false);
      expect(yield* service.getStatus(viewer)).toEqual({ configured: false, connections: [] });
      expect(createClient).not.toHaveBeenCalled();
    }),
  );
  it.effect("reads the status the SDK wraps under cause", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const { client } = fakeClient();
      vi.mocked(client.connectedAccounts.list).mockRejectedValueOnce(
        new Error("Failed to list accounts", {
          cause: Object.assign(new Error(), { status: 401 }),
        }),
      );
      const service = make(store, inMemoryComposioAccounts(), "bad-key", () => client);

      const error = yield* Effect.flip(service.getStatus(viewer));
      expect(error).toMatchObject({ message: "The Composio API key is invalid." });
    }),
  );

  it.effect("names an account by who it signed in as", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client } = fakeClient({
        accounts: [
          {
            id: "connection-gmail",
            toolkit: { slug: "gmail" },
            status: "ACTIVE",
            state: { authScheme: "OAUTH2", val: { displayName: "ana@example.com" } },
          },
          { id: "connection-slack", toolkit: { slug: "slack" }, status: "ACTIVE" },
        ],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      const status = yield* service.getStatus(viewer);

      expect(status.connections.map((connection) => connection.accountName)).toEqual([
        "ana@example.com",
        undefined,
      ]);
    }),
  );

  it.effect("loads one app with its tools", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client } = fakeClient({
        toolkits: [{ slug: "gmail", name: "Gmail", meta: { toolsCount: 1 } }],
        tools: [{ slug: "GMAIL_SEND_EMAIL", name: "Send email" }],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* service.getToolkit("gmail")).toEqual({
        toolkit: { slug: "gmail", name: "Gmail", categories: [], toolsCount: 1 },
        tools: [{ slug: "GMAIL_SEND_EMAIL", name: "Send email" }],
      });
      expect(client.tools.getRawComposioTools).toHaveBeenCalledWith({
        toolkits: ["gmail"],
        limit: 1000,
      });

      const missing = yield* Effect.flip(service.getToolkit("nope"));
      expect(missing.message).toBe("Composio could not load the app: Composio does not list nope.");
    }),
  );

  it.effect("deletes its hosted session after starting authorization", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const { client, sessionDeletes } = fakeClient();
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* service.authorize({ toolkitSlug: "gmail" }, viewer)).toEqual({
        connectionId: "connection-new",
        redirectUrl: "https://connect.composio.dev/link",
      });
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("deletes its hosted session when authorization fails", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, sessionDeletes } = fakeClient({
        authorize: () => Promise.reject(new Error("authorization failed")),
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* Effect.flip(service.authorize({ toolkitSlug: "gmail" }, viewer))).toMatchObject(
        {
          operation: "start account authorization",
          message: "Composio could not start account authorization: authorization failed",
        },
      );
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("deletes its hosted session when the authorization URL is missing", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, sessionDeletes } = fakeClient({
        authorize: async () => ({ id: "connection-new" }),
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* Effect.flip(service.authorize({ toolkitSlug: "gmail" }, viewer))).toMatchObject(
        {
          operation: "start account authorization",
          message:
            "Composio could not start account authorization: Composio did not return an authorization URL.",
        },
      );
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("retries failed authorization-session cleanup before authorizing again", () =>
    Effect.gen(function* () {
      let cleanupAttempt = 0;
      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        deleteSession: async () => {
          cleanupAttempt += 1;

          if (cleanupAttempt === 1) throw new Error("cleanup response was lost");

          if (cleanupAttempt === 2) {
            throw Object.assign(new Error("session not found"), { status: 404 });
          }
        },
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* Effect.flip(service.authorize({ toolkitSlug: "gmail" }, viewer))).toMatchObject(
        {
          operation: "start account authorization",
          message: "Composio could not start account authorization: cleanup response was lost",
        },
      );
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);

      expect(yield* service.authorize({ toolkitSlug: "gmail" }, viewer)).toEqual({
        connectionId: "connection-new",
        redirectUrl: "https://connect.composio.dev/link",
      });
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(2);
      expect(sessionDeletes[1]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("keeps multiple accounts and MCP headers in transient runtime state", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession } = fakeClient({
        accounts: [
          { id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE", alias: "Work" },
          { id: "gmail-home", toolkit: { slug: "gmail" }, status: "ACTIVE", alias: "Home" },
          { id: "slack-failed", toolkit: { slug: "slack" }, status: "FAILED" },
        ],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      const status = yield* service.getStatus(viewer);
      expect(status.connections).toHaveLength(3);

      const first = yield* service.resolveRuntimeMcpServer("thread-1", noBot);
      const cached = yield* service.resolveRuntimeMcpServer("thread-1", noBot);
      const secondThread = yield* service.resolveRuntimeMcpServer("thread-2", noBot);

      expect(first).toBe(cached);
      expect(secondThread).toBeDefined();
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(createSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          connectedAccounts: { gmail: ["gmail-work", "gmail-home"] },
          multiAccount: expect.objectContaining({ requireExplicitSelection: true }),
        }),
      );
      expect(toClaudeMcpServers([first!])).toEqual({
        "composio-session": {
          type: "http",
          url: "https://app.composio.dev/tool_router/v3/session/mcp",
          headers: { "x-api-key": "project-key" },
        },
      });
      expect(first).toEqual({
        id: "composio-session",
        name: "Composio",
        transport: "url",
        url: "https://app.composio.dev/tool_router/v3/session/mcp",
        enabled: true,
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }),
  );

  it.effect("never gives bots GitHub's merge or raw GraphQL tools", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession } = fakeClient({
        accounts: [{ id: "github-work", toolkit: { slug: "github" }, status: "ACTIVE" }],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      yield* service.getStatus(viewer);
      yield* service.resolveRuntimeMcpServer("thread-1", noBot);

      expect(createSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tools: {
            github: { disable: ["GITHUB_MERGE_A_PULL_REQUEST", "GITHUB_RUN_GRAPH_QL_QUERY"] },
          },
        }),
      );
    }),
  );

  it.effect("switches accounts per bot, lending a personal one only by its owner", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const ben = { personId: "person-ben", displayName: "Ben" };
      const bensBot = { botId: "bot-ben", ownerPersonId: ben.personId };

      const { client, createSession } = fakeClient({
        accounts: [
          { id: "connection-new", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "slack-team", toolkit: { slug: "slack" }, status: "ACTIVE" },
        ],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      yield* service.authorize({ toolkitSlug: "gmail" }, viewer);

      expect(yield* service.connectedToolkits(bensBot)).toEqual(["slack"]);

      yield* service.updateConnection(
        { connectionId: "slack-team", bot: { botId: bensBot.botId, enabled: false } },
        ben,
      );

      expect(yield* service.connectedToolkits(bensBot)).toEqual([]);
      expect(yield* service.connectedToolkits(botOwnedBy(ben.personId))).toEqual(["slack"]);

      const lend = { connectionId: "connection-new", bot: { botId: bensBot.botId, enabled: true } };
      expect((yield* Effect.flip(service.updateConnection(lend, ben))).message).toContain(
        "Only the person who connected",
      );

      const status = yield* service.updateConnection(lend, viewer);
      expect(status.connections[0]?.botAccess).toEqual({ [bensBot.botId]: true });
      expect(status.connections[0]?.visibility).toBe("user");
      expect(yield* service.connectedToolkits(bensBot)).toEqual(["gmail"]);

      yield* service.resolveRuntimeMcpServer("thread-ben", bensBot);
      expect(createSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ connectedAccounts: { gmail: ["connection-new"] } }),
      );
    }),
  );

  it.effect("keeps a personal account to its owner and the bots they own", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts = inMemoryComposioAccounts();
      const ben = { personId: "person-ben", displayName: "Ben" };

      const { client, createSession } = fakeClient({
        accounts: [
          { id: "connection-new", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "slack-team", toolkit: { slug: "slack" }, status: "ACTIVE" },
        ],
      });

      const service = make(store, accounts, "project-key", () => client);
      yield* service.authorize({ toolkitSlug: "gmail" }, viewer);

      const mine = yield* service.getStatus(viewer);
      expect(mine.connections.map((connection) => [connection.id, connection.visibility])).toEqual([
        ["connection-new", "user"],
        ["slack-team", "organization"],
      ]);

      const theirs = yield* service.getStatus(ben);
      expect(theirs.connections.map((connection) => connection.id)).toEqual(["slack-team"]);
      expect((yield* Effect.flip(service.disconnect("connection-new", ben))).message).toContain(
        "Only the person who connected",
      );

      yield* service.resolveRuntimeMcpServer("thread-1", botOwnedBy(viewer.personId));
      expect(createSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          connectedAccounts: { gmail: ["connection-new"], slack: ["slack-team"] },
          manageConnections: false,
        }),
      );

      yield* service.resolveRuntimeMcpServer("thread-2", botOwnedBy(ben.personId));
      expect(createSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ connectedAccounts: { slack: ["slack-team"] } }),
      );

      expect(yield* service.connectedToolkits(botOwnedBy(viewer.personId))).toEqual([
        "gmail",
        "slack",
      ]);
      expect(yield* service.connectedToolkits(botOwnedBy(ben.personId))).toEqual(["slack"]);

      yield* service.resolveRuntimeMcpServer("thread-3", noBot);
      expect(createSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ connectedAccounts: { slack: ["slack-team"] } }),
      );

      const shared = yield* service.updateConnection(
        { connectionId: "connection-new", visibility: "organization" },
        viewer,
      );

      expect(shared.connections[0]?.visibility).toBe("organization");

      expect((yield* service.getStatus(ben)).connections.map((c) => c.id)).toEqual([
        "connection-new",
        "slack-team",
      ]);
    }),
  );

  it.effect("reuses a hosted runtime when account and toolkit order changes", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        accounts: [
          { id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "slack-work", toolkit: { slug: "slack" }, status: "ACTIVE" },
          { id: "gmail-home", toolkit: { slug: "gmail" }, status: "ACTIVE" },
        ],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      const first = yield* service.resolveRuntimeMcpServer("thread-1", noBot);
      vi.mocked(client.connectedAccounts.list).mockResolvedValue({
        items: [
          { id: "gmail-home", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "slack-work", toolkit: { slug: "slack" }, status: "ACTIVE" },
        ],
        totalPages: 1,
      } as never);
      const reordered = yield* service.resolveRuntimeMcpServer("thread-1", noBot);

      expect(reordered).toBe(first);
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(sessionDeletes[0]).not.toHaveBeenCalled();
    }),
  );

  it.effect("replaces a hosted runtime when active account status changes", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        accounts: [
          { id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "gmail-home", toolkit: { slug: "gmail" }, status: "ACTIVE" },
        ],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      yield* service.resolveRuntimeMcpServer("thread-1", noBot);
      vi.mocked(client.connectedAccounts.list).mockResolvedValue({
        items: [
          { id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" },
          { id: "gmail-home", toolkit: { slug: "gmail" }, status: "FAILED" },
        ],
        totalPages: 1,
      } as never);
      yield* service.resolveRuntimeMcpServer("thread-1", noBot);

      expect(createSession).toHaveBeenCalledTimes(2);
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
      expect(sessionDeletes[1]).not.toHaveBeenCalled();
    }),
  );

  it.effect("deletes a hosted session before replacing its cached runtime", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        accounts: [{ id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      yield* service.resolveRuntimeMcpServer("thread-1", noBot);
      vi.mocked(client.connectedAccounts.list).mockResolvedValue({
        items: [{ id: "slack-work", toolkit: { slug: "slack" }, status: "ACTIVE" }],
        totalPages: 1,
      } as never);
      yield* service.resolveRuntimeMcpServer("thread-1", noBot);

      expect(createSession).toHaveBeenCalledTimes(2);
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
      expect(sessionDeletes[1]).not.toHaveBeenCalled();
    }),
  );

  it.effect("deletes the oldest hosted session before LRU eviction", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        accounts: [{ id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      for (let index = 0; index <= 100; index += 1) {
        yield* service.resolveRuntimeMcpServer(`thread-${index}`, noBot);
      }

      expect(createSession).toHaveBeenCalledTimes(101);
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
      expect(sessionDeletes[1]).not.toHaveBeenCalled();
    }),
  );

  it.effect("deletes a runtime session created while an account is disconnected", () =>
    Effect.gen(function* () {
      let releaseSessionCreation!: () => void;

      const sessionCreationGate = new Promise<void>((resolve) => {
        releaseSessionCreation = resolve;
      });

      const { store } = makeSecretStore();

      const { client, createSession, sessionDeletes } = fakeClient({
        accounts: [{ id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
        sessionCreationGate,
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      const resolving = yield* Effect.forkChild(service.resolveRuntimeMcpServer("thread-1", noBot));
      yield* Effect.promise(() => vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1)));
      yield* service.disconnect("gmail-work", viewer);
      releaseSessionCreation();

      expect(yield* Fiber.join(resolving)).toBeUndefined();
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("shares concurrent runtime resolution for the same resource", () =>
    Effect.gen(function* () {
      let releaseSessionCreation!: () => void;

      const sessionCreationGate = new Promise<void>((resolve) => {
        releaseSessionCreation = resolve;
      });

      const { store } = makeSecretStore();

      const { client, createSession } = fakeClient({
        accounts: [{ id: "gmail-work", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
        sessionCreationGate,
      });

      const createClient = vi.fn(() => client);
      const service = make(store, inMemoryComposioAccounts(), "project-key", createClient);

      const first = yield* Effect.forkChild(service.resolveRuntimeMcpServer("thread-1", noBot));
      yield* Effect.promise(() => vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1)));
      const second = yield* Effect.forkChild(service.resolveRuntimeMcpServer("thread-1", noBot));
      yield* Effect.promise(() => vi.waitFor(() => expect(createClient).toHaveBeenCalledTimes(2)));
      releaseSessionCreation();

      expect(yield* Fiber.join(first)).toBe(yield* Fiber.join(second));
      expect(createSession).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("lets two people use the same label, each under their own Composio alias", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts: FakeAccount[] = [];

      const { client } = fakeClient({
        accounts,
        toolkits: [{ slug: "gmail", name: "Gmail", meta: {} }],
        authorize: composioProject(accounts),
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      const otherAna = { personId: "person-ana-2", displayName: "Ana" };

      yield* service.authorize({ toolkitSlug: "gmail", alias: "Work" }, viewer);
      yield* service.authorize(
        { toolkitSlug: "gmail", alias: "Work", visibility: "organization" },
        ben,
      );
      yield* service.authorize({ toolkitSlug: "gmail", alias: "Work" }, otherAna);

      const aliases = accounts.map((account) => account.alias);
      expect(aliases).toEqual([
        composioAccountAlias(viewer, "Work"),
        composioAccountAlias(ben, "Work"),
        composioAccountAlias(otherAna, "Work"),
      ]);
      expect(new Set(aliases).size).toBe(3);
      expect(aliases[0]).toMatch(/^Ana · Work · [0-9a-f]{6}$/);
      expect(aliases[1]).toMatch(/^Ben · Work · [0-9a-f]{6}$/);

      const anaSees = yield* service.getStatus(viewer);
      expect(
        anaSees.connections.map((connection) => [connection.alias, connection.ownerName]),
      ).toEqual([
        ["Work", undefined],
        ["Work", "Ben"],
      ]);
    }),
  );

  it.effect("refuses a label the person already uses for that app, before calling Composio", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts: FakeAccount[] = [];

      const { client, createSession } = fakeClient({
        accounts,
        toolkits: [{ slug: "gmail", name: "Gmail", meta: {} }],
        authorize: composioProject(accounts),
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      yield* service.authorize({ toolkitSlug: "gmail", alias: "Work" }, viewer);
      yield* service.authorize({ toolkitSlug: "slack", alias: "Work" }, viewer);

      const error = yield* Effect.flip(
        service.authorize({ toolkitSlug: "gmail", alias: "work" }, viewer),
      );

      expect(error).toMatchObject({
        _tag: "ComposioLabelTakenError",
        toolkitSlug: "gmail",
        label: "work",
        message: "You already have an account called work for Gmail.",
      });
      expect(createSession).toHaveBeenCalledTimes(2);
    }),
  );

  it.effect("reports Composio's own alias conflict as a taken label", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client, sessionDeletes } = fakeClient({
        authorize: () =>
          Promise.reject(Object.assign(new Error("duplicate alias"), { status: 409 })),
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(
        yield* Effect.flip(service.authorize({ toolkitSlug: "gmail", alias: "Work" }, viewer)),
      ).toMatchObject({
        _tag: "ComposioLabelTakenError",
        message: "You already have an account called Work for gmail.",
      });
      expect(sessionDeletes[0]).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("keeps showing and guarding older accounts' bare aliases", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const records = inMemoryComposioAccounts();

      const accounts: FakeAccount[] = [
        {
          id: "gmail-legacy",
          toolkit: { slug: "gmail" },
          status: "ACTIVE",
          alias: "ana@example.com",
        },
        {
          id: "gmail-unowned",
          toolkit: { slug: "gmail" },
          status: "ACTIVE",
          alias: "team@example.com",
        },
      ];

      yield* records.save({
        connectionId: "gmail-legacy",
        createdBy: viewer.personId,
        createdByName: viewer.displayName,
        label: null,
        visibility: "user",
        botAccess: {},
      });

      const { client, createSession } = fakeClient({
        accounts,
        authorize: composioProject(accounts),
      });

      const service = make(store, records, "project-key", () => client);

      expect(
        (yield* service.getStatus(viewer)).connections.map((connection) => connection.alias),
      ).toEqual(["ana@example.com", "team@example.com"]);

      expect(
        yield* Effect.flip(
          service.authorize({ toolkitSlug: "gmail", alias: "ana@example.com" }, viewer),
        ),
      ).toMatchObject({ _tag: "ComposioLabelTakenError", label: "ana@example.com" });

      yield* service.authorize({ toolkitSlug: "gmail", alias: "team@example.com" }, viewer);

      yield* service.resolveRuntimeMcpServer("thread-1", botOwnedBy(viewer.personId));
      expect(createSession).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          connectedAccounts: { gmail: ["gmail-legacy", "gmail-unowned"] },
        }),
      );
    }),
  );

  it.effect("stores the person's label in SQLite and reads older rows without one", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const records = yield* sqlComposioAccounts;

      yield* sql`
        INSERT INTO composio_accounts (connection_id, created_by, created_by_name, visibility, created_at)
        VALUES ('gmail-legacy', NULL, NULL, 'organization', '2026-01-01T00:00:00.000Z')
      `;

      const record = {
        connectionId: "gmail-work",
        createdBy: viewer.personId,
        createdByName: viewer.displayName,
        label: "Work",
        visibility: "user" as const,
        botAccess: {},
      };

      yield* records.save(record);
      yield* records.save({ ...record, label: null, visibility: "organization" });

      expect(yield* records.list).toEqual([
        {
          connectionId: "gmail-legacy",
          createdBy: null,
          createdByName: null,
          label: null,
          visibility: "organization",
          botAccess: {},
        },
        { ...record, visibility: "organization" },
      ]);
    }).pipe(Effect.provide(Layer.fresh(SqlitePersistenceMemory))),
  );
});
