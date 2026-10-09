import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { agentSkills, agents } from "../packages/agents/src/schema";
import { createChat, createParticipant } from "../packages/chats/src";
import {
  approveOperation,
  createConnection,
  disconnectConnection,
  grantConnectionAccess,
  requestOperation,
  snapshotGrants,
} from "../packages/connections/src";
import { connections, grants } from "../packages/connections/src/schema";
import { createEnvironment } from "../packages/environments/src";
import {
  createFile,
  type FileStorage,
  getFile,
  getFiles,
  readFile,
} from "../packages/files/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import {
  admitRun,
  dispatchRun,
  RUN_QUEUE,
  type RunRequest,
} from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { createSchedule } from "../packages/schedules/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  createSkill,
  getSkill,
  snapshotSkills,
  updateSkill,
} from "../packages/skills/src";
import { createTask } from "../packages/tasks/src";
import {
  type Actor,
  claimInstallation,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { fixtureStorage } from "./fixtures/storage";
import { startPostgres } from "./postgres";

describe("review authorization and admission regressions", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let nativeStorage: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let workspaceId: string;
  let agentId: string;
  let chatId: string;
  const scope = <T>(
    fn: Parameters<typeof inWorkspace<T>>[3],
    actor: Actor = { userId: "owner" },
  ) => inWorkspace(database.db, workspaceId, actor, fn);
  const selectSkills = (skillIds: string[]) =>
    scope(async (c) => {
      await c.tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
      if (skillIds.length)
        await c.tx
          .insert(agentSkills)
          .values(
            skillIds.map((skillId) => ({ workspaceId, agentId, skillId })),
          );
    });
  const request = (): RunRequest => ({
    requestId: crypto.randomUUID(),
    chatId,
    agentId,
    type: "prompt",
    body: "Work",
  });
  // Named in-memory storage fixture: tests authorization around I/O, not Garage.
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing fixture object");
      return bytes;
    },
  });
  beforeAll(async () => {
    database = await startPostgres();
    nativeStorage = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await database.db.insert(users).values({
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    });
    workspaceId = (await claimInstallation(database.db, "owner", "Security"))
      .id;
    await scope(async (c) => {
      agentId = (
        await createAgent(c, {
          subscriptionId: await controlledSubscription(c),
          visibility: "workspace",
          title: "Worker",
          instructions: "Work",
          model: "selected",
        })
      ).id;
      await createEnvironment(c, agentId);
      chatId = (await createChat(c, { title: "Work", visibility: "workspace" }))
        .id;
      await createParticipant(c, chatId, {
        agentId,
        role: "contributor",
      });
    });
  });
  afterAll(async () => {
    await nativeStorage?.close();
    await boss?.stop();
    await database?.stop();
  });
  async function member() {
    const id = crypto.randomUUID();
    await database.db.insert(users).values({
      id,
      name: "Reader",
      email: `${id}@example.test`,
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: id, role: "viewer" });
    return { userId: id };
  }
  it.each(["workspace", "project"] as const)(
    "caps saved Run files after later %s membership",
    async (type) => {
      const original = await member();
      const project =
        type === "project"
          ? await scope((c) => createProject(c, { title: "Output" }))
          : undefined;
      if (project)
        await scope((c) =>
          upsertProjectMember(c, project.id, original.userId, "viewer"),
        );
      const chat = await scope(async (c) => {
        const row = await createChat(c, {
          title: "Output",
          visibility: "workspace",
          projectId: project?.id,
        });
        await createParticipant(c, row.id, { agentId, role: "contributor" });
        return row;
      });
      const run = await scope((c) =>
        admitRun(
          c,
          boss,
          { ...request(), chatId: chat.id },
          nativeModelAuthorization,
          nativeStorage,
        ),
      );
      const bytes = new Uint8Array([1, 2, 3]);
      const file = await createFile(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        {
          requestId: crypto.randomUUID(),
          title: "Saved output",
          type: "text",
          visibility: "workspace",
          mediaType: "text/plain",
          sourceRunId: run.id,
          projectId: project?.id,
        },
        bytes,
      );
      const later = await member();
      if (project)
        await scope((c) =>
          upsertProjectMember(c, project.id, later.userId, "viewer"),
        );
      expect(
        (
          await scope((c) => getFiles(c, { projectId: project?.id }), later)
        ).items.map((a) => a.id),
      ).not.toContain(file.id);
      await expect(
        scope((c) => getFile(c, file.id), later),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        readFile(database.db, storage, workspaceId, later, file.id),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        (
          await scope((c) => getFiles(c, { projectId: project?.id }), original)
        ).items.map((a) => a.id),
      ).toContain(file.id);
      expect(
        await readFile(database.db, storage, workspaceId, original, file.id),
      ).toEqual(bytes);
      // Revoke during storage fetch: the second production authorization must reject.
      const revoking: FileStorage = {
        ...storage,
        async get(key) {
          await scope(async (c) => {
            await c.tx
              .delete(members)
              .where(
                and(
                  eq(members.workspaceId, workspaceId),
                  eq(members.userId, original.userId),
                ),
              );
          });
          return storage.get(key);
        },
      };
      await expect(
        readFile(database.db, revoking, workspaceId, original, file.id),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        scope((c) => getFile(c, file.id), original),
      ).rejects.toMatchObject({ code: "forbidden" });
      await dispatchRun(database.db, run.id);
    },
  );
  it("requires an agent grant for user-scoped Documents and Files despite the sponsor's ownership", async () => {
    const actor = { userId: "owner", agentId };
    const doc = await scope((c) =>
      createSkill(c, {
        title: "Private",
        instructions: "private",
        visibility: "user",
      }),
    );
    expect((await scope((c) => getSkill(c, doc.id))).instructions).toBe(
      "private",
    );
    await expect(
      scope((c) => getSkill(c, doc.id), actor),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(
        (c) =>
          snapshotSkills(c, [doc.id], { humans: ["owner"], agents: [agentId] }),
        actor,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: "owner" },
      {
        requestId: crypto.randomUUID(),
        title: "Private",
        type: "text",
        visibility: "user",
        mediaType: "text/plain",
      },
      new Uint8Array([4]),
    );
    await expect(
      scope((c) => getFile(c, file.id), actor),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await scope((c) => getFiles(c, {}), actor)).items.map((a) => a.id),
    ).not.toContain(file.id);
    await expect(
      readFile(database.db, storage, workspaceId, actor, file.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await readFile(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        file.id,
      ),
    ).toEqual(new Uint8Array([4]));
    // Human-authorized one-agent Run input remains a separate explicit admission path.
    const chat = await scope(async (c) => {
      const row = await createChat(c, {
        title: "Private",
        visibility: "participants",
      });
      await createParticipant(c, row.id, { agentId, role: "contributor" });
      return row;
    });
    await selectSkills([doc.id]);
    const run = await scope((c) =>
      admitRun(
        c,
        boss,
        {
          ...request(),
          chatId: chat.id,
        },
        nativeModelAuthorization,
        nativeStorage,
      ),
    );
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.inputs.skills[0]?.instructions,
    ).toBe("private");
    await dispatchRun(database.db, run.id);
    await selectSkills([]);
  });
  it("denies regrant, stale grants, requests and approvals for a disconnected Connection", async () => {
    const makeConnection = () =>
      scope((c) =>
        createConnection(c, {
          title: "Fixture account",
          type: "mcp",
          accountRef: crypto.randomUUID(),
        }),
      );
    const connection = await makeConnection();
    const active = await makeConnection();
    // Direct-domain connected/discovery fixture; actual adapter/Run composition is exercised separately.
    await database.db.update(connections).set({
      connected: true,
      credentialRef: "fixture-reference",
      config: {
        type: "mcp",
        endpoint: "https://fixture.invalid/mcp",
        tools: [{ name: "write", targetArgument: "target", readOnly: false }],
        resources: ["repo:one"],
      },
      discovery: { actions: ["tool.write"], resources: ["repo:one"] },
    });
    const grant = {
      agentId,
      audience: { humans: ["owner"], agents: [agentId] },
      resources: ["repo:one"],
      operations: { "tool.write": "confirmation" as const },
    };
    await scope((c) => grantConnectionAccess(c, connection.id, grant));
    await scope((c) => grantConnectionAccess(c, active.id, grant));
    const run = await scope((c) =>
      admitRun(c, boss, request(), nativeModelAuthorization, nativeStorage),
    );
    const validateRun = async () => ({ agentId, audience: grant.audience });
    const input = {
      connectionId: connection.id,
      attempt: 1,
      launchKey: crypto.randomUUID(),
      environmentGeneration: 0,
      runId: run.id,
      requestId: crypto.randomUUID(),
      action: "tool.write",
      arguments: { target: "repo:one" },
      target: "repo:one",
    };
    const pending = await scope((c) => requestOperation(c, input, validateRun));
    await scope((c) => disconnectConnection(c, connection.id));
    await expect(
      scope((c) => grantConnectionAccess(c, connection.id, grant)),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Reproduce stale/corrupt unrevoked rows separately from the normal disconnect write.
    await database.db
      .update(grants)
      .set({ revokedAt: null })
      .where(eq(grants.connectionId, connection.id));
    expect(
      (await scope((c) => snapshotGrants(c, agentId))).map(
        (g) => g.connectionId,
      ),
    ).toEqual([active.id]);
    await expect(
      scope((c) => requestOperation(c, input, validateRun)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        requestOperation(
          c,
          { ...input, requestId: crypto.randomUUID() },
          validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        approveOperation(
          c,
          pending.id,
          { identity: pending.identity ?? "" },
          validateRun,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const allowed = await scope((c) =>
      requestOperation(
        c,
        {
          ...input,
          connectionId: active.id,
          requestId: crypto.randomUUID(),
        },
        validateRun,
      ),
    );
    await scope((c) =>
      approveOperation(
        c,
        allowed.id,
        { identity: allowed.identity ?? "" },
        validateRun,
      ),
    );
    const unconnected = await makeConnection();
    await expect(
      scope((c) => grantConnectionAccess(c, unconnected.id, grant)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await dispatchRun(database.db, run.id);
  });
  const mutations: [string, Partial<RunRequest>][] = [
    ["Chat", { chatId: crypto.randomUUID() }],
    ["Agent", { agentId: crypto.randomUUID() }],
    ["type", { type: "script" }],
    ["body", { body: "Different" }],
    ["Documents", { documentIds: [crypto.randomUUID()] }],
    ["Messages", { messageIds: [crypto.randomUUID()] }],
    ["Task", { taskId: crypto.randomUUID() }],
    ["Session", { sessionId: crypto.randomUUID() }],
    ["Schedule ID", { scheduleId: crypto.randomUUID() }],
    ["Schedule token", { scheduleEditToken: 1 }],
  ];
  it.each(mutations)(
    "conflicts on changed %s request controls without new side effects",
    async (_name, change) => {
      const input = request();
      const run = await scope((c) =>
        admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
      );
      const before = await database.pool.query(
        "select (select count(*) from runs)::int as runs, (select count(*) from agent_sessions)::int as sessions, (select count(*) from queue.job)::int as jobs",
      );
      await expect(
        scope((c) =>
          admitRun(
            c,
            boss,
            { ...input, ...change },
            nativeModelAuthorization,
            nativeStorage,
          ),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        (
          await scope((c) =>
            admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
          )
        ).id,
      ).toBe(run.id);
      const after = await database.pool.query(
        "select (select count(*) from runs)::int as runs, (select count(*) from agent_sessions)::int as sessions, (select count(*) from queue.job)::int as jobs",
      );
      expect(after.rows).toEqual(before.rows);
      await dispatchRun(database.db, run.id);
    },
  );
  it("pins explicit Task, Session, skill and Schedule controls independently of resolved fields", async () => {
    const project = await scope((c) => createProject(c, { title: "Identity" }));
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Task" }),
    );
    const skill = await scope((c) =>
      createSkill(c, {
        title: "Skill",
        instructions: "Exact",
        visibility: "workspace",
      }),
    );
    const chat = await scope(async (c) => {
      const row = await createChat(c, {
        title: "Identity",
        visibility: "workspace",
        projectId: project.id,
      });
      await createParticipant(c, row.id, { agentId, role: "contributor" });
      return row;
    });
    const initial = {
      ...request(),
      chatId: chat.id,
      taskId: task.id,
    };
    await selectSkills([skill.id]);
    const seed = await scope((c) =>
      admitRun(c, boss, initial, nativeModelAuthorization, nativeStorage),
    );
    const sessionId = (
      await database.db.select().from(runs).where(eq(runs.id, seed.id))
    )[0]?.sessionId;
    if (!sessionId) throw new Error("Expected private Session");
    await dispatchRun(database.db, seed.id);
    const schedule = await scope((c) =>
      createSchedule(c, boss, {
        title: "Manual",
        agentId,
        chatId: chat.id,
        type: "prompt",
        body: "Work",
        status: "disabled" as const,
        timezone: "UTC",
      }),
    );
    const input: RunRequest = {
      ...initial,
      requestId: crypto.randomUUID(),
      taskId: task.id,
      sessionId,
      scheduleId: schedule.id,
      scheduleEditToken: 0,
    };
    const run = await scope((c) =>
      admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
    );
    const stored = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    const { chatId, scheduleId, scheduleEditToken, ...controls } = input;
    // Private accepted identity keys keep the historical names so exact old retries still match.
    expect(stored?.requestIdentity).toEqual({
      ...controls,
      conversationId: chatId,
      automationId: scheduleId,
      automationEditToken: scheduleEditToken,
      sessionMode: null,
      documentIds: [],
      messageIds: [],
    });
    for (const key of [
      "taskId",
      "sessionId",
      "scheduleId",
      "scheduleEditToken",
    ] as const) {
      await expect(
        scope((c) =>
          admitRun(
            c,
            boss,
            { ...input, [key]: undefined },
            nativeModelAuthorization,
            nativeStorage,
          ),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          { ...input, sessionMode: "fresh" },
          nativeModelAuthorization,
          nativeStorage,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      scope((c) =>
        admitRun(
          c,
          boss,
          { ...input, scheduleEditToken: 1 },
          nativeModelAuthorization,
          nativeStorage,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await scope((c) =>
          admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
        )
      ).id,
    ).toBe(run.id);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    ).toEqual(stored);
    expect(
      await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } }),
    ).toHaveLength(1);
    await dispatchRun(database.db, run.id);
  });
  it("fails closed for legacy Runs whose original caller controls cannot be recovered", async () => {
    const input = request();
    const run = await scope((c) =>
      admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
    );
    // Represents an existing row after the additive nullable-column migration.
    await database.db
      .update(runs)
      .set({ requestIdentity: null })
      .where(eq(runs.id, run.id));
    await expect(
      scope((c) =>
        admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } }),
    ).toHaveLength(1);
    await dispatchRun(database.db, run.id);
  });
  it("normalizes omitted controls while preserving original default skills and source snapshots on retry", async () => {
    const skill = await scope((c) =>
      createSkill(c, {
        title: "Default skill",
        instructions: "Original",
        visibility: "workspace",
      }),
    );
    await selectSkills([skill.id]);
    const input = request();
    const run = await scope((c) =>
      admitRun(c, boss, input, nativeModelAuthorization, nativeStorage),
    );
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    await scope((c) =>
      updateSkill(c, skill.id, {
        title: "Default skill",
        instructions: "Edited",
        editToken: 0,
      }),
    );
    await selectSkills([]);
    await database.db
      .update(agents)
      .set({ instructions: "Edited", editToken: 1 })
      .where(eq(agents.id, agentId));
    expect(
      (
        await scope((c) =>
          admitRun(
            c,
            boss,
            {
              ...input,
              taskId: undefined,
              sessionId: undefined,
              scheduleId: undefined,
              scheduleEditToken: undefined,
            },
            nativeModelAuthorization,
            nativeStorage,
          ),
        )
      ).id,
    ).toBe(run.id);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    ).toEqual(saved);
    expect(saved?.inputs.skills[0]?.instructions).toBe("Original");
    const explicit = await scope((c) =>
      admitRun(
        c,
        boss,
        {
          ...input,
          requestId: crypto.randomUUID(),
        },
        nativeModelAuthorization,
        nativeStorage,
      ),
    );
    expect(explicit.id).not.toBe(run.id);
    expect(
      await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } }),
    ).toHaveLength(1);
    await dispatchRun(database.db, run.id);
    await dispatchRun(database.db, explicit.id);
  });
});
