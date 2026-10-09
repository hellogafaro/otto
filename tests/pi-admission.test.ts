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
import { openNativeStorage } from "../packages/sessions/src/native";
import { sessions } from "../packages/sessions/src/schema";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { setSubscriptionApiKey } from "../packages/subscriptions/src/server";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import {
  controlledModel,
  fixtureEncryptionKey,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("native admission bindings with deterministic account fixtures", () => {
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
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
  let chatId: string;
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
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
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
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
      encryptionKey: fixtureEncryptionKey,
    });
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
      provider: "openai",
      protocol: "responses",
      models: ["fixture", "other"],
      visibility: "workspace",
    });
    expect(account.status).toBe(200);
    subscriptionId = record.parse(await account.json()).id;
    await inWorkspace(database.db, workspaceId, { userId }, (c) =>
      setSubscriptionApiKey(
        c,
        subscriptionId,
        { apiKey: "fixture-not-a-real-key" },
        fixtureEncryptionKey,
      ),
    );
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
    await database.db
      .update(subscriptions)
      .set({ status: "needs_auth" })
      .where(eq(subscriptions.id, subscriptionId));
    const chat = await request("/chats", {
      title: "Work",
      visibility: "workspace",
    });
    expect(chat.status).toBe(200);
    chatId = record.parse(await chat.json()).id;
    expect(
      (
        await request(`/chats/${chatId}/participants`, {
          agentId,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await server?.stop(true);
    await native?.close();
    await boss?.stop();
    await database?.stop();
  });
  const input = () => ({
    agentId,
    chatId,
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
  it("disabled computer binding cannot authenticate an account or mutate its status", async () => {
    const runtime = createRunRuntime(database.db, {
      storage: native,
      resolveModel: async () => controlledModel(),
      tools: () => ({}),
    });
    try {
      await expect(
        runtime.bind(
          workspaceId,
          { userId },
          agentId,
          "fixture-bound-computer",
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
      const [account] = await database.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));
      expect(account?.status).toBe("needs_auth");
      expect((await request("/runs", input())).status).toBe(403);
    } finally {
      await runtime.close();
    }
  });
  it("saves the exact native account/model/protocol and keeps Session context private", async () => {
    await inWorkspace(database.db, workspaceId, { userId }, (c) =>
      setSubscriptionApiKey(
        c,
        subscriptionId,
        { apiKey: "fixture-not-a-real-key" },
        fixtureEncryptionKey,
      ),
    );
    const [account] = await database.db
      .select()
      .from(subscriptions)
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
      provider: "openai",
      model: "fixture",
      subscriptionId,
      accountId: account?.secretId,
      modelConfig: {
        provider: "openai",
        protocol: "responses",
        baseUrl: "https://api.openai.com/v1",
        id: "fixture",
      },
    });
    expect(run?.inputs).not.toHaveProperty("harness");
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, run?.sessionId ?? ""));
    expect(session).toMatchObject({
      provider: "openai",
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
  it("unconfigured native authorization denies prompt admission atomically", async () => {
    await expect(
      inWorkspace(database.db, workspaceId, { userId }, (c) =>
        admitRun(c, boss, input()),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(await database.db.select().from(runs)).toHaveLength(1);
    expect(await database.db.select().from(sessions)).toHaveLength(1);
  });
});
