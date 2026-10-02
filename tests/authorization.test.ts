import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { agentSkills, agents } from "../packages/agents/src/schema";
import {
  type ArtifactStorage,
  createArtifact,
  getArtifact,
  getArtifacts,
  readArtifact,
} from "../packages/artifacts/src";
import { createAutomation } from "../packages/automations/src";
import {
  approveOperation,
  createConnection,
  disconnectConnection,
  grantConnectionAccess,
  requestOperation,
  snapshotGrants,
} from "../packages/connections/src";
import { connections, grants } from "../packages/connections/src/schema";
import {
  createConversation,
  createParticipant,
} from "../packages/conversations/src";
import {
  createDocument,
  getDocument,
  snapshotSkills,
  updateDocument,
} from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import {
  admitRun,
  dispatchRun,
  RUN_QUEUE,
  type RunRequest,
} from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { createTask } from "../packages/tasks/src";
import {
  type Actor,
  claimInstallation,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { harnesses } from "./fixtures/harnesses";
import { startPostgres } from "./postgres";

describe("review authorization and admission regressions", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let workspaceId: string;
  let agentId: string;
  let conversationId: string;
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
    conversationId,
    agentId,
    type: "prompt",
    body: "Work",
  });
  // Named in-memory storage fixture: tests authorization around I/O, not Garage.
  const objects = new Map<string, Uint8Array>();
  const storage: ArtifactStorage = {
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing fixture object");
      return bytes;
    },
  };
  beforeAll(async () => {
    database = await startPostgres();
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
          visibility: "workspace",
          title: "Worker",
          instructions: "Work",
          harness: "fixture",
          model: "selected",
        })
      ).id;
      await createEnvironment(c, agentId);
      conversationId = (
        await createConversation(c, { title: "Work", visibility: "workspace" })
      ).id;
      await createParticipant(c, conversationId, {
        agentId,
        role: "contributor",
      });
    });
  });
  afterAll(async () => {
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
    "caps saved Run artifacts after later %s membership",
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
      const conversation = await scope(async (c) => {
        const row = await createConversation(c, {
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
          { ...request(), conversationId: conversation.id },
          harnesses,
        ),
      );
      const bytes = new Uint8Array([1, 2, 3]);
      const artifact = await createArtifact(
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
          await scope((c) => getArtifacts(c, { projectId: project?.id }), later)
        ).items.map((a) => a.id),
      ).not.toContain(artifact.id);
      await expect(
        scope((c) => getArtifact(c, artifact.id), later),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        readArtifact(database.db, storage, workspaceId, later, artifact.id),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        (
          await scope(
            (c) => getArtifacts(c, { projectId: project?.id }),
            original,
          )
        ).items.map((a) => a.id),
      ).toContain(artifact.id);
      expect(
        await readArtifact(
          database.db,
          storage,
          workspaceId,
          original,
          artifact.id,
        ),
      ).toEqual(bytes);
      // Revoke during storage fetch: the second production authorization must reject.
      const revoking: ArtifactStorage = {
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
        readArtifact(database.db, revoking, workspaceId, original, artifact.id),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        scope((c) => getArtifact(c, artifact.id), original),
      ).rejects.toMatchObject({ code: "forbidden" });
      await dispatchRun(database.db, run.id);
    },
  );
  it("requires an agent grant for user-scoped Documents and Artifacts despite the sponsor's ownership", async () => {
    const actor = { userId: "owner", agentId };
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Private",
        body: "private",
        visibility: "user",
        skill: true,
      }),
    );
    expect((await scope((c) => getDocument(c, doc.id))).body).toBe("private");
    await expect(
      scope((c) => getDocument(c, doc.id), actor),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(
        (c) =>
          snapshotSkills(c, [doc.id], { humans: ["owner"], agents: [agentId] }),
        actor,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const artifact = await createArtifact(
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
      scope((c) => getArtifact(c, artifact.id), actor),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await scope((c) => getArtifacts(c, {}), actor)).items.map((a) => a.id),
    ).not.toContain(artifact.id);
    await expect(
      readArtifact(database.db, storage, workspaceId, actor, artifact.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await readArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        artifact.id,
      ),
    ).toEqual(new Uint8Array([4]));
    // Human-authorized one-agent Run input remains a separate explicit admission path.
    const conversation = await scope(async (c) => {
      const row = await createConversation(c, {
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
          conversationId: conversation.id,
        },
        harnesses,
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
    const run = await scope((c) => admitRun(c, boss, request(), harnesses));
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
    ["Conversation", { conversationId: crypto.randomUUID() }],
    ["Agent", { agentId: crypto.randomUUID() }],
    ["type", { type: "script" }],
    ["body", { body: "Different" }],
    ["Documents", { documentIds: [crypto.randomUUID()] }],
    ["Messages", { messageIds: [crypto.randomUUID()] }],
    ["Task", { taskId: crypto.randomUUID() }],
    ["Session", { sessionId: crypto.randomUUID() }],
    ["Automation ID", { automationId: crypto.randomUUID() }],
    ["Automation token", { automationEditToken: 1 }],
  ];
  it.each(mutations)(
    "conflicts on changed %s request controls without new side effects",
    async (_name, change) => {
      const input = request();
      const run = await scope((c) => admitRun(c, boss, input, harnesses));
      const before = await database.pool.query(
        "select (select count(*) from runs)::int as runs, (select count(*) from agent_sessions)::int as sessions, (select count(*) from queue.job)::int as jobs",
      );
      await expect(
        scope((c) => admitRun(c, boss, { ...input, ...change }, harnesses)),
      ).rejects.toMatchObject({ code: "conflict" });
      expect((await scope((c) => admitRun(c, boss, input, harnesses))).id).toBe(
        run.id,
      );
      const after = await database.pool.query(
        "select (select count(*) from runs)::int as runs, (select count(*) from agent_sessions)::int as sessions, (select count(*) from queue.job)::int as jobs",
      );
      expect(after.rows).toEqual(before.rows);
      await dispatchRun(database.db, run.id);
    },
  );
  it("pins explicit Task, Session, skill and Automation controls independently of resolved fields", async () => {
    const project = await scope((c) => createProject(c, { title: "Identity" }));
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Task" }),
    );
    const skill = await scope((c) =>
      createDocument(c, {
        title: "Skill",
        body: "Exact",
        visibility: "workspace",
        skill: true,
      }),
    );
    const conversation = await scope(async (c) => {
      const row = await createConversation(c, {
        title: "Identity",
        visibility: "workspace",
        projectId: project.id,
      });
      await createParticipant(c, row.id, { agentId, role: "contributor" });
      return row;
    });
    const initial = {
      ...request(),
      conversationId: conversation.id,
      taskId: task.id,
    };
    await selectSkills([skill.id]);
    const seed = await scope((c) => admitRun(c, boss, initial, harnesses));
    const sessionId = (
      await database.db.select().from(runs).where(eq(runs.id, seed.id))
    )[0]?.sessionId;
    if (!sessionId) throw new Error("Expected private Session");
    await dispatchRun(database.db, seed.id);
    const automation = await scope((c) =>
      createAutomation(c, boss, {
        title: "Manual",
        agentId,
        conversationId: conversation.id,
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
      automationId: automation.id,
      automationEditToken: 0,
    };
    const run = await scope((c) => admitRun(c, boss, input, harnesses));
    const stored = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(stored?.requestIdentity).toEqual({
      ...input,
      documentIds: [],
      messageIds: [],
    });
    for (const key of [
      "taskId",
      "sessionId",
      "automationId",
      "automationEditToken",
    ] as const) {
      await expect(
        scope((c) =>
          admitRun(c, boss, { ...input, [key]: undefined }, harnesses),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    await expect(
      scope((c) =>
        admitRun(c, boss, { ...input, automationEditToken: 1 }, harnesses),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await scope((c) => admitRun(c, boss, input, harnesses))).id).toBe(
      run.id,
    );
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
    const run = await scope((c) => admitRun(c, boss, input, harnesses));
    // Represents an existing row after the additive nullable-column migration.
    await database.db
      .update(runs)
      .set({ requestIdentity: null })
      .where(eq(runs.id, run.id));
    await expect(
      scope((c) => admitRun(c, boss, input, harnesses)),
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
      createDocument(c, {
        title: "Default skill",
        body: "Original",
        visibility: "workspace",
        skill: true,
      }),
    );
    await selectSkills([skill.id]);
    const input = request();
    const run = await scope((c) => admitRun(c, boss, input, harnesses));
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    await scope((c) =>
      updateDocument(c, skill.id, {
        title: "Default skill",
        body: "Edited",
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
              automationId: undefined,
              automationEditToken: undefined,
            },
            harnesses,
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
        harnesses,
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
