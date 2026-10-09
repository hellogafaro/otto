import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import {
  createNativeRunTools,
  createRunTools,
  effectRequestId,
  toolInput,
} from "../apps/server/src/tools";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  getChatAudience,
  getMessages,
  publishNativeMessage,
} from "../packages/chats/src";
import { messages, participants } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { createProject } from "../packages/projects/src";
import {
  type Attempt,
  assertRunAttempt,
  createRunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runEffects, runs } from "../packages/runs/src/schema";
import { createSession } from "../packages/sessions/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import { tasks } from "../packages/tasks/src/schema";
import { inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import { controlledModel } from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("native domain tools preserve current actor and stable effect identity", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  const workspaceId = crypto.randomUUID();
  const actor = { userId: crypto.randomUUID() };
  let attempt: Attempt;
  let chatId: string;
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    await database.db
      .insert(workspaces)
      .values({ id: workspaceId, title: "Native tool fixture" });
    await database.db.insert(users).values({
      id: actor.userId,
      name: "Fictional sponsor",
      email: `${actor.userId}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: actor.userId, role: "owner" });
    attempt = await inWorkspace(database.db, workspaceId, actor, async (c) => {
      const project = await createProject(c, { title: "Fixture Project" });
      const agent = await createAgent(c, {
        title: "Fixture Agent",
        instructions: "Controlled fixture only",
        model: "fixture",
        visibility: "workspace",
        projectId: project.id,
      });
      const environment = await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Fixture Chat",
        projectId: project.id,
        visibility: "participants",
      });
      chatId = chat.id;
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const session = await createSession(c, {
        chatId,
        agentId: agent.id,
        environmentId: environment.id,
        environmentGeneration: environment.generation,
        scope: "fixture",
        provider: "openai",
        model: "fixture",
        accountId: "fixture",
        subscriptionId: null,
      });
      const [run] = await c.tx
        .insert(runs)
        .values({
          workspaceId,
          chatId,
          agentId: agent.id,
          sponsorId: actor.userId,
          environmentId: environment.id,
          environmentGeneration: environment.generation,
          sessionId: session.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          state: "running",
          attempt: 1,
          deadlineAt: new Date(Date.now() + 300000),
          cursor: 1,
          inputs: {
            body: "Fixture",
            instructions: "Fixture",
            provider: "openai",
            model: "fixture",
            subscriptionId: null,
            accountId: session.accountId,
            sessionScope: session.scope,
            modelConfig: null,
            agentEditToken: agent.editToken,
            audience: await getChatAudience(c, chatId),
            skills: [],
            grants: [],
          },
        })
        .returning();
      if (!run) throw new Error("Missing fixture run");
      return {
        runId: run.id,
        agentId: run.agentId,
        attempt: run.attempt,
        launchKey: run.launchKey,
      };
    });
  });
  afterAll(async () => {
    await native?.close();
    await database?.stop();
  });
  const invoke = async (
    name: string,
    input: unknown,
    callId: string,
    identity = attempt,
  ) => {
    const tools = createNativeRunTools(
      database.db,
      {} as PgBoss,
      identity,
      { native },
      new AbortController().signal,
    );
    const tool = tools[name];
    if (!tool || !("execute" in tool) || !tool.execute)
      throw new Error(`Missing tool ${name}`);
    return tool.execute(input, { agent: { toolCallId: callId } } as NonNullable<
      Parameters<typeof tool.execute>[1]
    >);
  };

  it("exposes concrete strict native schemas without actor or idempotency inputs", () => {
    const tools = createNativeRunTools(
      database.db,
      {} as PgBoss,
      attempt,
      { native },
      new AbortController().signal,
    );
    expect(Object.keys(tools).length).toBeGreaterThanOrEqual(30);
    expect(
      toolInput.safeParse({
        name: "task.create",
        title: "Unsafe",
        actor: { userId: actor.userId },
      }).success,
    ).toBe(false);
    expect(effectRequestId(attempt.runId, "call-1")).toBe(
      effectRequestId(attempt.runId, "call-1"),
    );
    expect(effectRequestId(attempt.runId, "call-1")).not.toBe(
      effectRequestId(attempt.runId, "call-2"),
    );
  });

  it("invokes native task create twice concurrently but commits one task and one receipt", async () => {
    const [first, second] = await Promise.all([
      invoke("task_create", { title: "Exactly one Task" }, "create-once"),
      invoke("task_create", { title: "Exactly one Task" }, "create-once"),
    ]);
    expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    const rows = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.title, "Exactly one Task"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerId).toBe(actor.userId);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(eq(runEffects.runId, attempt.runId)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId)),
    ).toHaveLength(1);
    await expect(
      invoke("task_create", { title: "Changed payload" }, "create-once"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      invoke("message_create", { body: "Changed operation" }, "create-once"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects stale launch identity and expired deadlines before effects", async () => {
    await expect(
      invoke("task_create", { title: "Stale" }, "stale", {
        ...attempt,
        launchKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(runs)
      .set({ deadlineAt: new Date(0) })
      .where(eq(runs.id, attempt.runId));
    await expect(
      invoke("task_create", { title: "Expired" }, "expired"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(runs)
      .set({ deadlineAt: new Date(Date.now() + 300000) })
      .where(eq(runs.id, attempt.runId));
    expect(
      await database.db.select().from(tasks).where(eq(tasks.title, "Expired")),
    ).toHaveLength(0);
  });

  it("does not gain human-only assignment privileges from a human sponsor", async () => {
    const [task] = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.title, "Exactly one Task"));
    if (!task) throw new Error("Missing Task");
    await expect(
      createRunTools(database.db, {} as PgBoss, { native })(
        attempt,
        {
          name: "task.update",
          taskId: task.id,
          editToken: task.editToken,
          assigneeUserIds: [actor.userId],
        },
        new AbortController().signal,
        "human-only",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      toolInput.safeParse({
        name: "task.status",
        taskId: task.id,
        editToken: task.editToken,
        status: "done",
      }).success,
    ).toBe(false);
  });

  it("persists task comments with the real agent and sponsor, then edits and deletes only that authorship", async () => {
    const [task] = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.title, "Exactly one Task"));
    if (!task) throw new Error("Missing Task");
    const first = await invoke(
      "task_comment_create",
      { taskId: task.id, body: "Native comment" },
      "comment-once",
    );
    const duplicate = await invoke(
      "task_comment_create",
      { taskId: task.id, body: "Native comment" },
      "comment-once",
    );
    expect(duplicate).toEqual(JSON.parse(JSON.stringify(first)));
    expect(first).toMatchObject({
      createdBy: actor.userId,
      agentId: attempt.agentId,
      body: "Native comment",
    });
    const id = (first as { id: string }).id;
    expect(
      await invoke(
        "task_comment_update",
        { commentId: id, body: "Updated" },
        "comment-update",
      ),
    ).toMatchObject({ body: "Updated" });
    await expect(
      invoke(
        "task_comment_create",
        { taskId: crypto.randomUUID(), body: "Wrong workspace or absent" },
        "wrong-task",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await invoke("task_comment_delete", { commentId: id }, "comment-delete");
    await expect(
      invoke("task_comment_get", { commentId: id }, "comment-missing"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("executes a native model tool call and publishes only native assistant text", async () => {
    const [existing] = await database.db
      .select()
      .from(runs)
      .where(eq(runs.id, attempt.runId));
    if (!existing) throw new Error("Missing run");
    await database.db
      .update(runs)
      .set({
        state: "queued",
        inputs: { ...existing.inputs, accountId: "fixture" },
      })
      .where(eq(runs.id, existing.id));
    const model = controlledModel({
      text: "Created the requested Task.",
      toolRequests: [
        {
          toolName: "task_create",
          input: { title: "Native model Task" },
          toolCallId: "native-model-create",
        },
      ],
    });
    const runtime = createRunRuntime(database.db, {
      storage: native,
      authorizeSources: authorizeRunSources,
      resolveModel: async () => model,
      tools: (identity, signal) =>
        createNativeRunTools(
          database.db,
          {} as PgBoss,
          identity,
          { native },
          signal,
        ),
      publishOutput: async (identity, output) => {
        const scope = await withRunAttempt(
          database.db,
          identity,
          async (c, run) => ({ actor: c.actor, sessionId: run.sessionId }),
          undefined,
          native,
          authorizeRunSources,
        );
        if (!scope.sessionId) throw new Error("Missing session");
        await publishNativeMessage(
          database.db,
          native,
          workspaceId,
          scope.actor,
          chatId,
          {
            requestId: effectRequestId(identity.runId, output.nativeMessageId),
            sessionId: scope.sessionId,
            ...output,
          },
          async (c) => {
            await assertRunAttempt(
              c,
              identity,
              undefined,
              native,
              authorizeRunSources,
            );
          },
        );
      },
    });
    try {
      await runtime.dispatch(existing.id);
      const [finished] = await database.db
        .select()
        .from(runs)
        .where(eq(runs.id, existing.id));
      expect(finished).toMatchObject({
        state: "finished",
        outcome: "completed",
      });
      expect(
        await database.db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Native model Task")),
      ).toHaveLength(1);
      const chat = await inWorkspace(database.db, workspaceId, actor, (c) =>
        getMessages(c, chatId, 0, native),
      );
      expect(
        chat.some((message) => message.body === "Created the requested Task."),
      ).toBe(true);
      expect(
        chat.some((message) => message.body.includes('"toolCallId"')),
      ).toBe(false);
      const memory = await native.storage.getStore("memory");
      const transcript = await memory?.listMessages({
        threadId: existing.sessionId ?? "",
        resourceId: workspaceId,
        perPage: 100,
      });
      expect(
        transcript?.messages.some((message) =>
          message.content.parts.some((part) => part.type === "tool-invocation"),
        ),
      ).toBe(true);
      if (!finished) throw new Error("Missing completed Run");
      attempt = {
        runId: finished.id,
        agentId: finished.agentId,
        attempt: finished.attempt,
        launchKey: finished.launchKey,
      };
      await database.db
        .update(runs)
        .set({ state: "running", deadlineAt: new Date(Date.now() + 300000) })
        .where(eq(runs.id, existing.id));
    } finally {
      await runtime.close();
    }
  });

  it("denies removed Agent participants and revoked sponsor membership", async () => {
    await database.db
      .delete(participants)
      .where(
        and(
          eq(participants.chatId, chatId),
          eq(participants.agentId, attempt.agentId),
        ),
      );
    await expect(
      invoke("task_create", { title: "Removed Agent" }, "removed-agent"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .insert(participants)
      .values({ chatId, agentId: attempt.agentId, role: "contributor" });
    await database.db
      .delete(members)
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, actor.userId),
        ),
      );
    await expect(
      invoke("task_create", { title: "Removed sponsor" }, "removed-sponsor"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
