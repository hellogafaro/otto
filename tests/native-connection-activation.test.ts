import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  getChatAudience,
} from "../packages/chats/src";
import {
  createConnection,
  getConnection,
  updateConnection,
} from "../packages/connections/src";
import { connections, grants } from "../packages/connections/src/schema";
import { MCP_PROTOCOL_VERSION } from "../packages/connections/src/server";
import { createEnvironment } from "../packages/environments/src";
import { snapshotRunDocuments } from "../packages/library/src";
import { createRunAction, getRunActions } from "../packages/runs/src/actions";
import { type Attempt, withRunAttempt } from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("human-approved native MCP activation", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let api: Bun.Server<undefined>;
  let peer: Bun.Server<undefined>;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let sponsor: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let methods: string[] = [];
  let failing = "";
  let revoke: (() => Promise<void>) | undefined;
  let secretReads = 0;
  const scope = <T>(
    work: Parameters<typeof inWorkspace<T>>[3],
    userId = sponsor.id,
  ) => inWorkspace(database.db, workspaceId, { userId }, work);

  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    peer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        expect(request.headers.has("authorization")).toBe(false);
        if (request.method === "DELETE") {
          methods.push("DELETE");
          return new Response(null, { status: 204 });
        }
        const input = (await request.json()) as { id?: number; method: string };
        methods.push(input.method);
        if (input.method === failing)
          return new Response(null, { status: 503 });
        if (input.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        if (input.method === "tools/list") await revoke?.();
        const result =
          input.method === "initialize"
            ? {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "controlled", version: "1" },
              }
            : {
                tools: [
                  {
                    name: "search",
                    inputSchema: {
                      type: "object",
                      properties: { query: { type: "string" } },
                      required: ["query"],
                    },
                    annotations: { readOnlyHint: true },
                  },
                ],
              };
        return Response.json(
          { jsonrpc: "2.0", id: input.id, result },
          { headers: { "Mcp-Session-Id": "controlled-activation" } },
        );
      },
    });
    api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      api.url.origin,
    );
    app = createApp({
      db: database.db,
      boss,
      auth,
      nativeStorage: native,
      origin: api.url.origin,
      connections: {
        allowAnonymousMcp: true,
        http: {
          allowedOrigins: [peer.url.origin],
          allowLoopbackHttp: true,
          timeoutMs: 1000,
        },
        secrets: {
          resolve: async () => {
            secretReads++;
            throw new Error("No credentials in fixture");
          },
        },
      },
    });
    const signup = async (name: string) => {
      const response = await fetch(`${api.url.origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin: api.url.origin, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: `${name}@activation.example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      return {
        id: ((await response.json()) as { user: { id: string } }).user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    };
    sponsor = await signup("sponsor");
    other = await signup("other");
    workspaceId = (
      await claimInstallation(database.db, sponsor.id, "Activation fixture")
    ).id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other.id, role: "admin" });
  });
  afterAll(async () => {
    await api?.stop(true);
    await peer?.stop(true);
    await native?.close();
    await boss?.stop();
    await database?.stop();
    expect(existsSync(database.directory)).toBe(false);
  });
  beforeEach(() => {
    methods = [];
    failing = "";
    revoke = undefined;
    secretReads = 0;
  });

  async function fixture(type: "mcp" | "github" = "mcp", creator = sponsor.id) {
    const connection = await scope(async (c) => {
      const created = await createConnection(c, {
        title: "Controlled",
        type,
        accountRef: "fixture",
        visibility: "workspace",
      });
      return type === "mcp"
        ? updateConnection(c, created.id, {
            editToken: created.editToken,
            config: {
              type: "mcp",
              endpoint: peer.url.href,
              authentication: "none",
              tools: [
                { name: "search", targetArgument: "query", readOnly: true },
              ],
              resources: ["fixture query"],
            },
          })
        : created;
    }, creator);
    const attempt = await scope(async (c) => {
      const agent = await createAgent(c, {
        title: "Proposing",
        instructions: "Controlled no-model fixture",
        model: "fixture",
        visibility: "workspace",
      });
      const environment = await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Approval",
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const [run] = await c.tx
        .insert(runs)
        .values({
          workspaceId,
          chatId: chat.id,
          agentId: agent.id,
          sponsorId: sponsor.id,
          environmentId: environment.id,
          environmentGeneration: environment.generation,
          requestId: crypto.randomUUID(),
          type: "script",
          state: "running",
          attempt: 1,
          deadlineAt: new Date(Date.now() + 120000),
          cursor: 0,
          inputs: {
            body: "Fixture",
            instructions: agent.instructions,
            provider: null,
            model: agent.model,
            subscriptionId: null,
            accountId: null,
            modelConfig: null,
            agentEditToken: agent.editToken,
            audience: await getChatAudience(c, chat.id),
            skills: [],
            grants: [],
          },
        })
        .returning();
      if (!run) throw new Error("Missing fixture Run");
      return {
        runId: run.id,
        agentId: run.agentId,
        attempt: run.attempt,
        launchKey: run.launchKey,
      } satisfies Attempt;
    });
    const action = await withRunAttempt(
      database.db,
      attempt,
      (c, run) =>
        createRunAction(
          c,
          run,
          {
            toolCallId: crypto.randomUUID(),
            input: {
              type: "connection.activate",
              id: connection.id,
              editToken: connection.editToken,
            },
          },
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        ),
      undefined,
      native,
      authorizeRunSources,
      snapshotRunDocuments,
    );
    return { connection, attempt, action };
  }
  async function approve(
    f: Awaited<ReturnType<typeof fixture>>,
    cookie = sponsor.cookie,
    digest = f.action.digest,
  ) {
    return fetch(
      `${api.url.origin}/api/workspaces/${workspaceId}/runs/${f.attempt.runId}/actions/${f.action.id}/resolve`,
      {
        method: "POST",
        headers: {
          origin: api.url.origin,
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ decision: "approve", digest }),
      },
    );
  }
  async function assertInactive(f: Awaited<ReturnType<typeof fixture>>) {
    expect(
      (await scope((c) => getConnection(c, f.connection.id))).connected,
    ).toBe(false);
    expect(
      (await scope((c) => getRunActions(c, f.attempt.runId))).items[0]?.status,
    ).toBe("pending");
    expect(
      await database.db
        .select()
        .from(grants)
        .where(eq(grants.connectionId, f.connection.id)),
    ).toEqual([]);
  }
  it("activates and caches discovery under exact human approval, cleans session, grants nothing and replays without reconnect", async () => {
    const f = await fixture();
    expect((await approve(f)).status).toBe(200);
    expect(
      (await scope((c) => getConnection(c, f.connection.id))).connected,
    ).toBe(true);
    const [saved] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, f.connection.id));
    expect(saved?.discovery?.actions).toContain("tool.search");
    expect(methods).toContain("DELETE");
    expect(methods).not.toContain("tools/call");
    expect(secretReads).toBe(0);
    expect(
      await database.db
        .select()
        .from(grants)
        .where(eq(grants.connectionId, f.connection.id)),
    ).toEqual([]);
    const count = methods.length;
    expect((await approve(f)).status).toBe(200);
    expect(methods.length).toBe(count);
    const details = await fetch(
      `${api.url.origin}/api/workspaces/${workspaceId}/connections/${f.connection.id}/details`,
      { headers: { cookie: sponsor.cookie } },
    );
    expect(details.status).toBe(200);
    expect(
      ((await details.json()) as { observation: string }).observation,
    ).toBe("cached");
    expect(methods.length).toBe(count);
  });
  it.each(["initialize", "tools/list"])(
    "rolls back failed %s without activation or grants",
    async (method) => {
      const f = await fixture();
      failing = method;
      expect((await approve(f)).status).not.toBe(200);
      await assertInactive(f);
      if (method === "tools/list") expect(methods).toContain("DELETE");
    },
  );
  it("rejects stale configuration approval before remote work", async () => {
    const f = await fixture();
    await scope((c) =>
      updateConnection(c, f.connection.id, {
        editToken: f.connection.editToken,
        visibility: "user",
      }),
    );
    expect((await approve(f)).status).toBe(409);
    expect(methods).toEqual([]);
    await assertInactive(f);
  });
  it("rejects wrong sponsor, creator, digest and viewer before remote work", async () => {
    const f = await fixture();
    expect((await approve(f, other.cookie)).status).toBe(403);
    expect((await approve(f, sponsor.cookie, "0".repeat(64))).status).toBe(409);
    const foreignCreator = await fixture("mcp", other.id);
    expect((await approve(foreignCreator)).status).toBe(403);
    await database.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, sponsor.id),
        ),
      );
    try {
      expect((await approve(f)).status).toBe(403);
    } finally {
      await database.db
        .update(members)
        .set({ role: "owner" })
        .where(
          and(
            eq(members.workspaceId, workspaceId),
            eq(members.userId, sponsor.id),
          ),
        );
    }
    expect(methods).toEqual([]);
    await assertInactive(f);
  });
  it("rechecks revocation after handshake and rolls back cache while closing the remote session", async () => {
    const f = await fixture();
    revoke = async () => {
      await database.db
        .update(runs)
        .set({ stopRequested: true })
        .where(eq(runs.id, f.attempt.runId));
    };
    expect((await approve(f)).status).toBe(403);
    await assertInactive(f);
    expect(methods).toContain("DELETE");
  });
  it("rejects a changed Connection fence during discovery before committing activation", async () => {
    const f = await fixture();
    revoke = async () => {
      await database.db
        .update(connections)
        .set({ editToken: f.connection.editToken + 1 })
        .where(eq(connections.id, f.connection.id));
    };
    expect((await approve(f)).status).toBe(409);
    await assertInactive(f);
    expect(methods).toContain("DELETE");
  });
  it("rejects GitHub as explicitly unsupported before credentials or remote work", async () => {
    const f = await fixture("github");
    expect((await approve(f)).status).toBe(503);
    expect(methods).toEqual([]);
    expect(secretReads).toBe(0);
    await assertInactive(f);
  });
});
