import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { readConfig } from "../apps/server/src/config";
import { startServer } from "../apps/server/src/lifecycle";
import { startQueue } from "../apps/server/src/queue";
import { updateAgent } from "../packages/agents/src";
import { agents } from "../packages/agents/src/schema";
import { createChat, createParticipant } from "../packages/chats/src";
import { environments } from "../packages/environments/src/schema";
import { runs } from "../packages/runs/src/schema";
import { required } from "../packages/shared/src";
import { inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("operator bootstrap through authenticated native admission", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let server: Awaited<ReturnType<typeof startServer>>;
  let connectionString: string;
  let userId: string;
  let cookie: string;
  let client = 180;
  const origin = "http://127.0.0.1:45291";

  beforeEach(async () => {
    database = await startPostgres();
    connectionString = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    const installer = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await installer.stop();
    server = await startServer(
      readConfig({
        DATABASE_URL: connectionString,
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        ENCRYPTION_KEY: Buffer.from(fixtureEncryptionKey).toString("base64"),
        OTTO_ORIGIN: origin,
        PORT: "0",
      }),
      {
        mail: null,
        execution: {
          async resolveModel(_attempt, signal) {
            return controlledModel({ signal, text: "Bootstrap Run completed" });
          },
        },
      },
    );
    const signup = await fetch(
      `${server.server.url.origin}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${++client}`,
        },
        body: JSON.stringify({
          name: "Bootstrap fixture",
          email: `${crypto.randomUUID()}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      },
    );
    expect(signup.status).toBe(200);
    userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user.id;
    cookie = signup.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).not.toBe("");
  }, 120000);

  afterEach(async () => {
    await server?.stop();
    await database?.stop();
  });

  async function bootstrap(workspaceId?: string, actorId = userId) {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "scripts/bootstrap.ts",
        actorId,
        ...(workspaceId
          ? ["--workspace", workspaceId]
          : ["Bootstrap workspace"]),
      ],
      {
        cwd: process.cwd(),
        env: { DATABASE_URL: connectionString },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    return z.object({ workspaceId: z.uuid() }).parse(JSON.parse(stdout))
      .workspaceId;
  }

  async function defaultAgent(workspaceId: string) {
    const saved = await database.db
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, workspaceId));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.isDefault).toBe(true);
    return required(saved[0]);
  }

  async function environment(agentId: string) {
    return (
      await database.db
        .select()
        .from(environments)
        .where(eq(environments.agentId, agentId))
    )[0];
  }

  async function admit(workspaceId: string, agentId: string) {
    const chatId = await inWorkspace(
      database.db,
      workspaceId,
      { userId },
      async (c) => {
        const agent = await defaultAgent(workspaceId);
        await updateAgent(c, agentId, {
          editToken: agent.editToken,
          model: "fixture",
          subscriptionId: await controlledSubscription(c),
        });
        const chat = await createChat(c, {
          title: "Bootstrap admission",
          visibility: "participants",
        });
        await createParticipant(c, chat.id, { agentId, role: "contributor" });
        return chat.id;
      },
    );
    const response = await fetch(
      `${server.server.url.origin}/api/workspaces/${workspaceId}/runs`,
      {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          agentId,
          chatId,
          type: "prompt",
          body: "Exercise bootstrap admission",
        }),
      },
    );
    expect(response.status).toBe(200);
    const run = z.object({ id: z.uuid() }).parse(await response.json());
    await expect
      .poll(
        async () =>
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
            ?.state,
        { timeout: 15000 },
      )
      .toBe("finished");
    const messages = await fetch(
      `${server.server.url.origin}/api/workspaces/${workspaceId}/chats/${chatId}/messages`,
      { headers: { origin, cookie } },
    );
    expect(messages.status).toBe(200);
    expect(
      z
        .array(z.object({ body: z.string() }))
        .parse(await messages.json())
        .some((message) => message.body === "Bootstrap Run completed"),
    ).toBe(true);
  }

  it("creates the required unavailable Environment before the first authenticated Run", async () => {
    const workspaceId = await bootstrap();
    const agent = await defaultAgent(workspaceId);
    expect(await environment(agent.id)).toMatchObject({
      workspaceId,
      agentId: agent.id,
      state: "unavailable",
      generation: 0,
      computerRef: null,
      provider: null,
    });
    await admit(workspaceId, agent.id);
  });

  it("preserves an initialized Environment identity, generation and saved computer binding on rerun", async () => {
    const workspaceId = await bootstrap();
    const agent = await defaultAgent(workspaceId);
    await database.db
      .update(environments)
      .set({
        state: "ready",
        generation: 7,
        provider: "controlled-fixture",
        computerRef: "fixture-not-a-real-computer",
        executionScope: "fixture-scope",
      })
      .where(eq(environments.agentId, agent.id));
    const before = required(await environment(agent.id));
    expect(await bootstrap(workspaceId)).toBe(workspaceId);
    expect((await defaultAgent(workspaceId)).id).toBe(agent.id);
    expect(await environment(agent.id)).toEqual(before);
  });

  it("repairs a missing Environment for the existing default Agent and admits a normal Run", async () => {
    const workspaceId = await bootstrap();
    const agent = await defaultAgent(workspaceId);
    await database.db
      .delete(environments)
      .where(eq(environments.agentId, agent.id));
    expect(await environment(agent.id)).toBeUndefined();
    expect(await bootstrap(workspaceId)).toBe(workspaceId);
    expect((await defaultAgent(workspaceId)).id).toBe(agent.id);
    expect(await environment(agent.id)).toMatchObject({
      workspaceId,
      agentId: agent.id,
      state: "unavailable",
      generation: 0,
      computerRef: null,
      provider: null,
    });
    await admit(workspaceId, agent.id);
  });

  it("rejects a nonowner and an unknown workspace without changing the Environment", async () => {
    const workspaceId = await bootstrap();
    const agent = await defaultAgent(workspaceId);
    const before = required(await environment(agent.id));
    const signup = await fetch(
      `${server.server.url.origin}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${++client}`,
        },
        body: JSON.stringify({
          name: "Bootstrap contributor",
          email: `${crypto.randomUUID()}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      },
    );
    expect(signup.status).toBe(200);
    const otherId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user.id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: otherId, role: "contributor" });
    await expect(bootstrap(workspaceId, otherId)).rejects.toThrow(/forbidden/);
    await expect(bootstrap(crypto.randomUUID())).rejects.toThrow(
      /forbidden|not_found/,
    );
    expect(await environment(agent.id)).toEqual(before);
    expect((await defaultAgent(workspaceId)).id).toBe(agent.id);
  });
});
