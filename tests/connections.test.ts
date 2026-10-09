import { generateKeyPairSync, verify } from "node:crypto";
import { DomainError, required } from "@otto/shared";
import { and, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  getChatAudience,
} from "../packages/chats/src";
import { messages } from "../packages/chats/src/schema";
import {
  approveOperation,
  createConnection,
  denyOperation,
  disconnectConnection,
  getConnection,
  getConnections,
  getOperation,
  getOperations,
  grantConnectionAccess,
  recoverOperations,
  retryOperation,
  revokeConnectionAccess,
  snapshotGrants,
  updateConnection,
} from "../packages/connections/src";
import {
  connections,
  grants,
  operations,
} from "../packages/connections/src/schema";
import {
  type ConnectionBoundary,
  createConnectionService,
  createInfisicalResolver,
  type InfisicalBinding,
  MCP_PROTOCOL_VERSION,
  recoverConnectionOperations,
} from "../packages/connections/src/server";
import type {
  ConnectionConfig,
  OperationRequest,
} from "../packages/connections/src/types";
import { createEnvironment } from "../packages/environments/src";
import { environments } from "../packages/environments/src/schema";
import { admitRun } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import {
  createSubscription,
  getSubscription,
} from "../packages/subscriptions/src";
import {
  type Context,
  claimInstallation,
  deleteMember,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

/** Controlled public test data only. This qualifies Otto HTTP/PG behavior, not GitHub/Infisical/MCP provider authentication. */
describe("Connections production adapters with private PostgreSQL and controlled HTTP peers", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let server: ReturnType<typeof Bun.serve>;
  let workspaceId: string;
  let agentId: string;
  let environmentId: string;
  let chatId: string;
  let runId: string;
  let launchKey: string;
  let connectionId: string;
  let service: ReturnType<typeof createConnectionService>;
  let boundary: ConnectionBoundary;
  const bindings: InfisicalBinding[] = [];
  let requests: string[] = [];
  let issueWrites = 0;
  let mcpWrites = 0;
  let providerIssues = "write";
  let tokenExpired = false;
  let accountChanged = false;
  let repositoryChanged = false;
  let mcpVersion = MCP_PROTOCOL_VERSION;
  let mcpDeleteStatus = 204;
  let mcpSessionLost = false;
  let largeOutput = false;
  let echoCredential = false;
  let loseResponse = false;
  let sse = false;
  let protocolVerified = false;
  let beforeResponse: (() => Promise<void>) | undefined;
  let denyPublication = false;
  // Ephemeral signing material is generated in memory for the private fixture and never saved or printed.
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const fixtureKey = keyPair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const githubConfig: ConnectionConfig = {
    type: "github",
    appId: "fixture-app",
    installationId: 7,
    accountId: 11,
    repositories: [{ id: 17, name: "fixture/repo" }],
    permissions: { issues: "write" },
  };
  const scope = <T>(work: (c: Context) => Promise<T>) =>
    inWorkspace(database.db, workspaceId, { userId: "owner" }, work);
  const http = () => ({
    allowedOrigins: [server.url.origin],
    allowLoopbackHttp: true,
    timeoutMs: 1000,
  });
  const secretResolver = () =>
    createInfisicalResolver({
      endpoint: server.url.origin,
      bindings,
      getAccessToken: async () => "public-fixture-manager",
      http: http(),
    });
  const makeService = () =>
    createConnectionService({
      boundary,
      secrets: secretResolver(),
      http: http(),
      githubEndpoint: server.url.origin,
    });
  async function makeConnection(config = githubConfig) {
    const row = await scope((c) =>
      createConnection(c, {
        title: "Controlled fixture account",
        type: config.type,

        accountRef:
          config.type === "github" ? "github:11:7" : "fixture-mcp-account",
      }),
    );
    bindings.push({
      workspaceId,
      connectionId: row.id,
      credentialRef: "fixture-reference",
      projectId: "public-fixture-project",
      environment: "test",
      secretPath: "/connections",
      secretName: config.type === "github" ? "FIXTURE_GITHUB" : "FIXTURE_MCP",
    });
    await scope((c) =>
      updateConnection(c, row.id, {
        editToken: row.editToken,
        title: row.title,
        credentialRef: "fixture-reference",
        config,
      }),
    );
    await service.connectConnection(row.id);
    return row.id;
  }
  const grant = (
    id = connectionId,
    policy: "allowed" | "confirmation" = "confirmation",
  ) =>
    scope((c) =>
      grantConnectionAccess(c, id, {
        agentId,
        audience: { humans: ["owner"], agents: [agentId] },
        resources: ["fixture/repo"],
        operations: {
          "repository.read": "allowed",
          "issues.read": "allowed",
          "issues.create": policy,
        },
      }),
    );
  const request = (
    patch: Partial<OperationRequest> = {},
  ): OperationRequest => ({
    connectionId,
    runId,
    launchKey,
    attempt: 0,
    environmentGeneration: 0,
    requestId: crypto.randomUUID(),
    action: "issues.create",
    target: "fixture/repo",
    arguments: { title: "Fixture issue", body: "Public fixture data" },
    ...patch,
  });
  async function approved(input = request()) {
    const row = await service.requestOperation(input);
    await scope((c) =>
      approveOperation(
        c,
        row.id,
        { identity: required(row.identity ?? undefined) },
        boundary.validateRun,
      ),
    );
    return row;
  }
  beforeAll(async () => {
    expect(process.versions.bun).toBeTruthy();
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        requests.push(`${req.method} ${url.pathname}`);
        if (url.pathname.startsWith("/api/v4/secrets/")) {
          expect(url.searchParams.get("projectId")).toBe(
            "public-fixture-project",
          );
          expect(url.searchParams.get("environment")).toBe("test");
          expect(url.searchParams.get("secretPath")).toBe("/connections");
          expect(url.searchParams.get("expandSecretReferences")).toBe("false");
          expect(url.searchParams.get("includeImports")).toBe("false");
          return Response.json({
            secret: {
              secretValue: url.pathname.endsWith("FIXTURE_GITHUB")
                ? fixtureKey
                : "public-fixture-mcp",
            },
          });
        }
        if (url.pathname.startsWith("/app/installations/")) {
          expect(req.headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
          const jwt = (req.headers.get("Authorization") ?? "")
            .slice(7)
            .split(".");
          const signature = jwt[2];
          if (
            !signature ||
            !verify(
              "RSA-SHA256",
              Buffer.from(`${jwt[0]}.${jwt[1]}`),
              keyPair.publicKey,
              Buffer.from(signature, "base64url"),
            )
          )
            return new Response(null, { status: 401 });
          if (url.pathname.endsWith("/access_tokens")) {
            const body = z
              .object({
                repository_ids: z.array(z.number()),
                permissions: z.object({ issues: z.literal("write") }),
              })
              .parse(await req.json());
            expect(body.repository_ids).toEqual([17]);
            return Response.json({
              token: "public-fixture-installation",
              expires_at: new Date(
                Date.now() + (tokenExpired ? -1000 : 3600000),
              ).toISOString(),
              permissions: { issues: providerIssues },
            });
          }
          return Response.json({
            id: 7,
            account: { id: accountChanged ? 12 : 11 },
            repository_selection: "selected",
          });
        }
        if (url.pathname === "/installation/repositories")
          return Response.json({
            total_count: 1,
            repositories: [
              { id: repositoryChanged ? 18 : 17, full_name: "fixture/repo" },
            ],
          });
        if (url.pathname.startsWith("/repos/")) {
          if (req.method === "POST") issueWrites++;
          await beforeResponse?.();
          if (loseResponse)
            return new Response("lost acknowledgement", { status: 502 });
          if (largeOutput)
            return Response.json({ description: "x".repeat(300000) });
          if (url.pathname.endsWith("/issues")) {
            const issue = {
              number: 1,
              title: echoCredential
                ? "public-fixture-installation"
                : "Fixture issue",
              body: "Public fixture data",
              html_url: "https://example.test/issues/1",
            };
            return Response.json(req.method === "POST" ? issue : [issue]);
          }
          return Response.json({
            full_name: "fixture/repo",
            html_url: "https://example.test/repo",
            description: "Public fixture",
          });
        }
        if (url.pathname === "/mcp") {
          if (req.method === "DELETE")
            return new Response(null, { status: mcpDeleteStatus });
          const body = z
            .object({
              jsonrpc: z.literal("2.0"),
              id: z.number().optional(),
              method: z.string(),
              params: z.record(z.string(), z.unknown()).optional(),
            })
            .parse(await req.json());
          if (body.method !== "initialize") {
            protocolVerified =
              req.headers.get("MCP-Protocol-Version") ===
                MCP_PROTOCOL_VERSION &&
              req.headers.get("Mcp-Session-Id") === "fixture-session";
            if (!protocolVerified) return new Response(null, { status: 400 });
          }
          if (body.method === "notifications/initialized")
            return new Response(null, { status: 202 });
          if (body.method === "initialize")
            return Response.json(
              {
                jsonrpc: "2.0",
                id: body.id,
                result: {
                  protocolVersion: mcpVersion,
                  capabilities: { tools: {}, resources: {} },
                  serverInfo: { name: "fixture", version: "1" },
                },
              },
              { headers: { "Mcp-Session-Id": "fixture-session" } },
            );
          let result: unknown;
          if (body.method === "tools/list")
            result = {
              tools: [
                { name: "write", inputSchema: { type: "object" } },
                { name: "untrusted", inputSchema: { type: "object" } },
              ],
            };
          if (body.method === "resources/list")
            result = { resources: [{ uri: "fixture://repo" }] };
          if (
            body.method === "tools/call" ||
            body.method === "resources/read"
          ) {
            if (mcpSessionLost) return new Response(null, { status: 404 });
            if (body.method === "tools/call") mcpWrites++;
            await beforeResponse?.();
            if (loseResponse) return new Response(null, { status: 502 });
            const text = largeOutput
              ? "x".repeat(300000)
              : "Public MCP fixture result";
            result =
              body.method === "tools/call"
                ? { content: [{ type: "text", text }] }
                : { contents: [{ uri: "fixture://repo", text }] };
          }
          const response = { jsonrpc: "2.0", id: body.id, result };
          return sse && body.method === "tools/call"
            ? new Response(
                `: fixture\n\nevent: message\ndata: ${JSON.stringify(response)}\n\n`,
                { headers: { "Content-Type": "text/event-stream" } },
              )
            : Response.json(response);
        }
        return new Response(null, { status: 404 });
      },
    });
    await database.db.insert(users).values({
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    });
    workspaceId = (await claimInstallation(database.db, "owner", "Connections"))
      .id;
    await scope(async (c) => {
      agentId = (
        await createAgent(c, {
          subscriptionId: await controlledSubscription(c),
          visibility: "workspace",
          title: "Fixture agent",
          instructions: "Public fixture",
          model: "fixture",
        })
      ).id;
      environmentId = (await createEnvironment(c, agentId)).id;
      chatId = (
        await createChat(c, {
          title: "Fixture audience",
          visibility: "workspace",
        })
      ).id;
      await createParticipant(c, chatId, {
        agentId,
        role: "contributor",
      });
    });
    boundary = {
      transact: scope,
      // This explicit DB-backed composition fixture tests the mandatory hook. Main owns the production Run adapter.
      async validateRun(c, proof) {
        if (denyPublication) throw new DomainError("forbidden");
        const run = required(
          (
            await c.tx
              .select()
              .from(runs)
              .where(
                and(
                  eq(runs.id, proof.runId),
                  eq(runs.workspaceId, c.workspaceId),
                ),
              )
          )[0],
          "forbidden",
        );
        const environment = required(
          (
            await c.tx
              .select()
              .from(environments)
              .where(eq(environments.id, run.environmentId))
          )[0],
        );
        if (
          run.sponsorId !== c.actor.userId ||
          run.state !== "running" ||
          run.attempt !== proof.attempt ||
          run.launchKey !== proof.launchKey ||
          run.environmentGeneration !== proof.environmentGeneration ||
          environment.generation !== proof.environmentGeneration ||
          environment.activeRunId !== run.id
        )
          throw new DomainError("forbidden");
        const audience = await getChatAudience(c, run.chatId);
        if (
          audience.humans.some(
            (id) => !run.inputs.audience.humans.includes(id),
          ) ||
          audience.agents.some((id) => !run.inputs.audience.agents.includes(id))
        )
          throw new DomainError("forbidden");
        return { agentId: run.agentId, audience };
      },
    };
    service = makeService();
  });
  beforeEach(async () => {
    requests = [];
    bindings.length = 0;
    issueWrites = 0;
    mcpWrites = 0;
    providerIssues = "write";
    tokenExpired = false;
    accountChanged = false;
    repositoryChanged = false;
    mcpVersion = MCP_PROTOCOL_VERSION;
    mcpDeleteStatus = 204;
    mcpSessionLost = false;
    largeOutput = false;
    echoCredential = false;
    loseResponse = false;
    sse = false;
    beforeResponse = undefined;
    denyPublication = false;
    // Retire only earlier synthetic attempts in this private database; no compute was launched.
    await database.db
      .update(runs)
      .set({ state: "finished" })
      .where(eq(runs.workspaceId, workspaceId));
    connectionId = await makeConnection();
    await grant();
    runId = (
      await scope((c) =>
        admitRun(
          c,
          boss,
          {
            requestId: crypto.randomUUID(),
            chatId,
            agentId,
            type: "prompt",
            body: "fixture only",
          },
          nativeModelAuthorization,
        ),
      )
    ).id;
    launchKey = required(
      (await database.db.select().from(runs).where(eq(runs.id, runId)))[0],
    ).launchKey;
    await database.db
      .update(runs)
      .set({ state: "running" })
      .where(eq(runs.id, runId));
    await database.db
      .update(environments)
      .set({ activeRunId: runId })
      .where(eq(environments.id, environmentId));
  });
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("connects using scoped manager HTTP, selected-repository App token and private public views", async () => {
    const publicConnection = await scope((c) => getConnection(c, connectionId));
    expect(publicConnection.connected).toBe(true);
    expect(publicConnection).not.toHaveProperty("credentialRef");
    expect(publicConnection).not.toHaveProperty("accountRef");
    expect(publicConnection).not.toHaveProperty("config");
    expect(
      (await scope((c) => getConnections(c, { type: "github", limit: 1 })))
        .items.length,
    ).toBe(1);
    expect(requests).toContain("GET /api/v4/secrets/FIXTURE_GITHUB");
    const count = requests.length;
    await expect(
      secretResolver().resolve(
        {
          workspaceId,
          connectionId: crypto.randomUUID(),
          credentialRef: "fixture-reference",
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(requests).toHaveLength(count);
  });
  it("does not route Subscriptions through external Connection adapters", async () => {
    const row = await scope((c) =>
      createSubscription(c, {
        provider: "openai",
        protocol: "responses",
        models: ["fixture"],
        title: "Native association",
      }),
    );
    const before = requests.length;
    await expect(service.connectConnection(row.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(requests).toHaveLength(before);
    expect((await scope((c) => getSubscription(c, row.id))).status).toBe(
      "needs_auth",
    );
  });
  it("deduplicates exact canonical arguments and rejects forged identity or modified approval", async () => {
    const input = request();
    const row = await service.requestOperation(input);
    expect(
      (
        await service.requestOperation({
          ...input,
          arguments: { body: "Public fixture data", title: "Fixture issue" },
        })
      ).id,
    ).toBe(row.id);
    await expect(
      service.requestOperation({ ...input, arguments: { title: "Changed" } }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.requestOperation({
        ...input,
        agentId: crypto.randomUUID(),
      } as OperationRequest),
    ).rejects.toThrow();
    await expect(
      service.requestOperation({ ...request(), runId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.requestOperation(request({ attempt: 99 })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.requestOperation(request({ environmentGeneration: 99 })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        approveOperation(
          c,
          row.id,
          { identity: "0".repeat(64) },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await service.executeOperation(row.id)).state).toBe(
      "awaiting_approval",
    );
    expect(issueWrites).toBe(0);
  });
  it("persists exact human denial and never executes or retries the denied request", async () => {
    const input = request();
    const row = await service.requestOperation(input);
    const identity = required(row.identity ?? undefined);
    const beforeRequests = requests.length;
    const deny = () =>
      scope((c) =>
        denyOperation(c, row.id, { identity }, boundary.validateRun),
      );
    const [first, second] = await Promise.all([deny(), deny()]);
    expect(first).toMatchObject({
      id: row.id,
      state: "denied",
      deniedBy: "owner",
      deniedAt: expect.any(Date),
      outcome: "denied_by_human",
    });
    expect(second).toEqual(first);
    expect(await scope((c) => getOperation(c, row.id))).toEqual(first);
    expect(await service.requestOperation(input)).toEqual(first);
    expect((await service.executeOperation(row.id)).state).toBe("denied");
    await expect(
      scope((c) => retryOperation(c, row.id, boundary.validateRun)),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      scope((c) =>
        approveOperation(c, row.id, { identity }, boundary.validateRun),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        denyOperation(
          c,
          row.id,
          { identity: "0".repeat(64) },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.requestOperation({
        ...input,
        arguments: { title: "Changed denied request" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await scope((c) => getOperations(c, { state: "denied" }))).items.map(
        (item) => item.id,
      ),
    ).toContain(row.id);
    expect(requests).toHaveLength(beforeRequests);
    expect(issueWrites).toBe(0);
    const stored = required(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id))
      )[0],
    );
    expect(stored.approvedBy).toBeNull();
    expect(stored.executionToken).toBeNull();
    expect(stored.retryCount).toBe(0);
    await database.db
      .update(operations)
      .set({ expiresAt: new Date(0) })
      .where(eq(operations.id, row.id));
    expect(await deny()).toMatchObject({
      state: "denied",
      deniedBy: first.deniedBy,
      deniedAt: first.deniedAt,
      updatedAt: first.updatedAt,
    });
    expect((await service.executeOperation(row.id)).state).toBe("denied");
    expect(requests).toHaveLength(beforeRequests);
  });

  it("requires the actual human sponsor and exact digest to deny a Connection operation", async () => {
    const row = await service.requestOperation(request());
    const identity = required(row.identity ?? undefined);
    await expect(
      scope((c) =>
        denyOperation(
          c,
          row.id,
          { identity: "0".repeat(64) },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "owner", agentId }, (c) =>
        denyOperation(c, row.id, { identity }, boundary.validateRun),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const other = crypto.randomUUID();
    await database.db.insert(users).values({
      id: other,
      name: "Different sponsor",
      email: `${other}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other, role: "admin" });
    try {
      await expect(
        inWorkspace(database.db, workspaceId, { userId: other }, (c) =>
          denyOperation(c, row.id, { identity }, boundary.validateRun),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await database.db
        .delete(members)
        .where(
          and(eq(members.workspaceId, workspaceId), eq(members.userId, other)),
        );
    }
    await database.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(eq(members.workspaceId, workspaceId), eq(members.userId, "owner")),
      );
    try {
      await expect(
        scope((c) =>
          denyOperation(c, row.id, { identity }, boundary.validateRun),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await database.db
        .update(members)
        .set({ role: "owner" })
        .where(
          and(
            eq(members.workspaceId, workspaceId),
            eq(members.userId, "owner"),
          ),
        );
    }
    expect((await scope((c) => getOperation(c, row.id))).state).toBe(
      "awaiting_approval",
    );
    expect(issueWrites).toBe(0);
  });

  it.each(["attempt", "launch", "generation", "grant", "expiry"] as const)(
    "rejects Connection denial after the current %s fence changes",
    async (fence) => {
      const row = await service.requestOperation(request());
      const identity = required(row.identity ?? undefined);
      if (fence === "attempt")
        await database.db
          .update(runs)
          .set({ attempt: 9 })
          .where(eq(runs.id, runId));
      if (fence === "launch")
        await database.db
          .update(runs)
          .set({ launchKey: crypto.randomUUID() })
          .where(eq(runs.id, runId));
      if (fence === "generation")
        await database.db
          .update(runs)
          .set({ environmentGeneration: 9 })
          .where(eq(runs.id, runId));
      if (fence === "grant")
        await scope((c) => revokeConnectionAccess(c, connectionId, agentId));
      if (fence === "expiry")
        await database.db
          .update(operations)
          .set({ expiresAt: new Date(0) })
          .where(eq(operations.id, row.id));
      const before = await database.db
        .select()
        .from(operations)
        .where(eq(operations.id, row.id));
      await expect(
        scope((c) =>
          denyOperation(c, row.id, { identity }, boundary.validateRun),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id)),
      ).toEqual(before);
      expect(issueWrites).toBe(0);
    },
  );

  it("serializes approval versus denial with one durable winner", async () => {
    let writes = 0;
    for (let index = 0; index < 4; index++) {
      const row = await service.requestOperation(request());
      const input = { identity: required(row.identity ?? undefined) };
      const approve = () =>
        scope((c) => approveOperation(c, row.id, input, boundary.validateRun));
      const deny = () =>
        scope((c) => denyOperation(c, row.id, input, boundary.validateRun));
      const ordered = index % 2 ? [deny, approve] : [approve, deny];
      const results = await Promise.allSettled(
        ordered.map((decide) => decide()),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const saved = await scope((c) => getOperation(c, row.id));
      expect(["approved", "denied"]).toContain(saved.state);
      const executed = await service.executeOperation(row.id);
      if (saved.state === "approved") {
        expect(executed.state).toBe("succeeded");
        writes++;
      } else {
        expect(executed.state).toBe("denied");
        expect(saved.deniedBy).toBe("owner");
      }
      expect(issueWrites).toBe(writes);
    }
  });

  it("renames a Connection without invalidating its accepted grant or exact approval", async () => {
    const row = await approved();
    const before = await scope((c) => snapshotGrants(c, agentId));
    await scope((c) =>
      updateConnection(c, connectionId, { title: "Display only" }),
    );
    expect(await scope((c) => snapshotGrants(c, agentId))).toEqual(before);
    expect((await service.executeOperation(row.id)).state).toBe("succeeded");
    expect(issueWrites).toBe(1);
    await expect(
      scope((c) =>
        updateConnection(c, connectionId, { visibility: "workspace" }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("executes an exact human approval once and keeps its result out of the public Chat", async () => {
    const row = await approved();
    const [first, duplicate] = await Promise.all([
      service.executeOperation(row.id),
      service.executeOperation(row.id),
    ]);
    expect([first.state, duplicate.state]).toContain("succeeded");
    expect(issueWrites).toBe(1);
    expect((await service.executeOperation(row.id)).state).toBe("succeeded");
    const saved = required(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id))
      )[0],
    );
    expect(saved.result).toMatchObject({ number: 1 });
    const agentService = createConnectionService({
      boundary: {
        ...boundary,
        transact: (work) =>
          inWorkspace(
            database.db,
            workspaceId,
            { userId: "owner", agentId },
            work,
          ),
      },
      secrets: secretResolver(),
      http: http(),
      githubEndpoint: server.url.origin,
    });
    expect((await agentService.readOperation(row.id)).result).toMatchObject({
      number: 1,
    });
    await expect(service.readOperation(row.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      (
        await database.db
          .select()
          .from(messages)
          .where(eq(messages.requestId, row.id))
      ).length,
    ).toBe(0);
  });
  it("intersects provider permission and Otto grant; disabled actions or unselected targets cannot execute", async () => {
    const row = await approved();
    providerIssues = "read";
    expect((await service.executeOperation(row.id)).state).toBe("failed");
    expect(issueWrites).toBe(0);
    await expect(
      service.requestOperation(request({ target: "other/repo" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await scope((c) =>
      grantConnectionAccess(c, connectionId, {
        agentId,
        audience: { humans: ["owner"], agents: [agentId] },
        resources: ["fixture/repo"],
        operations: { "issues.create": "disabled" },
      }),
    );
    await expect(service.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("invalidates account changes, grant changes and expired approvals", async () => {
    const pending = await service.requestOperation(request());
    await grant();
    await expect(
      scope((c) =>
        approveOperation(
          c,
          pending.id,
          { identity: required(pending.identity ?? undefined) },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const row = await approved();
    await database.db
      .update(operations)
      .set({ expiresAt: new Date(0) })
      .where(eq(operations.id, row.id));
    await expect(service.executeOperation(row.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    const next = await approved();
    accountChanged = true;
    expect((await service.executeOperation(next.id)).state).toBe("failed");
    expect(issueWrites).toBe(0);
  });
  it("refreshes expired installation access without substituting credentials and rejects invalid refreshed scope", async () => {
    await database.db
      .update(connections)
      .set({ expiresAt: new Date(0) })
      .where(eq(connections.id, connectionId));
    const row = await approved();
    expect((await service.executeOperation(row.id)).state).toBe("succeeded");
    expect(
      requests.filter(
        (path) => path === "POST /app/installations/7/access_tokens",
      ),
    ).toHaveLength(2);
    tokenExpired = true;
    expect((await service.executeOperation((await approved()).id)).state).toBe(
      "failed",
    );
    tokenExpired = false;
    repositoryChanged = true;
    expect((await service.executeOperation((await approved()).id)).state).toBe(
      "failed",
    );
    expect(issueWrites).toBe(1);
  });
  it("disconnects mid-call, withholds publication, keeps uncertainty and refuses all stale retries", async () => {
    const row = await approved();
    beforeResponse = () =>
      scope(async (c) => {
        await disconnectConnection(c, connectionId);
      });
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    expect(issueWrites).toBe(1);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, row.id)),
    ).toHaveLength(0);
    await expect(
      scope((c) => retryOperation(c, row.id, boundary.validateRun)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(grant()).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await scope((c) => snapshotGrants(c, agentId))).some(
        (item) => item.connectionId === connectionId,
      ),
    ).toBe(false);
    beforeResponse = undefined;
    await service.connectConnection(connectionId);
    await expect(service.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("withholds output when the publication audience changes after provider I/O", async () => {
    const row = await approved();
    beforeResponse = async () => {
      denyPublication = true;
    };
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    expect(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id))
      )[0]?.result,
    ).toBeNull();
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, row.id)),
    ).toHaveLength(0);
  });
  it("persists lost-write acknowledgement and never repeats it after service restart", async () => {
    const row = await approved();
    loseResponse = true;
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    service = makeService();
    loseResponse = false;
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    await expect(
      scope((c) => retryOperation(c, row.id, boundary.validateRun)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(issueWrites).toBe(1);
  });
  it("bounds output, filters echoed credentials and durably retries only failed reads", async () => {
    largeOutput = true;
    const row = await service.requestOperation(
      request({ action: "repository.read", arguments: {} }),
    );
    expect((await service.executeOperation(row.id)).state).toBe("failed");
    await scope((c) => retryOperation(c, row.id, boundary.validateRun));
    largeOutput = false;
    expect((await service.executeOperation(row.id)).state).toBe("succeeded");
    expect((await scope((c) => getOperation(c, row.id))).retryCount).toBe(1);
    echoCredential = true;
    expect((await service.executeOperation((await approved()).id)).state).toBe(
      "uncertain",
    );
  });
  it("recovers stale execution claims without replay and fences late results", async () => {
    const row = await approved();
    beforeResponse = async () => {
      await database.db
        .update(operations)
        .set({ startedAt: new Date(0) })
        .where(eq(operations.id, row.id));
      expect(await scope(recoverOperations)).toEqual({ recovered: 1 });
    };
    await expect(service.executeOperation(row.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await scope((c) => getOperation(c, row.id))).state).toBe(
      "uncertain",
    );
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, row.id)),
    ).toHaveLength(0);
  });
  it("recovers after sponsor removal without replay and withholds a late provider result", async () => {
    const write = await approved();
    const read = await service.requestOperation(
      request({ action: "repository.read", arguments: {} }),
    );
    expect(await recoverConnectionOperations(database.db)).toEqual({
      recovered: 0,
      hasMore: false,
    });
    beforeResponse = async () => {
      // A newly acquired live claim must survive recovery.
      expect(await recoverConnectionOperations(database.db)).toEqual({
        recovered: 0,
        hasMore: false,
      });
      await database.db.insert(users).values({
        id: "recovery-owner",
        name: "Recovery owner",
        email: "recovery@example.test",
        emailVerified: true,
      });
      await database.db
        .insert(members)
        .values({ workspaceId, userId: "recovery-owner", role: "owner" });
      await database.db
        .update(members)
        .set({ role: "admin" })
        .where(
          and(
            eq(members.workspaceId, workspaceId),
            eq(members.userId, "owner"),
          ),
        );
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: "recovery-owner" },
        (c) => deleteMember(c, "owner"),
      );
      await expect(scope(recoverOperations)).rejects.toMatchObject({
        code: "forbidden",
      });
      // Fault fixture: simulate process loss and an aged read claim beside the actual HTTP write claim.
      await database.db
        .update(operations)
        .set({
          state: "executing",
          executionToken: crypto.randomUUID(),
          startedAt: new Date(0),
        })
        .where(eq(operations.id, read.id));
      await database.db
        .update(operations)
        .set({ startedAt: new Date(0) })
        .where(eq(operations.id, write.id));
      const before = requests.length;
      expect(await recoverConnectionOperations(database.db)).toEqual({
        recovered: 2,
        hasMore: false,
      });
      expect(requests).toHaveLength(before);
    };
    try {
      await expect(service.executeOperation(write.id)).rejects.toMatchObject({
        code: "forbidden",
      });
      const rows = await database.db
        .select()
        .from(operations)
        .where(eq(operations.runId, runId));
      expect(rows.find((row) => row.id === write.id)).toMatchObject({
        state: "uncertain",
        executionToken: null,
        outcome: "execution_interrupted",
        result: null,
      });
      expect(rows.find((row) => row.id === read.id)).toMatchObject({
        state: "failed",
        executionToken: null,
        outcome: "execution_interrupted",
        result: null,
      });
      expect(
        await database.db
          .select()
          .from(messages)
          .where(eq(messages.requestId, write.id)),
      ).toHaveLength(0);
      expect(issueWrites).toBe(1);
    } finally {
      await database.db
        .insert(members)
        .values({ workspaceId, userId: "owner", role: "owner" })
        .onConflictDoUpdate({
          target: [members.workspaceId, members.userId],
          set: { role: "owner" },
        });
      await database.db
        .delete(members)
        .where(
          and(
            eq(members.workspaceId, workspaceId),
            eq(members.userId, "recovery-owner"),
          ),
        );
    }
    beforeResponse = undefined;
    expect((await service.executeOperation(write.id)).state).toBe("uncertain");
    expect(issueWrites).toBe(1);
  });
  it.each(["token", "state", "age"] as const)(
    "rechecks claim %s after waiting for the workspace lock",
    async (change) => {
      const row = await approved();
      await database.db
        .update(operations)
        .set({
          state: "executing",
          executionToken: crypto.randomUUID(),
          startedAt: new Date(0),
        })
        .where(eq(operations.id, row.id));
      let release = () => {};
      let locked = () => {};
      const held = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const mutation = scope(async (c) => {
        locked();
        await gate;
        await c.tx
          .update(operations)
          .set(
            change === "token"
              ? { executionToken: crypto.randomUUID() }
              : change === "state"
                ? { state: "succeeded" }
                : { startedAt: new Date() },
          )
          .where(eq(operations.id, row.id));
      });
      await held;
      const recovery = recoverConnectionOperations(database.db);
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await database.db.execute(
            sql`select pid from pg_stat_activity where wait_event_type = 'Lock' and query like 'select id from workspaces%'`,
          );
          if (result.rows.length > 0) {
            waiting = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(waiting).toBe(true);
      } finally {
        release();
        await mutation;
      }
      expect(await recovery).toEqual({ recovered: 0, hasMore: false });
      const current = required(
        (
          await database.db
            .select()
            .from(operations)
            .where(eq(operations.id, row.id))
        )[0],
      );
      expect(current.state).toBe(
        change === "state" ? "succeeded" : "executing",
      );
      expect(current.outcome).toBeNull();
      expect(current.executionToken).not.toBeNull();
      // A subsequent scan can retire the replacement token only if it is still stale.
      expect(await recoverConnectionOperations(database.db)).toEqual({
        recovered: change === "token" ? 1 : 0,
        hasMore: false,
      });
    },
  );
  it("bounds startup recovery batches and drains durable backlog without provider I/O", async () => {
    for (let i = 0; i < 105; i++)
      await service.requestOperation(
        request({ action: "repository.read", arguments: {} }),
      );
    await database.db
      .update(operations)
      .set({
        state: "executing",
        executionToken: sql`gen_random_uuid()`,
        startedAt: new Date(0),
      })
      .where(eq(operations.runId, runId));
    const before = requests.length;
    expect(await recoverConnectionOperations(database.db)).toEqual({
      recovered: 100,
      hasMore: true,
    });
    expect(await recoverConnectionOperations(database.db)).toEqual({
      recovered: 5,
      hasMore: false,
    });
    expect(await recoverConnectionOperations(database.db)).toEqual({
      recovered: 0,
      hasMore: false,
    });
    const rows = await database.db
      .select()
      .from(operations)
      .where(eq(operations.runId, runId));
    expect(rows).toHaveLength(105);
    expect(
      rows.every(
        (row) =>
          row.state === "failed" &&
          row.executionToken === null &&
          row.outcome === "execution_interrupted",
      ),
    ).toBe(true);
    expect(requests).toHaveLength(before);
    expect(issueWrites).toBe(0);
  });
  it("revokes a grant during credential resolution before any protected write", async () => {
    const row = await approved();
    const resolver = secretResolver();
    const restricted = createConnectionService({
      boundary,
      http: http(),
      githubEndpoint: server.url.origin,
      secrets: {
        async resolve(reference, signal) {
          const value = await resolver.resolve(reference, signal);
          await scope((c) => revokeConnectionAccess(c, connectionId, agentId));
          return value;
        },
      },
    });
    expect((await restricted.executeOperation(row.id)).state).toBe("failed");
    expect(issueWrites).toBe(0);
  });
  it("rejects changed stored arguments/account and wrong authenticated agent before approval or I/O", async () => {
    const row = await service.requestOperation(request());
    await database.db
      .update(operations)
      .set({ arguments: { title: "Changed after review" } })
      .where(eq(operations.id, row.id));
    await expect(
      scope((c) =>
        approveOperation(
          c,
          row.id,
          { identity: required(row.identity ?? undefined) },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const next = await approved();
    await database.db
      .update(connections)
      .set({ accountRef: "github:12:7" })
      .where(eq(connections.id, connectionId));
    await expect(service.executeOperation(next.id)).rejects.toMatchObject({
      code: "conflict",
    });
    await database.db
      .update(connections)
      .set({ accountRef: "github:11:7" })
      .where(eq(connections.id, connectionId));
    const forged = createConnectionService({
      boundary: {
        ...boundary,
        transact: (fn) =>
          inWorkspace(
            database.db,
            workspaceId,
            { userId: "owner", agentId: crypto.randomUUID() },
            fn,
          ),
      },
      secrets: secretResolver(),
      http: http(),
      githubEndpoint: server.url.origin,
    });
    await expect(forged.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(issueWrites).toBe(0);
  });
  it("bounds stalled HTTP responses and credential resolvers without replaying writes", async () => {
    const row = await approved();
    beforeResponse = () => Bun.sleep(100);
    const bounded = createConnectionService({
      boundary,
      secrets: secretResolver(),
      http: { ...http(), timeoutMs: 30 },
      githubEndpoint: server.url.origin,
    });
    expect((await bounded.executeOperation(row.id)).state).toBe("uncertain");
    expect(issueWrites).toBe(1);
    beforeResponse = undefined;
    const next = await approved();
    const stalled = createConnectionService({
      boundary,
      secrets: { resolve: () => new Promise(() => {}) },
      http: { ...http(), timeoutMs: 30 },
      githubEndpoint: server.url.origin,
    });
    expect((await stalled.executeOperation(next.id)).state).toBe("failed");
    expect(issueWrites).toBe(1);
  });
  it("rejects expired legacy operation identity and reports possible token lifetime on disconnect", async () => {
    const row = await approved();
    await database.db
      .update(operations)
      .set({ identity: null, arguments: null, attempt: null })
      .where(eq(operations.id, row.id));
    await expect(service.executeOperation(row.id)).rejects.toThrow();
    await scope((c) =>
      updateConnection(c, connectionId, {
        editToken: 1,
        title: "Reconfigured fixture",
        credentialRef: "fixture-reference",
        config: githubConfig,
      }),
    );
    const result = await scope((c) => disconnectConnection(c, connectionId));
    expect(result.externalCredentialExpiresAt?.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(issueWrites).toBe(0);
  });
  it("fences the launch identity before and after provider I/O", async () => {
    await expect(
      service.requestOperation(request({ launchKey: crypto.randomUUID() })),
    ).rejects.toMatchObject({ code: "forbidden" });
    const row = await approved();
    beforeResponse = async () => {
      await database.db
        .update(runs)
        .set({ launchKey: crypto.randomUUID() })
        .where(eq(runs.id, runId));
    };
    expect((await service.executeOperation(row.id)).outcome).toBe(
      "result_withheld",
    );
    expect(issueWrites).toBe(1);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.requestId, row.id)),
    ).toHaveLength(0);
  });
  it("requires explicit grant audience and intersects it with a valid saved Run audience", async () => {
    await database.db
      .update(grants)
      .set({ audience: null })
      .where(eq(grants.connectionId, connectionId));
    await expect(service.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
    await grant();
    await database.db
      .update(runs)
      .set({ state: "finished" })
      .where(eq(runs.id, runId));
    const privateAudience = await scope(async (c) => {
      const other = await createAgent(c, {
        subscriptionId: await controlledSubscription(c),
        visibility: "workspace",
        title: "Other audience",
        instructions: "Fixture",
        model: "fixture",
      });
      const chat = await createChat(c, {
        title: "Wider saved audience",
        visibility: "workspace",
      });
      await createParticipant(c, chat.id, {
        agentId,
        role: "contributor",
      });
      await createParticipant(c, chat.id, {
        agentId: other.id,
        role: "contributor",
      });
      return chat;
    });
    runId = (
      await scope((c) =>
        admitRun(
          c,
          boss,
          {
            requestId: crypto.randomUUID(),
            chatId: privateAudience.id,
            agentId,
            type: "prompt",
            body: "fixture",
          },
          nativeModelAuthorization,
        ),
      )
    ).id;
    launchKey = required(
      (await database.db.select().from(runs).where(eq(runs.id, runId)))[0],
    ).launchKey;
    await database.db
      .update(runs)
      .set({ state: "running" })
      .where(eq(runs.id, runId));
    await database.db
      .update(environments)
      .set({ activeRunId: runId })
      .where(eq(environments.id, environmentId));
    // Run validator accepts its saved/current audience; Connection grant independently denies the extra recipient.
    expect(
      (await scope((c) => boundary.validateRun(c, request()))).audience.agents,
    ).toHaveLength(2);
    await expect(service.requestOperation(request())).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(issueWrites).toBe(0);
  });
  it("pages ordinary human approvals across owned Connections and rechecks ownership and revocation", async () => {
    const first = await service.requestOperation(request());
    const secondConnection = await makeConnection();
    await grant(secondConnection);
    const second = await service.requestOperation(
      request({ connectionId: secondConnection }),
    );
    const third = await service.requestOperation(request());
    const approvedRow = await approved();
    const otherSponsor = await service.requestOperation(request());
    await database.db.insert(users).values({
      id: "attention-other",
      name: "Other sponsor",
      email: "attention-other@example.test",
      emailVerified: true,
    });
    await database.db
      .update(operations)
      .set({ sponsorId: "attention-other" })
      .where(eq(operations.id, otherSponsor.id));
    await database.db
      .update(members)
      .set({ role: "contributor" })
      .where(
        and(eq(members.workspaceId, workspaceId), eq(members.userId, "owner")),
      );
    try {
      // Contributors can discover their own resources; attention still filters exact sponsors.
      expect(
        (await scope((c) => getConnections(c))).items.some(
          (row) => row.id === connectionId,
        ),
      ).toBe(true);
      const all = await scope((c) =>
        getOperations(c, { state: "awaiting_approval", limit: 100 }),
      );
      const ids = all.items.map((row) => row.id);
      expect(ids).toEqual([...ids].sort());
      for (const row of [first, second, third]) expect(ids).toContain(row.id);
      for (const row of [approvedRow, otherSponsor])
        expect(ids).not.toContain(row.id);
      expect(
        all.items.every((row) => !("accountRef" in row) && !("result" in row)),
      ).toBe(true);
      const collected: string[] = [];
      let after: string | undefined;
      for (let page = 0; page <= all.items.length; page++) {
        const rows = await scope((c) =>
          getOperations(c, { state: "awaiting_approval", after, limit: 2 }),
        );
        expect(rows.items.length).toBeLessThanOrEqual(2);
        if (rows.items.length === 0) break;
        collected.push(...rows.items.map((row) => row.id));
        if (rows.next === null) break;
        after = rows.next;
      }
      expect(collected).toEqual(ids);
      expect(new Set(collected).size).toBe(collected.length);
      expect(
        (
          await scope((c) =>
            getOperations(c, { connectionId, state: "awaiting_approval" }),
          )
        ).items.map((row) => row.id),
      ).toEqual([first.id, third.id].sort());
      await expect(
        scope((c) => getOperations(c, { limit: 101 })),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        scope((c) => getOperations(c, { after: "invalid" })),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        inWorkspace(
          database.db,
          workspaceId,
          { userId: "owner", agentId },
          (c) => getOperations(c, {}),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      // Ownership loss takes effect on both paged attention and the explicit Connection query.
      await database.db
        .update(connections)
        .set({ createdBy: "attention-other" })
        .where(eq(connections.id, secondConnection));
      expect(
        (
          await scope((c) =>
            getOperations(c, {
              state: "awaiting_approval",
              after: "00000000-0000-4000-8000-000000000000",
            }),
          )
        ).items.map((row) => row.id),
      ).not.toContain(second.id);
      await expect(
        scope((c) => getOperations(c, { connectionId: secondConnection })),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        scope((c) => getOperation(c, second.id)),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await database.db
        .update(connections)
        .set({ createdBy: "owner" })
        .where(eq(connections.id, secondConnection));
      await database.db
        .update(members)
        .set({ role: "owner" })
        .where(
          and(
            eq(members.workspaceId, workspaceId),
            eq(members.userId, "owner"),
          ),
        );
    }
    // A historical pending intent may remain visible; visibility must never bypass live grant validation.
    await scope((c) => revokeConnectionAccess(c, connectionId, agentId));
    await expect(
      scope((c) =>
        approveOperation(
          c,
          first.id,
          { identity: first.identity ?? "" },
          boundary.validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(issueWrites).toBe(0);
  });
  it("excludes another owned workspace from approval collection", async () => {
    const row = await service.requestOperation(request());
    const stored = required(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id))
      )[0],
    );
    const foreignWorkspace = required(
      (
        await database.db
          .insert(workspaces)
          .values({ title: "Foreign attention fixture" })
          .returning()
      )[0],
    );
    await database.db.insert(members).values({
      workspaceId: foreignWorkspace.id,
      userId: "owner",
      role: "owner",
    });
    const foreignConnection = await inWorkspace(
      database.db,
      foreignWorkspace.id,
      { userId: "owner" },
      (c) =>
        createConnection(c, {
          title: "Foreign fixture",
          type: "github",

          accountRef: "fixture",
        }),
    );
    const foreignRun = await inWorkspace(
      database.db,
      foreignWorkspace.id,
      { userId: "owner" },
      async (c) => {
        const agent = await createAgent(c, {
          subscriptionId: await controlledSubscription(c),
          visibility: "workspace",
          title: "Foreign fixture",
          instructions: "Fixture",
          model: "fixture",
        });
        await createEnvironment(c, agent.id);
        const chat = await createChat(c, {
          title: "Foreign fixture",
          visibility: "workspace",
        });
        await createParticipant(c, chat.id, {
          agentId: agent.id,
          role: "contributor",
        });
        return {
          agentId: agent.id,
          run: await admitRun(
            c,
            boss,
            {
              requestId: crypto.randomUUID(),
              chatId: chat.id,
              agentId: agent.id,
              type: "prompt",
              body: "fixture only",
            },
            nativeModelAuthorization,
          ),
        };
      },
    );
    // A persisted foreign intent tests collection isolation; it is never approved or executed.
    const foreignId = crypto.randomUUID();
    await database.db.insert(operations).values({
      ...stored,
      id: foreignId,
      requestId: crypto.randomUUID(),
      workspaceId: foreignWorkspace.id,
      connectionId: foreignConnection.id,
      agentId: foreignRun.agentId,
      runId: foreignRun.run.id,
    });
    const ids = (
      await scope((c) =>
        getOperations(c, { state: "awaiting_approval", limit: 100 }),
      )
    ).items.map((item) => item.id);
    expect(ids).toContain(row.id);
    expect(ids).not.toContain(foreignId);
    await expect(
      scope((c) => getOperations(c, { connectionId: foreignConnection.id })),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      (
        await inWorkspace(
          database.db,
          foreignWorkspace.id,
          { userId: "owner" },
          (c) => getOperations(c, {}),
        )
      ).items.map((item) => item.id),
    ).toEqual([foreignId]);
  });
  it("rechecks result audience after I/O and filters pending approvals by current ownership", async () => {
    const pending = await service.requestOperation(request());
    const row = await approved();
    const approvals = await scope((c) =>
      getOperations(c, { connectionId, state: "awaiting_approval", limit: 10 }),
    );
    expect(approvals.items.map((item) => item.id)).toEqual([pending.id]);
    beforeResponse = () =>
      scope(async (c) => {
        const other = await createAgent(c, {
          subscriptionId: await controlledSubscription(c),
          visibility: "workspace",
          title: "Later audience",
          instructions: "Fixture",
          model: "fixture",
        });
        await createParticipant(c, chatId, {
          agentId: other.id,
          role: "contributor",
        });
      });
    expect((await service.executeOperation(row.id)).outcome).toBe(
      "result_withheld",
    );
    expect(
      (
        await database.db
          .select()
          .from(operations)
          .where(eq(operations.id, row.id))
      )[0]?.result,
    ).toBeNull();
    // Remove only this test-created participant, preserving the suite's fixed Chat scope.
    await database.pool.query(
      'delete from chat_participants where "chatId"=$1 and "agentId"!=$2',
      [chatId, agentId],
    );
    await database.db.insert(users).values({
      id: "other-owner",
      name: "Other",
      email: "other-owner@example.test",
      emailVerified: true,
    });
    await database.db
      .update(connections)
      .set({ createdBy: "other-owner" })
      .where(eq(connections.id, connectionId));
    await expect(
      scope((c) => getOperation(c, pending.id)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        getOperations(c, { connectionId, state: "awaiting_approval" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(connections)
      .set({ createdBy: "owner" })
      .where(eq(connections.id, connectionId));
  });
  async function mcpConnection() {
    const id = await makeConnection({
      type: "mcp",
      endpoint: new URL("/mcp", server.url).href,
      tools: [{ name: "write", targetArgument: "resource", readOnly: false }],
      resources: ["fixture://repo"],
    });
    await scope((c) =>
      grantConnectionAccess(c, id, {
        agentId,
        audience: { humans: ["owner"], agents: [agentId] },
        resources: ["fixture://repo"],
        operations: {
          "tool.write": "confirmation",
          "resource.read": "allowed",
        },
      }),
    );
    return id;
  }
  it("negotiates pinned MCP HTTP, filters discovery and checks exact tool resource arguments", async () => {
    const id = await mcpConnection();
    expect(await service.discoverConnection(id)).toEqual({
      actions: ["tool.write", "resource.read"],
      resources: ["fixture://repo"],
    });
    expect(protocolVerified).toBe(true);
    await expect(
      service.requestOperation(
        request({
          connectionId: id,
          action: "tool.untrusted",
          target: "fixture://repo",
          arguments: { resource: "fixture://repo" },
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.requestOperation(
        request({
          connectionId: id,
          action: "tool.write",
          target: "fixture://repo",
          arguments: { resource: "fixture://other" },
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const row = await approved(
      request({
        connectionId: id,
        action: "tool.write",
        target: "fixture://repo",
        arguments: { resource: "fixture://repo", text: "Public fixture" },
      }),
    );
    sse = true;
    expect((await service.executeOperation(row.id)).state).toBe("succeeded");
    expect(mcpWrites).toBe(1);
  });
  it("propagates MCP cleanup failure without losing the saved write outcome or repeating it", async () => {
    const id = await mcpConnection();
    const operation = await approved(
      request({
        connectionId: id,
        action: "tool.write",
        target: "fixture://repo",
        arguments: { resource: "fixture://repo" },
      }),
    );
    mcpDeleteStatus = 503;
    await expect(service.executeOperation(operation.id)).rejects.toThrow(
      "Connection provider request failed",
    );
    expect((await scope((c) => getOperation(c, operation.id))).state).toBe(
      "succeeded",
    );
    expect(mcpWrites).toBe(1);
    expect((await service.executeOperation(operation.id)).state).toBe(
      "succeeded",
    );
    expect(mcpWrites).toBe(1);
    mcpDeleteStatus = 405;
    expect(await service.discoverConnection(id)).toMatchObject({
      resources: ["fixture://repo"],
    });
  });
  it("bounds MCP resource output, treats lost sessions as write uncertainty and reinitializes future calls", async () => {
    const id = await mcpConnection();
    const resource = await service.requestOperation(
      request({
        connectionId: id,
        action: "resource.read",
        target: "fixture://repo",
        arguments: {},
      }),
    );
    largeOutput = true;
    expect((await service.executeOperation(resource.id)).state).toBe("failed");
    largeOutput = false;
    await scope((c) => retryOperation(c, resource.id, boundary.validateRun));
    expect((await service.executeOperation(resource.id)).state).toBe(
      "succeeded",
    );
    const row = await approved(
      request({
        connectionId: id,
        action: "tool.write",
        target: "fixture://repo",
        arguments: { resource: "fixture://repo" },
      }),
    );
    mcpSessionLost = true;
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    mcpSessionLost = false;
    service = makeService();
    expect((await service.executeOperation(row.id)).state).toBe("uncertain");
    expect(mcpWrites).toBe(0);
    mcpVersion = "unsupported";
    await expect(service.connectConnection(id)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
