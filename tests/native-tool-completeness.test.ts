import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { continueTaskReview } from "../apps/server/src/task-review";
import {
  createNativeRunTools,
  effectRequestId,
} from "../apps/server/src/tools";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createMessage,
  createParticipant,
  deleteParticipant,
  getMessages,
  publishNativeMessage,
  reserveMessage,
} from "../packages/chats/src";
import { messages, participants } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import {
  createCollection,
  createDocument,
  createFile,
  getSkillFileReference,
  snapshotRunDocuments,
  updateDocument,
  updateFile,
} from "../packages/library/src";
import {
  createProject,
  deleteProjectMember,
  upsertProjectMember,
} from "../packages/projects/src";
import { admitRun } from "../packages/runs/src";
import {
  assertRunAttempt,
  createRunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runEffects, runs } from "../packages/runs/src/schema";
import { recordSessionSources } from "../packages/sessions/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import { sessions } from "../packages/sessions/src/schema";
import {
  createSkill,
  exportSkill,
  importSkill,
  setSkillFiles,
  updateSkill,
} from "../packages/skills/src";
import {
  createTask,
  createTimesheet,
  getTask,
  getTaskLinks,
  setTaskStatus,
} from "../packages/tasks/src";
import { taskComments } from "../packages/tasks/src/comments-schema";
import { getTaskReview, reviewTask } from "../packages/tasks/src/review";
import { tasks } from "../packages/tasks/src/schema";
import { type Context, inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { fixtureStorage } from "./fixtures/storage";
import { startPostgres } from "./postgres";

describe("bounded native conversational operation completeness", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  const bytes = new TextEncoder().encode("Exact accepted supporting bytes");
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, value) {
      objects.set(key, value.slice());
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Missing fixture bytes");
      return value.slice();
    },
  });
  beforeAll(async () => {
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
  });
  afterAll(async () => {
    await boss?.stop();
    await native?.close();
    await database?.stop();
  });
  async function fixture(queued = false) {
    const workspaceId = crypto.randomUUID();
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    await database.db
      .insert(workspaces)
      .values({ id: workspaceId, title: "Gap proof" });
    await database.db.insert(users).values(
      [owner, other].map((id) => ({
        id,
        name: "Fictional participant",
        email: `${id}@example.test`,
        emailVerified: true,
      })),
    );
    await database.db.insert(members).values([
      { workspaceId, userId: owner, role: "owner" },
      { workspaceId, userId: other, role: "contributor" },
    ]);
    const scope = <T>(work: (c: Context) => Promise<T>) =>
      inWorkspace(database.db, workspaceId, { userId: owner }, work);
    const base = await scope(async (c) => {
      const project = await createProject(c, { title: "Accepted Project" });
      await upsertProjectMember(c, project.id, other, "contributor");
      const skill = await importSkill(c, {
        projectId: project.id,
        visibility: "workspace",
        skillMd:
          '---\nname: accepted-export\ndescription: "Exact purpose"\nlicense: MIT\nmetadata:\n  team: fixture\nallowed-tools: untrusted-host-command\n---\nAccepted instructions 日本語',
      });
      const agent = await createAgent(c, {
        title: "Scoped Agent",
        instructions: "Controlled native tools",
        model: "fixture",
        subscriptionId: await controlledSubscription(c),
        visibility: "workspace",
        projectId: project.id,
        skillIds: [skill.id],
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Accepted Chat",
        projectId: project.id,
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        userId: other,
        role: "contributor",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      const task = await createTask(c, {
        projectId: project.id,
        title: "Manual work",
      });
      const time = await createTimesheet(c, {
        taskId: task.id,
        duration: 17,
        notes: "Human minutes",
      });
      return { project, skill, agent, chat, task, time };
    });
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: owner },
      {
        requestId: crypto.randomUUID(),
        title: "Supporting file",
        type: "text",
        mediaType: "text/plain",
        visibility: "workspace",
        projectId: base.project.id,
      },
      bytes,
    );
    await scope(async (c) => {
      const reference = await getSkillFileReference(
        c,
        file.id,
        base.project.id,
        [owner, other],
      );
      await setSkillFiles(
        c,
        base.skill.id,
        [{ path: "references/exact.txt", ...reference }],
        base.skill.editToken,
      );
    });
    const source = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: owner },
      base.chat.id,
      {
        requestId: crypto.randomUUID(),
        body: "Capture exactly: café 日本語\nDo not rewrite this.",
      },
    );
    const admitted = await scope((c) =>
      admitRun(
        c,
        boss,
        {
          requestId: crypto.randomUUID(),
          agentId: base.agent.id,
          chatId: base.chat.id,
          type: "prompt",
          body: "Exercise scoped tools",
        },
        nativeModelAuthorization,
        native,
        snapshotRunDocuments,
      ),
    );
    if (!queued)
      await database.db
        .update(runs)
        .set({
          state: "running",
          attempt: 1,
          deadlineAt: new Date(Date.now() + 300000),
        })
        .where(eq(runs.id, admitted.id));
    const run = (
      await database.db.select().from(runs).where(eq(runs.id, admitted.id))
    )[0];
    if (!run) throw new Error("Missing accepted Run");
    const attempt = {
      runId: run.id,
      agentId: run.agentId,
      attempt: run.attempt,
      launchKey: run.launchKey,
    };
    const invoke = async (
      name: string,
      input: unknown,
      toolCallId: string = crypto.randomUUID(),
    ) => {
      const tool = createNativeRunTools(
        database.db,
        boss,
        attempt,
        { native, storage, models: nativeModelAuthorization },
        new AbortController().signal,
      )[name];
      if (!tool || !("execute" in tool) || !tool.execute)
        throw new Error(`Missing native tool ${name}`);
      return tool.execute(input, { agent: { toolCallId } } as NonNullable<
        Parameters<typeof tool.execute>[1]
      >);
    };
    return {
      ...base,
      workspaceId,
      owner,
      other,
      scope,
      file,
      source,
      run,
      attempt,
      invoke,
    };
  }

  it("submits native task evidence once and continues requested changes in the same worker Chat", async () => {
    const f = await fixture();
    const input = {
      taskId: f.task.id,
      editToken: f.task.editToken,
      body: "Finished the work. Evidence: https://example.test/result",
    };
    const submitted = (await f.invoke(
      "task_proposeCompletion",
      input,
      "submit-review",
    )) as {
      taskId: string;
      status: string;
      editToken: number;
      messageId: string;
    };
    expect(submitted).toMatchObject({
      taskId: f.task.id,
      status: "review",
      editToken: f.task.editToken + 1,
    });
    expect(
      await f.invoke("task_proposeCompletion", input, "submit-review"),
    ).toEqual(submitted);
    expect(
      await database.db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, f.task.id)),
    ).toHaveLength(1);
    expect(await f.scope((c) => getTaskReview(c, f.task.id))).toMatchObject({
      chatId: f.chat.id,
      agentId: f.agent.id,
    });
    const requestId = crypto.randomUUID();
    const changed = await f.scope((c) =>
      reviewTask(c, f.task.id, {
        requestId,
        editToken: submitted.editToken,
        decision: "request_changes",
        body: "Please revise the introduction.",
      }),
    );
    const deliveryInput = {
      requestId,
      taskId: f.task.id,
      commentId: changed.comment.id,
      chatId: changed.chatId,
      agentId: changed.agentId,
      editToken: changed.task.editToken,
    };
    const options = {
      db: database.db,
      nativeStorage: native,
      boss,
      modelAuthorization: nativeModelAuthorization,
    };
    expect(
      await continueTaskReview(options, f.workspaceId, f.owner, deliveryInput),
    ).toMatchObject({ status: "sent" });
    expect(
      await continueTaskReview(options, f.workspaceId, f.owner, deliveryInput),
    ).toMatchObject({ status: "sent" });
    const followups = await database.db
      .select()
      .from(runs)
      .where(and(eq(runs.chatId, f.chat.id), eq(runs.agentId, f.agent.id)));
    expect(followups).toHaveLength(2);
    expect(followups.find((run) => run.id !== f.run.id)?.inputs.body).toContain(
      "Please revise the introduction.",
    );
    expect(
      (await f.scope((c) => getTaskReview(c, f.task.id)))?.continuationStatus,
    ).toBe("sent");
    expect(
      await database.db
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, f.task.id)),
    ).toHaveLength(2);
  });

  it.each(["publication", "model authorization"] as const)(
    "does not continue a superseded review during %s",
    async (phase) => {
      const f = await fixture();
      const submitted = (await f.invoke("task_proposeCompletion", {
        taskId: f.task.id,
        editToken: f.task.editToken,
        body: "Evidence",
      })) as { editToken: number };
      const requestId = crypto.randomUUID();
      const changed = await f.scope((c) =>
        reviewTask(c, f.task.id, {
          requestId,
          editToken: submitted.editToken,
          decision: "request_changes",
          body: "Superseded request",
        }),
      );
      let completed = false;
      const complete = async (context?: Context) => {
        if (completed) return;
        completed = true;
        const finish = async (c: Context) => {
          const current = await getTask(c, f.task.id);
          await setTaskStatus(c, current.id, {
            editToken: current.editToken,
            status: "done",
          });
        };
        if (context) await finish(context);
        else await f.scope(finish);
      };
      const memory = await native.storage.getStore("memory");
      if (!memory) throw new Error("Missing native memory");
      const save = memory.saveMessages.bind(memory);
      if (phase === "publication")
        memory.saveMessages = async (input) => {
          await complete();
          return save(input);
        };
      try {
        const result = await continueTaskReview(
          {
            db: database.db,
            nativeStorage: native,
            boss,
            modelAuthorization: {
              ...nativeModelAuthorization,
              authorizeModel: async (...args) => {
                if (phase === "model authorization") await complete(args[0]);
                return nativeModelAuthorization.authorizeModel(...args);
              },
            },
          },
          f.workspaceId,
          f.owner,
          {
            requestId,
            taskId: f.task.id,
            commentId: changed.comment.id,
            editToken: changed.task.editToken,
          },
        );
        expect(completed).toBe(true);
        expect(result.status).toBe("unavailable");
        expect((await f.scope((c) => getTask(c, f.task.id))).status).toBe(
          "done",
        );
        expect(
          await database.db
            .select()
            .from(runs)
            .where(eq(runs.chatId, f.chat.id)),
        ).toHaveLength(1);
      } finally {
        memory.saveMessages = save;
      }
    },
  );

  it("discovers only accepted Project audiences and retains Project read authority", async () => {
    const f = await fixture();
    await f.scope((c) => createProject(c, { title: "Other private Project" }));
    const page = (await f.invoke("project_list", {})) as {
      items: { id: string }[];
    };
    expect(page.items.map((item) => item.id)).toEqual([f.project.id]);
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, f.run.sessionId ?? ""));
    expect(session?.sources).toContainEqual({
      type: "project",
      id: f.project.id,
    });
    await f.scope((c) => deleteProjectMember(c, f.project.id, f.other));
    await expect(
      f.scope((c) =>
        authorizeRunSources(c, f.run, [{ type: "project", id: f.project.id }]),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.invoke("project_list", {})).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("exports the exact accepted Skill format and metadata, and refuses changed or unselected sources", async () => {
    const f = await fixture();
    const expected = await f.scope((c) => exportSkill(c, f.skill.id));
    expect(await f.invoke("skill_export", { skillId: f.skill.id })).toEqual(
      expected,
    );
    expect(expected.skillMd).toContain('license: "MIT"');
    expect(expected.skillMd).toContain(
      'allowed-tools: "untrusted-host-command"',
    );
    expect(expected.files[0]).toMatchObject({
      fileId: f.file.id,
      byteLength: bytes.length,
      sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    });
    const unselected = await f.scope((c) =>
      createSkill(c, {
        title: "unselected",
        instructions: "Hidden",
        visibility: "user",
      }),
    );
    await expect(
      f.invoke("skill_export", { skillId: unselected.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await f.scope((c) =>
      updateSkill(c, f.skill.id, {
        editToken: 1,
        instructions: "Changed after acceptance",
      }),
    );
    await expect(
      f.invoke("skill_export", { skillId: f.skill.id }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await f.invoke("skill_get", { skillId: f.skill.id })).toMatchObject({
      instructions: f.skill.instructions,
    });
  });

  it.each(["skill", "supporting-file"] as const)(
    "rejects Skill export after current %s audience revocation",
    async (source) => {
      const f = await fixture();
      if (source === "skill")
        await f.scope((c) =>
          updateSkill(c, f.skill.id, { editToken: 1, visibility: "user" }),
        );
      else
        await f.scope((c) => updateFile(c, f.file.id, { visibility: "user" }));
      await expect(
        f.invoke("skill_export", { skillId: f.skill.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
    },
  );

  it("reads one timesheet without exposing a readable foreign Project or workspace", async () => {
    const f = await fixture();
    expect(
      await f.invoke("time_get", { timesheetId: f.time.id }),
    ).toMatchObject({
      id: f.time.id,
      taskId: f.task.id,
      duration: 17,
      createdBy: f.owner,
    });
    const outside = await f.scope(async (c) => {
      const project = await createProject(c, { title: "Other Project" });
      const task = await createTask(c, {
        projectId: project.id,
        title: "Outside",
      });
      return createTimesheet(c, { taskId: task.id, duration: 9 });
    });
    await expect(
      f.invoke("time_get", { timesheetId: outside.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const foreign = await fixture();
    await expect(
      f.invoke("time_get", { timesheetId: foreign.time.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await f.scope((c) => deleteProjectMember(c, f.project.id, f.other));
    await expect(
      f.invoke("time_get", { timesheetId: f.time.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("captures one published native source atomically with exact notes, link, sponsor and retry identity", async () => {
    const f = await fixture();
    const input = { title: "Captured source", messageId: f.source.id };
    const [first, second] = await Promise.all([
      f.invoke("task_capture", input, "capture-once"),
      f.invoke("task_capture", input, "capture-once"),
    ]);
    expect(JSON.parse(JSON.stringify(second))).toEqual(
      JSON.parse(JSON.stringify(first)),
    );
    const [saved] = await database.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.projectId, f.project.id), eq(tasks.title, input.title)),
      );
    if (!saved) throw new Error("Missing captured Task");
    expect(saved).toMatchObject({
      notes: f.source.body,
      ownerId: f.owner,
      projectId: f.project.id,
    });
    expect((await f.scope((c) => getTaskLinks(c, saved.id))).items).toEqual([
      expect.objectContaining({ type: "chat", reference: f.chat.id }),
    ]);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(
          and(
            eq(runEffects.runId, f.run.id),
            eq(runEffects.toolCallId, "capture-once"),
          ),
        ),
    ).toHaveLength(1);
    await expect(
      f.invoke("task_capture", { ...input, title: "Changed" }, "capture-once"),
    ).rejects.toMatchObject({ code: "conflict" });
    const unpub = await f.scope((c) =>
      reserveMessage(c, f.chat.id, {
        requestId: crypto.randomUUID(),
        body: "Not published",
      }),
    );
    await expect(
      f.invoke("task_capture", { ...input, messageId: unpub.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    const otherChat = await f.scope((c) =>
      createChat(c, { title: "Foreign source Chat", visibility: "workspace" }),
    );
    const foreign = await createMessage(
      database.db,
      native,
      f.workspaceId,
      { userId: f.owner },
      otherChat.id,
      { requestId: crypto.randomUUID(), body: "Foreign Chat" },
    );
    await expect(
      f.invoke("task_capture", { ...input, messageId: foreign.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses captured Task publication when the Project widens beyond the accepted Chat audience", async () => {
    const f = await fixture();
    const outsider = crypto.randomUUID();
    await database.db.insert(users).values({
      id: outsider,
      name: "Outside accepted audience",
      email: `${outsider}@example.test`,
      emailVerified: true,
    });
    await database.db.insert(members).values({
      workspaceId: f.workspaceId,
      userId: outsider,
      role: "contributor",
    });
    await f.scope((c) =>
      upsertProjectMember(c, f.project.id, outsider, "contributor"),
    );
    await expect(
      f.invoke(
        "task_capture",
        { title: "Must not widen", messageId: f.source.id },
        "widened-capture",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, f.project.id),
            eq(tasks.title, "Must not widen"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(
          and(
            eq(runEffects.runId, f.run.id),
            eq(runEffects.toolCallId, "widened-capture"),
          ),
        ),
    ).toHaveLength(0);
  });

  it("bounds captured native bytes atomically rather than truncating the source", async () => {
    const f = await fixture();
    const source = await createMessage(
      database.db,
      native,
      f.workspaceId,
      { userId: f.owner },
      f.chat.id,
      { requestId: crypto.randomUUID(), body: "日".repeat(23000) },
    );
    await expect(
      f.invoke(
        "task_capture",
        { title: "Over receipt byte limit", messageId: source.id },
        "large-capture",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      await database.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, f.project.id),
            eq(tasks.title, "Over receipt byte limit"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(
          and(
            eq(runEffects.runId, f.run.id),
            eq(runEffects.toolCallId, "large-capture"),
          ),
        ),
    ).toHaveLength(0);
  });

  it("rolls back captured Task and receipt if link persistence fails, then retries exactly once", async () => {
    const f = await fixture();
    await database.pool.query(
      "create function fixture_capture_failure() returns trigger language plpgsql as $$ begin raise exception 'controlled link failure'; end $$; create trigger fixture_capture_failure before insert on task_links for each row execute function fixture_capture_failure()",
    );
    try {
      await expect(
        f.invoke(
          "task_capture",
          { title: "Atomic capture", messageId: f.source.id },
          "atomic-capture",
        ),
      ).rejects.toThrow();
      expect(
        await database.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, f.project.id),
              eq(tasks.title, "Atomic capture"),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await database.db
          .select()
          .from(runEffects)
          .where(
            and(
              eq(runEffects.runId, f.run.id),
              eq(runEffects.toolCallId, "atomic-capture"),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await database.pool.query(
        "drop trigger fixture_capture_failure on task_links; drop function fixture_capture_failure()",
      );
    }
    expect(
      await f.invoke(
        "task_capture",
        { title: "Atomic capture", messageId: f.source.id },
        "atomic-capture",
      ),
    ).toMatchObject({ notes: f.source.body });
  });

  it("publishes bounded native reply, human mentions and workspace File references with stable retries", async () => {
    const f = await fixture();
    const input = {
      body: "Native reply",
      replyTo: f.source.id,
      mentionUserIds: [f.other],
      fileIds: [f.file.id],
    };
    const first = await f.invoke("message_create", input, "reply-once");
    expect(await f.invoke("message_create", input, "reply-once")).toEqual(
      first,
    );
    expect(first).toMatchObject({
      authorAgentId: f.agent.id,
      authorUserId: null,
      replyTo: f.source.id,
      mentionUserIds: [f.other],
      fileIds: [f.file.id],
    });
    const read = await inWorkspace(
      database.db,
      f.workspaceId,
      { userId: f.other },
      (c) => getMessages(c, f.chat.id, 0, native),
    );
    expect(read.find((message) => message.body === input.body)).toMatchObject({
      replyTo: f.source.id,
      mentionUserIds: [f.other],
      fileIds: [f.file.id],
    });
    await expect(
      f.invoke(
        "message_create",
        { ...input, mentionUserIds: [] },
        "reply-once",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.invoke("message_create", {
        body: "Wrong mention",
        mentionUserIds: [crypto.randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.invoke("message_create", {
        body: "Wrong reply",
        replyTo: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.invoke("message_create", {
        body: "Too many Files",
        fileIds: Array.from({ length: 31 }, () => f.file.id),
      }),
    ).resolves.toMatchObject({ error: true });
    await expect(
      f.invoke("message_create", {
        body: "Forged author",
        authorUserId: f.owner,
      }),
    ).resolves.toMatchObject({ error: true });
    await expect(
      f.invoke("message_create", {
        body: "Forged request",
        requestId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ error: true });
    const privateFile = await createFile(
      database.db,
      storage,
      f.workspaceId,
      { userId: f.owner },
      {
        requestId: crypto.randomUUID(),
        title: "Private",
        type: "text",
        visibility: "user",
        mediaType: "text/plain",
      },
      bytes,
    );
    await expect(
      f.invoke("message_create", {
        body: "Private first attach",
        fileIds: [privateFile.id],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await createMessage(
      database.db,
      native,
      f.workspaceId,
      { userId: f.owner },
      f.chat.id,
      {
        requestId: crypto.randomUUID(),
        body: "Human private attachment",
        fileIds: [privateFile.id],
      },
    );
    await expect(
      f.invoke("message_create", {
        body: "Private reattach",
        fileIds: [privateFile.id],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("retains a generated File's saved and current source-Run audiences when attaching it", async () => {
    const f = await fixture();
    const sourceChat = await f.scope(async (c) => {
      const chat = await createChat(c, {
        title: "Separate source",
        projectId: f.project.id,
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        agentId: f.agent.id,
        role: "contributor",
      });
      await createParticipant(c, chat.id, {
        userId: f.other,
        role: "contributor",
      });
      return chat;
    });
    const sourceRun = await f.scope((c) =>
      admitRun(
        c,
        boss,
        {
          requestId: crypto.randomUUID(),
          chatId: sourceChat.id,
          agentId: f.agent.id,
          type: "prompt",
          body: "Source audience",
        },
        nativeModelAuthorization,
        native,
        snapshotRunDocuments,
      ),
    );
    const generated = await createFile(
      database.db,
      storage,
      f.workspaceId,
      { userId: f.owner },
      {
        requestId: crypto.randomUUID(),
        title: "Source output",
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
        projectId: f.project.id,
        sourceRunId: sourceRun.id,
      },
      bytes,
    );
    expect(
      await f.invoke("message_create", {
        body: "Allowed source output",
        fileIds: [generated.id],
      }),
    ).toMatchObject({ fileIds: [generated.id] });
    const member = (
      await database.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.chatId, sourceChat.id),
            eq(participants.userId, f.other),
          ),
        )
    )[0];
    if (!member) throw new Error("Missing source participant");
    await f.scope((c) => deleteParticipant(c, sourceChat.id, member.id));
    await expect(
      f.invoke("message_create", {
        body: "Revoked source output",
        fileIds: [generated.id],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rechecks File custody after native persistence and recovers the reserved exact reply without duplicate publication", async () => {
    const f = await fixture();
    const extra = await createFile(
      database.db,
      storage,
      f.workspaceId,
      { userId: f.owner },
      {
        requestId: crypto.randomUUID(),
        title: "Revocable attachment",
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
      },
      bytes,
    );
    const store = await native.storage.getStore("memory");
    if (!store) throw new Error("Missing native memory");
    const save = store.saveMessages.bind(store);
    const spy = vi
      .spyOn(store, "saveMessages")
      .mockImplementationOnce(async (input) => {
        const result = await save(input);
        await f.scope((c) => updateFile(c, extra.id, { visibility: "user" }));
        return result;
      });
    const input = {
      body: "Withheld metadata reply",
      replyTo: f.source.id,
      fileIds: [extra.id],
    };
    try {
      await expect(
        f.invoke("message_create", input, "revoked-save"),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      spy.mockRestore();
    }
    const [reserved] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.requestId, effectRequestId(f.run.id, "revoked-save")));
    expect(reserved?.status).toBe("reserved");
    expect(
      (await f.scope((c) => getMessages(c, f.chat.id, 0, native))).some(
        (message) => message.body === input.body,
      ),
    ).toBe(false);
    await f.scope((c) => updateFile(c, extra.id, { visibility: "workspace" }));
    expect(
      await f.invoke("message_create", input, "revoked-save"),
    ).toMatchObject({
      id: reserved?.id,
      body: input.body,
      fileIds: [extra.id],
    });
    expect(
      await database.db
        .select()
        .from(messages)
        .where(
          eq(messages.requestId, effectRequestId(f.run.id, "revoked-save")),
        ),
    ).toHaveLength(1);
  });

  it("executes all four additions through the official native runtime and persists their results across storage reopen", async () => {
    const f = await fixture(true);
    const runtime = createRunRuntime(database.db, {
      storage: native,
      authorizeSources: authorizeRunSources,
      resolveModel: async () =>
        controlledModel({
          text: "Finished bounded operations",
          toolRequests: [
            {
              toolName: "skill_export",
              input: { skillId: f.skill.id },
              toolCallId: "model-export",
            },
            {
              toolName: "time_get",
              input: { timesheetId: f.time.id },
              toolCallId: "model-time",
            },
            {
              toolName: "task_capture",
              input: { title: "Model captured Task", messageId: f.source.id },
              toolCallId: "model-capture",
            },
            {
              toolName: "message_create",
              input: {
                body: "Model metadata reply",
                replyTo: f.source.id,
                mentionUserIds: [f.other],
                fileIds: [f.file.id],
              },
              toolCallId: "model-message",
            },
          ],
        }),
      tools: (attempt, signal) =>
        createNativeRunTools(
          database.db,
          boss,
          attempt,
          { native, storage, models: nativeModelAuthorization },
          signal,
        ),
      publishOutput: async (attempt, output) => {
        const scope = await withRunAttempt(
          database.db,
          attempt,
          async (c, run) => ({ actor: c.actor, sessionId: run.sessionId }),
          undefined,
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        );
        if (!scope.sessionId) throw new Error("Missing Session");
        await publishNativeMessage(
          database.db,
          native,
          f.workspaceId,
          scope.actor,
          f.chat.id,
          {
            requestId: effectRequestId(f.run.id, output.nativeMessageId),
            sessionId: scope.sessionId,
            ...output,
          },
          async (c) => {
            await assertRunAttempt(
              c,
              attempt,
              undefined,
              native,
              authorizeRunSources,
              snapshotRunDocuments,
            );
          },
        );
      },
      snapshotDocuments: snapshotRunDocuments,
    });
    try {
      await runtime.dispatch(f.run.id);
      expect(
        (await database.db.select().from(runs).where(eq(runs.id, f.run.id)))[0]
          ?.state,
      ).toBe("finished");
    } finally {
      await runtime.close();
    }
    const reopened = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    try {
      const read = await f.scope((c) => getMessages(c, f.chat.id, 0, reopened));
      expect(
        read.find((message) => message.body === "Model metadata reply"),
      ).toMatchObject({
        replyTo: f.source.id,
        mentionUserIds: [f.other],
        fileIds: [f.file.id],
      });
      const store = await reopened.storage.getStore("memory");
      const transcript = await store?.listMessages({
        threadId: f.run.sessionId ?? "",
        resourceId: f.workspaceId,
        perPage: 100,
      });
      const contents = JSON.stringify(transcript?.messages);
      expect(contents).toContain("accepted-export");
      expect(contents).toContain("license:");
      expect(contents).toContain("references/exact.txt");
      expect(contents).toContain("Human minutes");
      expect(contents).toContain("model-capture");
      const captured = await database.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, f.project.id),
            eq(tasks.title, "Model captured Task"),
          ),
        );
      expect(captured).toEqual([
        expect.objectContaining({ notes: f.source.body, ownerId: f.owner }),
      ]);
    } finally {
      await reopened.close();
    }
  });

  it("retains exact dynamic read, list, captured Task and attachment sources before disclosure and denies later revocation", async () => {
    const f = await fixture();
    const document = await f.scope((c) =>
      createDocument(c, {
        projectId: f.project.id,
        title: "Dynamic document",
        body: "Sensitive dynamic body",
        visibility: "workspace",
      }),
    );
    await f.invoke("document_get", { documentId: document.id });
    await f.invoke("document_list", {});
    await f.invoke("task_list", {});
    await f.invoke("file_list", {});
    await f.invoke("file_read", { fileId: f.file.id });
    await f.invoke("skill_read", {
      skillId: f.skill.id,
      path: "references/exact.txt",
    });
    const message = (await f.invoke("message_create", {
      body: "A retained attachment",
      fileIds: [f.file.id],
    })) as { id: string };
    await f.invoke("chat_read", {});
    const captured = (await f.invoke("task_capture", {
      messageId: f.source.id,
      title: "Retained capture",
    })) as { id: string };
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, f.run.sessionId ?? ""));
    expect(session?.sourcesCertified).toBe(true);
    expect(session?.sources).toEqual(
      expect.arrayContaining([
        { type: "document", id: document.id },
        { type: "task", id: f.task.id },
        { type: "task", id: captured.id },
        { type: "file", id: f.file.id },
        {
          type: "attachment",
          chatId: f.chat.id,
          messageId: message.id,
          fileId: f.file.id,
        },
        expect.objectContaining({
          type: "skill-file",
          skillId: f.skill.id,
          path: "references/exact.txt",
          fileId: f.file.id,
        }),
      ]),
    );
    expect(
      session?.sources.filter((source) => source.type === "document"),
    ).toHaveLength(1);
    await f.scope((c) =>
      updateDocument(c, document.id, {
        editToken: document.editToken,
        visibility: "user",
      }),
    );
    await expect(
      f.invoke("time_get", { timesheetId: f.time.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses disclosure beyond 200 retained sources and atomically rolls back a captured Task and receipt", async () => {
    const f = await fixture();
    const retained = await database.db
      .insert(tasks)
      .values(
        Array.from({ length: 200 }, (_, index) => ({
          workspaceId: f.workspaceId,
          projectId: f.project.id,
          ownerId: f.owner,
          title: `Existing retained ${index}`,
        })),
      )
      .returning({ id: tasks.id });
    await inWorkspace(
      database.db,
      f.workspaceId,
      { userId: f.owner, agentId: f.agent.id },
      (c) =>
        recordSessionSources(
          c,
          f.run.sessionId ?? "",
          retained.map(({ id }) => ({ type: "task", id })),
        ),
    );
    await expect(
      f.invoke(
        "task_capture",
        { messageId: f.source.id, title: "Must roll back at source limit" },
        "source-limit-capture",
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(
      await database.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, f.project.id),
            eq(tasks.title, "Must roll back at source limit"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(runEffects)
        .where(
          and(
            eq(runEffects.runId, f.run.id),
            eq(runEffects.toolCallId, "source-limit-capture"),
          ),
        ),
    ).toHaveLength(0);
    await expect(
      f.invoke("task_get", { taskId: f.task.id }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(
      await f.invoke("task_get", { taskId: retained[0]?.id }),
    ).toMatchObject({ id: retained[0]?.id });
    const [session] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, f.run.sessionId ?? ""));
    expect(session?.sources).toHaveLength(200);
  });

  it("marks unrepresented Collection provenance nonreusable without disabling ordinary accepted Chat context", async () => {
    const f = await fixture();
    await f.invoke("chat_get", {});
    expect(
      (
        await database.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, f.run.sessionId ?? ""))
      )[0]?.sourcesCertified,
    ).toBe(true);
    const collection = await f.scope((c) =>
      createCollection(c, {
        projectId: f.project.id,
        title: "Unrepresented source",
        fields: [],
      }),
    );
    expect(
      await f.invoke("collection_get", { collectionId: collection.id }),
    ).toMatchObject({ id: collection.id });
    expect(
      (
        await database.db
          .select()
          .from(sessions)
          .where(eq(sessions.id, f.run.sessionId ?? ""))
      )[0]?.sourcesCertified,
    ).toBe(false);
  });
});
