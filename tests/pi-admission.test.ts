import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { agents } from "../packages/agents/src/schema";
import { admitRun, dispatchRun } from "../packages/runs/src";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { sessions } from "../packages/sessions/src/schema";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { startPostgres } from "./postgres";

// HTTP/PG/queue proof; the enabled account below is fixture data, not a gateway login.
describe("managed Pi admission bindings", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let server: Bun.Server<undefined>;
  let app: ReturnType<typeof createApp>;
  let origin: string;
  let cookie: string;
  let userId: string;
  let workspaceId: string;
  let agentId: string;
  let subscriptionId: string;
  let conversationId: string;
  const record = z.object({ id: z.uuid() });
  async function request(path: string, value: unknown, method = "POST") {
    return fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method,
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  }
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (r) => app.fetch(r),
    });
    origin = server.url.origin;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ db: database.db, boss, auth, origin, pi });
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Actual Human",
        email: "pi-admission@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(signup.status).toBe(200);
    cookie = signup.headers.get("set-cookie") ?? "";
    userId = z
      .object({
        user: z.object({ id: z.string(), name: z.literal("Actual Human") }),
      })
      .parse(await signup.json()).user.id;
    workspaceId = (await claimInstallation(database.db, userId, "Pi")).id;
    const account = await request("/subscriptions", {
      title: "Fixture account",
      provider: "codex",
      visibility: "workspace",
    });
    expect(account.status).toBe(200);
    subscriptionId = record.parse(await account.json()).id;
    const agent = await request("/agents", {
      title: "One Pi body",
      instructions: "Work",
      model: "fixture",
      subscriptionId,
      visibility: "workspace",
    });
    expect(agent.status).toBe(200);
    const body = z.object({ agent: record }).parse(await agent.json());
    agentId = body.agent.id;
    const conversation = await request("/conversations", {
      title: "Work",
      visibility: "workspace",
    });
    expect(conversation.status).toBe(200);
    conversationId = record.parse(await conversation.json()).id;
    expect(
      (
        await request(`/conversations/${conversationId}/participants`, {
          agentId,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });
  const input = () => ({
    agentId,
    conversationId,
    type: "prompt" as const,
    body: "Work",
    requestId: crypto.randomUUID(),
  });
  it("rejects browser executable selection without creating an Agent", async () => {
    const before = await database.db.select().from(agents);
    const response = await request("/agents", {
      title: "Forged",
      instructions: "Work",
      model: "fixture",
      harness: "arbitrary-host-command",
    });
    expect(response.status).toBe(400);
    expect(await database.db.select().from(agents)).toHaveLength(before.length);
    const columns = await database.pool.query(
      "select column_name from information_schema.columns where table_name='agents'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("harness");
  });
  it("requires supported account provider and refuses browser qualification", async () => {
    expect(
      (
        await request("/subscriptions", {
          title: "Unknown",
          provider: "anything",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/subscriptions/${subscriptionId}`,
          { provider: "different" },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/subscriptions/${subscriptionId}`,
          { status: "enabled" },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    expect((await request("/runs", input())).status).toBe(403);
    expect(await database.db.select().from(runs)).toHaveLength(0);
    expect(await database.db.select().from(sessions)).toHaveLength(0);
  });
  it("computer binding does not assert model-account authentication", async () => {
    const computer = new ControlledComputer(subscriptionId);
    const runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
    });
    try {
      expect(
        await runtime.bind(
          workspaceId,
          { userId },
          agentId,
          "fixture-bound-computer",
        ),
      ).toEqual({ bound: true });
      const [account] = await database.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));
      expect(account?.status).toBe("needs_auth");
      expect((await request("/runs", input())).status).toBe(403);
    } finally {
      await runtime.close();
      await computer.close();
    }
  });
  it("saves the exact managed pin/account/model and keeps Session context private", async () => {
    // Controlled gateway qualification datum only; no real upstream account is enabled.
    await database.db
      .update(subscriptions)
      .set({ status: "enabled" })
      .where(eq(subscriptions.id, subscriptionId));
    const controls = input();
    const response = await request("/runs", controls);
    expect(response.status).toBe(200);
    const publicRun = record.parse(await response.json());
    const [run] = await database.db
      .select()
      .from(runs)
      .where(eq(runs.id, publicRun.id));
    expect(run?.inputs).toMatchObject({
      piVersion: pi.version,
      provider: "codex",
      model: "fixture",
      subscriptionId,
    });
    expect(run?.inputs).not.toHaveProperty("harness");
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, run?.sessionId ?? ""));
    expect(session).toMatchObject({
      piVersion: pi.version,
      provider: "codex",
      model: "fixture",
      subscriptionId,
    });
    expect(publicRun).not.toHaveProperty("inputs");
    expect(
      (
        await boss.findJobs("otto-run-dispatch", {
          data: { runId: publicRun.id },
        })
      ).length,
    ).toBe(1);
    // Current model change fences new dispatch but exact original retry preserves admitted evidence.
    expect(
      (
        await request(
          `/agents/${agentId}`,
          { model: "other", editToken: 0 },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      record.parse(await (await request("/runs", controls)).json()).id,
    ).toBe(publicRun.id);
    await dispatchRun(database.db, publicRun.id);
    const [failed] = await database.db
      .select()
      .from(runs)
      .where(eq(runs.id, publicRun.id));
    expect(failed).toMatchObject({
      state: "failed",
      outcome: "configuration_changed",
    });
    expect(failed?.inputs.model).toBe("fixture");
  });
  it("unconfigured Pi denies prompt admission atomically", async () => {
    await expect(
      inWorkspace(database.db, workspaceId, { userId }, (c) =>
        admitRun(c, boss, input()),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(await database.db.select().from(runs)).toHaveLength(1);
    expect(await database.db.select().from(sessions)).toHaveLength(1);
  });
});
