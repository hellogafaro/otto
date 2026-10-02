import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJobs } from "../apps/server/src/jobs";
import { createAgent } from "../packages/agents/src";
import { agents } from "../packages/agents/src/schema";
import {
  type ArtifactStorage,
  getArtifact,
  getArtifacts,
  readArtifact,
  saveArtifact,
} from "../packages/artifacts/src";
import { createAutomation } from "../packages/automations/src";
import {
  approveOperation,
  createConnection,
  disconnectConnection,
  grantConnection,
  requestOperation,
  snapshotGrants,
} from "../packages/connections/src";
import { connections, grants } from "../packages/connections/src/schema";
import {
  addParticipant,
  createConversation,
} from "../packages/conversations/src";
import {
  createDocument,
  getDocument,
  saveDocument,
  snapshotSkills,
} from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import { addProjectMember, createProject } from "../packages/projects/src";
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
  const request = (): RunRequest => ({
    requestId: crypto.randomUUID(),
    conversationId,
    agentId,
    kind: "prompt",
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
    boss = await startJobs(database.db, database.pool, false, true);
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
          name: "Worker",
          instructions: "Work",
          harness: "fixture",
          harnessRelease: "unqualified",
          model: "selected",
        })
      ).id;
      await createEnvironment(c, agentId);
      conversationId = (
        await createConversation(c, { title: "Work", access: "inherited" })
      ).id;
      await addParticipant(c, conversationId, { agentId, role: "contributor" });
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
    async (kind) => {
      const original = await member();
      const project =
        kind === "project"
          ? await scope((c) => createProject(c, { name: "Output" }))
          : undefined;
      if (project)
        await scope((c) =>
          addProjectMember(c, project.id, original.userId, "viewer"),
        );
      const conversation = await scope(async (c) => {
        const row = await createConversation(c, {
          title: "Output",
          access: "inherited",
          projectId: project?.id,
        });
        await addParticipant(c, row.id, { agentId, role: "contributor" });
        return row;
      });
      const run = await scope((c) =>
        admitRun(c, boss, { ...request(), conversationId: conversation.id }),
      );
      const bytes = new Uint8Array([1, 2, 3]);
      const artifact = await saveArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        {
          requestId: crypto.randomUUID(),
          title: "Saved output",
          kind: "text",
          access: "inherited",
          mediaType: "text/plain",
          sourceRunId: run.id,
          projectId: project?.id,
        },
        bytes,
      );
      const later = await member();
      if (project)
        await scope((c) =>
          addProjectMember(c, project.id, later.userId, "viewer"),
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
  it("requires an agent grant for restricted Documents and Artifacts despite the sponsor's ownership", async () => {
    const actor = { userId: "owner", agentId };
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Private",
        body: "private",
        access: "restricted",
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
    const artifact = await saveArtifact(
      database.db,
      storage,
      workspaceId,
      { userId: "owner" },
      {
        requestId: crypto.randomUUID(),
        title: "Private",
        kind: "text",
        access: "restricted",
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
        access: "restricted",
      });
      await addParticipant(c, row.id, { agentId, role: "contributor" });
      return row;
    });
    const run = await scope((c) =>
      admitRun(c, boss, {
        ...request(),
        conversationId: conversation.id,
        skillIds: [doc.id],
      }),
    );
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.inputs.skills[0]?.instructions,
    ).toBe("private");
    await dispatchRun(database.db, run.id);
  });
  it("denies regrant, stale grants, requests and approvals for a disconnected Connection", async () => {
    const makeConnection = () =>
      scope((c) =>
        createConnection(c, {
          name: "Fixture account",
          kind: "github",
          accountRef: crypto.randomUUID(),
          mode: "service",
        }),
      );
    const connection = await makeConnection();
    const active = await makeConnection();
    // Explicit connected-state fixture only: no provider or reconnect route exists.
    await database.db.update(connections).set({ connected: true });
    const grant = {
      agentId,
      resources: ["repo:one"],
      operations: { write: "confirmation" as const },
    };
    await scope((c) => grantConnection(c, connection.id, grant));
    await scope((c) => grantConnection(c, active.id, grant));
    const run = await scope((c) => admitRun(c, boss, request()));
    const input = {
      connectionId: connection.id,
      agentId,
      runId: run.id,
      requestId: crypto.randomUUID(),
      action: "write",
      target: "repo:one",
    };
    const pending = await scope((c) => requestOperation(c, input));
    await scope((c) => disconnectConnection(c, connection.id));
    await expect(
      scope((c) => grantConnection(c, connection.id, grant)),
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
      scope((c) => requestOperation(c, input)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) =>
        requestOperation(c, { ...input, requestId: crypto.randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) => approveOperation(c, pending.id)),
    ).rejects.toMatchObject({ code: "forbidden" });
    const allowed = await scope((c) =>
      requestOperation(c, {
        ...input,
        connectionId: active.id,
        requestId: crypto.randomUUID(),
      }),
    );
    await scope((c) => approveOperation(c, allowed.id));
    const unconnected = await makeConnection();
    await expect(
      scope((c) => grantConnection(c, unconnected.id, grant)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await dispatchRun(database.db, run.id);
  });
  const mutations: [string, Partial<RunRequest>][] = [
    ["Conversation", { conversationId: crypto.randomUUID() }],
    ["Agent", { agentId: crypto.randomUUID() }],
    ["kind", { kind: "script" }],
    ["body", { body: "Different" }],
    ["skills", { skillIds: [] }],
    ["Task", { taskId: crypto.randomUUID() }],
    ["Session", { sessionId: crypto.randomUUID() }],
    ["Automation ID", { automationId: crypto.randomUUID() }],
    ["Automation token", { automationToken: 1 }],
  ];
  it.each(mutations)(
    "conflicts on changed %s request controls without new side effects",
    async (_name, change) => {
      const input = request();
      const run = await scope((c) => admitRun(c, boss, input));
      const before = await database.pool.query(
        "select (select count(*) from run)::int as runs, (select count(*) from agent_session)::int as sessions, (select count(*) from otto_jobs.job)::int as jobs",
      );
      await expect(
        scope((c) => admitRun(c, boss, { ...input, ...change })),
      ).rejects.toMatchObject({ code: "conflict" });
      expect((await scope((c) => admitRun(c, boss, input))).id).toBe(run.id);
      const after = await database.pool.query(
        "select (select count(*) from run)::int as runs, (select count(*) from agent_session)::int as sessions, (select count(*) from otto_jobs.job)::int as jobs",
      );
      expect(after.rows).toEqual(before.rows);
      await dispatchRun(database.db, run.id);
    },
  );
  it("pins explicit Task, Session, skill and Automation controls independently of resolved fields", async () => {
    const project = await scope((c) => createProject(c, { name: "Identity" }));
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Task" }),
    );
    const skill = await scope((c) =>
      createDocument(c, {
        title: "Skill",
        body: "Exact",
        access: "inherited",
        skill: true,
      }),
    );
    const conversation = await scope(async (c) => {
      const row = await createConversation(c, {
        title: "Identity",
        access: "inherited",
        projectId: project.id,
      });
      await addParticipant(c, row.id, { agentId, role: "contributor" });
      return row;
    });
    const initial = {
      ...request(),
      conversationId: conversation.id,
      skillIds: [skill.id],
    };
    const seed = await scope((c) => admitRun(c, boss, initial));
    const sessionId = (
      await database.db.select().from(runs).where(eq(runs.id, seed.id))
    )[0]?.sessionId;
    if (!sessionId) throw new Error("Expected private Session");
    await dispatchRun(database.db, seed.id);
    const automation = await scope((c) =>
      createAutomation(c, boss, {
        name: "Manual",
        agentId,
        conversationId: conversation.id,
        kind: "prompt",
        body: "Work",
        skillIds: [skill.id],
        enabled: false,
        timezone: "UTC",
      }),
    );
    const input: RunRequest = {
      ...initial,
      requestId: crypto.randomUUID(),
      taskId: task.id,
      sessionId,
      automationId: automation.id,
      automationToken: 0,
    };
    const run = await scope((c) => admitRun(c, boss, input));
    const stored = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(stored?.requestIdentity).toEqual(input);
    for (const key of [
      "taskId",
      "sessionId",
      "skillIds",
      "automationId",
      "automationToken",
    ] as const) {
      await expect(
        scope((c) => admitRun(c, boss, { ...input, [key]: undefined })),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    await expect(
      scope((c) =>
        admitRun(c, boss, { ...input, skillIds: [crypto.randomUUID()] }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      scope((c) => admitRun(c, boss, { ...input, automationToken: 1 })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await scope((c) => admitRun(c, boss, input))).id).toBe(run.id);
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
    const run = await scope((c) => admitRun(c, boss, input));
    // Represents an existing row after the additive nullable-column migration.
    await database.db
      .update(runs)
      .set({ requestIdentity: null })
      .where(eq(runs.id, run.id));
    await expect(scope((c) => admitRun(c, boss, input))).rejects.toMatchObject({
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
        access: "inherited",
        skill: true,
      }),
    );
    await database.db
      .update(agents)
      .set({ skillIds: [skill.id] })
      .where(eq(agents.id, agentId));
    const input = request();
    const run = await scope((c) => admitRun(c, boss, input));
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    await scope((c) =>
      saveDocument(c, skill.id, {
        title: "Default skill",
        body: "Edited",
        editToken: 0,
      }),
    );
    await database.db
      .update(agents)
      .set({ skillIds: [], instructions: "Edited", configToken: 1 })
      .where(eq(agents.id, agentId));
    expect(
      (
        await scope((c) =>
          admitRun(c, boss, {
            ...input,
            skillIds: undefined,
            taskId: undefined,
            sessionId: undefined,
            automationId: undefined,
            automationToken: undefined,
          }),
        )
      ).id,
    ).toBe(run.id);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    ).toEqual(saved);
    expect(saved?.inputs.skills[0]?.instructions).toBe("Original");
    const explicit = await scope((c) =>
      admitRun(c, boss, {
        ...input,
        requestId: crypto.randomUUID(),
        skillIds: [],
      }),
    );
    expect(explicit.id).not.toBe(run.id);
    expect(
      await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } }),
    ).toHaveLength(1);
    await dispatchRun(database.db, run.id);
    await dispatchRun(database.db, explicit.id);
  });
});
