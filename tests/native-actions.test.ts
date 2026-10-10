import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { requestNativeAction } from "../apps/server/src/native-actions";
import { startQueue } from "../apps/server/src/queue";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { createNativeRunTools } from "../apps/server/src/tools";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createMessage,
  createParticipant,
  getChatAudience,
  getParticipants,
} from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { connections } from "../packages/connections/src/schema";
import {
  createEnvironment,
  getEnvironment,
} from "../packages/environments/src";
import {
  createDocument,
  createFile,
  getDocument,
  getFolder,
  proposeDocumentChange,
  snapshotRunDocuments,
  updateDocument,
} from "../packages/library/src";
import { documentProposals } from "../packages/library/src/schema";
import {
  createProject,
  deleteProjectMember,
  upsertProjectMember,
} from "../packages/projects/src";
import { projectMembers, projects } from "../packages/projects/src/schema";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  type NativeActionInput,
  nativeActionInput,
  runActions,
} from "../packages/runs/src/action-schema";
import { createRunAction, getRunAction } from "../packages/runs/src/actions";
import {
  type Attempt,
  withRunAttempt,
  withRunEffect,
} from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { createSchedule, updateSchedule } from "../packages/schedules/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  createSkill,
  getSkill,
  proposeSkillChange,
  updateSkill,
} from "../packages/skills/src";
import { skillProposals } from "../packages/skills/src/schema";
import { createTask, createTimesheet, getTask } from "../packages/tasks/src";
import { timesheets } from "../packages/tasks/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { fixtureStorage } from "./fixtures/storage";
import { startPostgres } from "./postgres";

describe("native actions through normal human authentication and private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  let server: Bun.Server<undefined>;
  let app: ReturnType<typeof createApp>;
  let auth: ReturnType<typeof createAuth>;
  let origin: string;
  let workspaceId: string;
  let sponsor: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  const modelActors: { userId: string; agentId?: string }[] = [];
  const json = { "content-type": "application/json" };
  const scope = <T>(
    work: Parameters<typeof inWorkspace<T>>[3],
    userId = sponsor.id,
  ) => inWorkspace(database.db, workspaceId, { userId }, work);
  const rebuild = () => {
    app = createApp({
      db: database.db,
      boss,
      auth,
      nativeStorage: native,
      origin,
      modelAuthorization: {
        authorizeModel: async (c, subscriptionId, model) => {
          modelActors.push({ ...c.actor });
          return nativeModelAuthorization.authorizeModel(
            c,
            subscriptionId,
            model,
          );
        },
      },
    });
  };

  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      install: true,
      workers: false,
    });
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    origin = server.url.origin;
    auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    rebuild();
    async function signup(label: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { ...json, origin },
        body: JSON.stringify({
          name: label,
          email: `${label}@native-actions.example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      const value = (await response.json()) as { user: { id: string } };
      return {
        id: value.user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    }
    sponsor = await signup("sponsor");
    other = await signup("other");
    workspaceId = (
      await claimInstallation(
        database.db,
        sponsor.id,
        "Native approval fixture",
      )
    ).id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other.id, role: "admin" });
  });
  afterAll(async () => {
    await server?.stop(true);
    await native?.close();
    await boss?.stop();
    await database?.stop();
  });

  async function fixture() {
    return scope(async (c) => {
      const project = await createProject(c, { title: "Approval scope" });
      await upsertProjectMember(c, project.id, other.id, "contributor");
      const agent = await createAgent(c, {
        title: "Proposing agent",
        instructions: "Controlled authority fixture, no model invocation",
        model: "fixture",
        visibility: "workspace",
      });
      const environment = await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Approval source",
        projectId: project.id,
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      await createParticipant(c, chat.id, {
        userId: other.id,
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
      if (!run) throw new Error("Missing controlled Run fixture");
      return {
        run,
        project,
        attempt: {
          runId: run.id,
          agentId: agent.id,
          attempt: run.attempt,
          launchKey: run.launchKey,
        } satisfies Attempt,
      };
    });
  }
  async function propose(
    attempt: Attempt,
    input: NativeActionInput,
    toolCallId: string = crypto.randomUUID(),
  ) {
    return withRunAttempt(
      database.db,
      attempt,
      (c, run) =>
        createRunAction(
          c,
          run,
          { toolCallId, input },
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        ),
      undefined,
      native,
      authorizeRunSources,
      snapshotRunDocuments,
    );
  }
  async function proposalFixture(
    resource: "document" | "skill",
    ownerId = sponsor.id,
  ) {
    const execution = await fixture();
    const target = await scope(async (c) => {
      const project = await createProject(c, {
        title: "Proposal target scope",
      });
      await upsertProjectMember(c, project.id, other.id, "contributor");
      return project;
    });
    return scope(async (c) => {
      const source =
        resource === "document"
          ? await createDocument(c, {
              title: "Before proposal",
              body: "Before",
              projectId: target.id,
              visibility: "workspace",
            })
          : await createSkill(c, {
              title: "Before proposal",
              instructions: "Before",
              projectId: target.id,
              visibility: "workspace",
            });
      const proposal =
        resource === "document"
          ? await proposeDocumentChange(c, source.id, {
              title: "Proposed revision",
              body: "Proposed content",
              editToken: source.editToken,
            })
          : await proposeSkillChange(c, source.id, {
              title: "Proposed revision",
              instructions: "Proposed content",
              editToken: source.editToken,
            });
      const input = {
        type:
          resource === "document"
            ? ("document.proposal.resolve" as const)
            : ("skill.proposal.resolve" as const),
        id: source.id,
        proposalId: proposal.id,
        editToken: source.editToken,
        accept: true,
      };
      const read = () =>
        scope(async (ctx) =>
          resource === "document"
            ? await getDocument(ctx, source.id)
            : await getSkill(ctx, source.id),
        );
      const revise = () =>
        scope(async (ctx) => {
          if (resource === "document")
            await updateDocument(ctx, source.id, {
              editToken: source.editToken,
              body: "New human edit",
            });
          else
            await updateSkill(ctx, source.id, {
              editToken: source.editToken,
              instructions: "New human edit",
            });
        }, ownerId);
      const retained = async () =>
        resource === "document"
          ? (
              await database.db
                .select()
                .from(documentProposals)
                .where(eq(documentProposals.id, proposal.id))
            ).length
          : (
              await database.db
                .select()
                .from(skillProposals)
                .where(eq(skillProposals.id, proposal.id))
            ).length;
      return { ...execution, target, input, source, read, revise, retained };
    }, ownerId);
  }
  async function scheduleFixture() {
    const execution = await fixture();
    const schedule = await scope(async (c) => {
      const subscriptionId = await controlledSubscription(c);
      const agent = await createAgent(c, {
        title: "Manual schedule agent",
        instructions: "Queued fixture only",
        model: "fixture",
        subscriptionId,
        visibility: "workspace",
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Manual schedule output",
        visibility: "participants",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      await createParticipant(c, chat.id, {
        userId: other.id,
        role: "contributor",
      });
      return createSchedule(c, boss, {
        title: "Disabled manual target",
        agentId: agent.id,
        chatId: chat.id,
        type: "prompt",
        body: "Queue but never call a model",
        timezone: "UTC",
        status: "disabled",
      });
    });
    return {
      ...execution,
      schedule,
      input: {
        type: "schedule.run" as const,
        id: schedule.id,
        editToken: schedule.editToken,
      },
    };
  }
  function resolve(
    runId: string,
    action: { id: string; digest: string },
    options: {
      decision?: "approve" | "deny";
      digest?: string;
      cookie?: string;
      origin?: string;
      workspaceId?: string;
      extra?: object;
    } = {},
  ) {
    return fetch(
      `${origin}/api/workspaces/${options.workspaceId ?? workspaceId}/runs/${runId}/actions/${action.id}/resolve`,
      {
        method: "POST",
        headers: {
          ...json,
          cookie: options.cookie ?? sponsor.cookie,
          origin: options.origin ?? origin,
        },
        body: JSON.stringify({
          decision: options.decision ?? "approve",
          digest: options.digest ?? action.digest,
          ...options.extra,
        }),
      },
    );
  }
  const pending = async (id: string) =>
    (
      await database.db.select().from(runActions).where(eq(runActions.id, id))
    )[0];

  function invokeTask(
    attempt: Attempt,
    name: "task_update" | "task_status",
    input: unknown,
    toolCallId: string,
  ) {
    const tools = createNativeRunTools(
      database.db,
      boss,
      attempt,
      { native },
      new AbortController().signal,
    );
    const tool = tools[name];
    if (!tool || !("execute" in tool) || !tool.execute)
      throw new Error(`Missing native tool ${name}`);
    return tool.execute(input, { agent: { toolCallId } } as NonNullable<
      Parameters<typeof tool.execute>[1]
    >);
  }

  async function waitForTaskAction(attempt: Attempt, toolCallId: string) {
    for (let tries = 0; tries < 100; tries++) {
      const [row] = await database.db
        .select()
        .from(runActions)
        .where(
          and(
            eq(runActions.runId, attempt.runId),
            eq(runActions.toolCallId, toolCallId),
          ),
        );
      if (row) return row;
      await Bun.sleep(20);
    }
    throw new Error("Task action never became pending");
  }

  it("unifies Task intents while atomically approving every mixed-update field as the actual human", async () => {
    const { attempt, project } = await fixture();
    const tools = createNativeRunTools(
      database.db,
      boss,
      attempt,
      { native },
      new AbortController().signal,
    );
    expect(Object.keys(tools)).toHaveLength(97);
    expect(tools.request_task_update).toBeUndefined();
    expect(tools.request_task_status).toBeUndefined();
    expect(nativeActionInput.options).toHaveLength(50);
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Before native edit" }),
    );
    await invokeTask(
      attempt,
      "task_update",
      { taskId: task.id, editToken: task.editToken, title: "Agent edit" },
      "ordinary-update",
    );
    let current = await scope((c) => getTask(c, task.id));
    expect(current.title).toBe("Agent edit");
    expect(current.ownerId).toBe(sponsor.id);
    await invokeTask(
      attempt,
      "task_status",
      { taskId: task.id, editToken: current.editToken, status: "doing" },
      "ordinary-status",
    );
    current = await scope((c) => getTask(c, task.id));
    expect(current.status).toBe("doing");
    const input = {
      taskId: task.id,
      editToken: current.editToken,
      title: "Approved complete payload",
      notes: "Exact human-approved notes",
      dueAt: "2027-01-01T10:00:00.000Z",
      recurrence: "DTSTART;TZID=UTC:20270101T100000\nRRULE:FREQ=DAILY;COUNT=2",
      ownerId: other.id,
      assigneeUserIds: [other.id],
      assigneeAgentIds: [attempt.agentId],
    };
    const waiting = invokeTask(attempt, "task_update", input, "mixed-update");
    const action = await waitForTaskAction(attempt, "mixed-update");
    const { taskId: _, ...fields } = input;
    expect(action.input).toEqual({
      type: "task.update",
      id: task.id,
      ...fields,
    });
    expect(await scope((c) => getTask(c, task.id))).toEqual(current);
    expect(
      (await resolve(attempt.runId, action, { cookie: other.cookie })).status,
    ).toBe(403);
    expect((await resolve(attempt.runId, action)).status).toBe(200);
    const receipt = await waiting;
    expect(receipt).toMatchObject({
      status: "approved",
      resolvedBy: sponsor.id,
      result: { id: task.id },
    });
    current = await scope((c) => getTask(c, task.id));
    expect(current).toMatchObject({
      title: input.title,
      notes: input.notes,
      dueAt: new Date(input.dueAt),
      recurrence: input.recurrence,
      ownerId: other.id,
      assigneeUserIds: [other.id],
      assigneeAgentIds: [attempt.agentId],
      editToken: input.editToken + 1,
    });
    expect(
      await invokeTask(attempt, "task_update", input, "mixed-update"),
    ).toEqual(receipt);
    expect(await scope((c) => getTask(c, task.id))).toEqual(current);
    await expect(
      invokeTask(
        attempt,
        "task_update",
        { ...input, notes: "Changed" },
        "mixed-update",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const done = invokeTask(
      attempt,
      "task_status",
      { taskId: task.id, editToken: current.editToken, status: "done" },
      "human-done",
    );
    const doneAction = await waitForTaskAction(attempt, "human-done");
    expect((await scope((c) => getTask(c, task.id))).status).toBe("doing");
    expect((await resolve(attempt.runId, doneAction)).status).toBe(200);
    expect(await done).toMatchObject({
      status: "approved",
      resolvedBy: sponsor.id,
    });
    expect((await scope((c) => getTask(c, task.id))).status).toBe("done");
  });

  it.each(["task_update", "task_status"] as const)(
    "keeps %s denial and changed-payload retries fenced across human and Agent branches",
    async (name) => {
      const { attempt, project } = await fixture();
      const task = await scope((c) =>
        createTask(c, { projectId: project.id, title: "No denied mutation" }),
      );
      const input = {
        taskId: task.id,
        editToken: task.editToken,
        ...(name === "task_update"
          ? { title: "Never saved", assigneeUserIds: [] }
          : { status: "done" }),
      };
      const waiting = invokeTask(attempt, name, input, "denied-intent");
      const action = await waitForTaskAction(attempt, "denied-intent");
      expect(
        (await resolve(attempt.runId, action, { digest: "0".repeat(64) }))
          .status,
      ).toBe(409);
      expect(
        (await resolve(attempt.runId, action, { decision: "deny" })).status,
      ).toBe(200);
      const receipt = await waiting;
      expect(receipt).toMatchObject({ status: "denied", result: null });
      expect(await invokeTask(attempt, name, input, "denied-intent")).toEqual(
        receipt,
      );
      expect((await resolve(attempt.runId, action)).status).toBe(409);
      const changed = {
        taskId: task.id,
        editToken: task.editToken,
        ...(name === "task_update"
          ? { title: "Agent branch bypass" }
          : { status: "doing" }),
      };
      await expect(
        invokeTask(attempt, name, changed, "denied-intent"),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await scope((c) => getTask(c, task.id))).toEqual(task);
    },
  );

  it("rolls back all mixed Task edits when the approved owner is not currently eligible", async () => {
    const { attempt, project } = await fixture();
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Atomic original" }),
    );
    const waiting = invokeTask(
      attempt,
      "task_update",
      {
        taskId: task.id,
        editToken: task.editToken,
        title: "Must not save",
        notes: "Must not save either",
        dueAt: "2027-01-01T10:00:00.000Z",
        ownerId: crypto.randomUUID(),
      },
      "invalid-owner",
    );
    const action = await waitForTaskAction(attempt, "invalid-owner");
    expect((await resolve(attempt.runId, action)).status).toBe(403);
    expect(await scope((c) => getTask(c, task.id))).toEqual(task);
    expect((await pending(action.id))?.status).toBe("pending");
    expect(
      (await resolve(attempt.runId, action, { decision: "deny" })).status,
    ).toBe(200);
    expect(await waiting).toMatchObject({ status: "denied" });
  });

  it.each(["document", "skill"] as const)(
    "applies an approved %s proposal once with native receipt attribution",
    async (resource) => {
      const target = await proposalFixture(resource);
      const action = await propose(
        target.attempt,
        target.input,
        "proposal-accept",
      );
      const waiting = requestNativeAction(
        database.db,
        target.attempt,
        { toolCallId: "proposal-accept", input: target.input },
        new AbortController().signal,
        native,
      ).catch((error: unknown) => error);
      const responses = await Promise.all([
        resolve(target.run.id, action),
        resolve(target.run.id, action),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const receipts = await Promise.all(
        responses.map((response) => response.json()),
      );
      expect(receipts[0]).toEqual(receipts[1]);
      expect(receipts[0]).toMatchObject({
        proposedByAgentId: target.run.agentId,
        resolvedBy: sponsor.id,
        result: {
          id: target.source.id,
          editToken: target.source.editToken + 1,
        },
      });
      expect(await waiting).toMatchObject({
        id: action.id,
        status: "approved",
      });
      expect(await target.read()).toMatchObject({
        title: "Proposed revision",
        editToken: target.source.editToken + 1,
      });
      expect(await target.retained()).toBe(0);
      rebuild();
      expect((await resolve(target.run.id, action)).status).toBe(200);
    },
  );

  it.each(["document", "skill"] as const)(
    "distinguishes denying the %s action from explicitly rejecting its proposal",
    async (resource) => {
      const target = await proposalFixture(resource);
      const action = await propose(target.attempt, target.input);
      expect(
        (await resolve(target.run.id, action, { decision: "deny" })).status,
      ).toBe(200);
      expect(
        (await resolve(target.run.id, action, { decision: "deny" })).status,
      ).toBe(200);
      expect((await resolve(target.run.id, action)).status).toBe(409);
      expect(await target.read()).toMatchObject({
        title: "Before proposal",
        editToken: target.source.editToken,
      });
      expect(await target.retained()).toBe(1);
      const reject = await propose(target.attempt, {
        ...target.input,
        accept: false,
      });
      expect((await resolve(target.run.id, reject)).status).toBe(200);
      expect(await target.retained()).toBe(0);
      expect(await target.read()).toMatchObject({
        title: "Before proposal",
        editToken: target.source.editToken,
      });
    },
  );

  it.each(["document", "skill"] as const)(
    "rejects a stale %s proposal source and mutated decision",
    async (resource) => {
      const target = await proposalFixture(resource);
      const action = await propose(
        target.attempt,
        target.input,
        "proposal-exact",
      );
      await expect(
        propose(
          target.attempt,
          { ...target.input, accept: false },
          "proposal-exact",
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      await target.revise();
      expect((await resolve(target.run.id, action)).status).toBe(409);
      expect((await pending(action.id))?.status).toBe("pending");
      expect(await target.retained()).toBe(1);
      expect(await target.read()).toMatchObject({
        editToken: target.source.editToken + 1,
        title: "Before proposal",
      });
    },
  );

  it.each(["document", "skill"] as const)(
    "rechecks %s proposal creator authority and target Project revocation",
    async (resource) => {
      const foreign = await proposalFixture(resource, other.id);
      const foreignAction = await propose(foreign.attempt, foreign.input);
      expect((await resolve(foreign.run.id, foreignAction)).status).toBe(403);
      expect(await foreign.retained()).toBe(1);
      const target = await proposalFixture(resource);
      const action = await propose(target.attempt, target.input);
      expect(
        (await resolve(target.run.id, action, { cookie: other.cookie })).status,
      ).toBe(403);
      await scope(
        (c) => deleteProjectMember(c, target.target.id, sponsor.id),
        other.id,
      );
      expect((await resolve(target.run.id, action)).status).toBe(403);
      expect((await pending(action.id))?.status).toBe("pending");
      expect(await target.retained()).toBe(1);
    },
  );

  it("queues one owner-authorized manual Schedule Run with action UUID and actual sponsor model authorization", async () => {
    const target = await scheduleFixture();
    const action = await propose(
      target.attempt,
      target.input,
      "manual-schedule",
    );
    const waiting = requestNativeAction(
      database.db,
      target.attempt,
      { toolCallId: "manual-schedule", input: target.input },
      new AbortController().signal,
      native,
    ).catch((error: unknown) => error);
    const before = modelActors.length;
    const responses = await Promise.all([
      resolve(target.run.id, action),
      resolve(target.run.id, action),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const receipts = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await waiting).toMatchObject({ id: action.id, status: "approved" });
    const admitted = await database.db
      .select()
      .from(runs)
      .where(eq(runs.scheduleId, target.schedule.id));
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      state: "queued",
      requestId: action.id,
      sponsorId: sponsor.id,
      agentId: target.schedule.agentId,
      scheduleEditToken: target.schedule.editToken,
    });
    expect(receipts[0]).toMatchObject({
      proposedByAgentId: target.run.agentId,
      resolvedBy: sponsor.id,
      result: { id: admitted[0]?.id },
    });
    expect(modelActors.slice(before)).toEqual([{ userId: sponsor.id }]);
    expect(
      await boss.findJobs(RUN_QUEUE, { data: { runId: admitted[0]?.id } }),
    ).toHaveLength(1);
    rebuild();
    expect((await resolve(target.run.id, action)).status).toBe(200);
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.requestId, action.id)),
    ).toHaveLength(1);
  });

  it("denies a manual Schedule action without creating a Run or dispatch job", async () => {
    const target = await scheduleFixture();
    const action = await propose(target.attempt, target.input);
    expect(
      (await resolve(target.run.id, action, { decision: "deny" })).status,
    ).toBe(200);
    expect(
      (await resolve(target.run.id, action, { decision: "deny" })).status,
    ).toBe(200);
    expect((await resolve(target.run.id, action)).status).toBe(409);
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.scheduleId, target.schedule.id)),
    ).toHaveLength(0);
  });

  it("rejects a stale manual Schedule configuration without admission", async () => {
    const target = await scheduleFixture();
    const action = await propose(target.attempt, target.input);
    await scope((c) =>
      updateSchedule(c, boss, target.schedule.id, {
        editToken: target.schedule.editToken,
        body: "Changed after approval display",
      }),
    );
    expect((await resolve(target.run.id, action)).status).toBe(409);
    expect((await pending(action.id))?.status).toBe("pending");
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.scheduleId, target.schedule.id)),
    ).toHaveLength(0);
  });

  it("rejects manual Schedule launch after owner transfer and denies the other authenticated human", async () => {
    const target = await scheduleFixture();
    const action = await propose(target.attempt, target.input);
    expect(
      (await resolve(target.run.id, action, { cookie: other.cookie })).status,
    ).toBe(403);
    const changed = await scope((c) =>
      updateSchedule(c, boss, target.schedule.id, {
        editToken: target.schedule.editToken,
        ownerId: other.id,
      }),
    );
    expect((await resolve(target.run.id, action)).status).toBe(409);
    const current = await propose(target.attempt, {
      ...target.input,
      editToken: changed.editToken,
    });
    expect((await resolve(target.run.id, current)).status).toBe(403);
    expect((await pending(current.id))?.status).toBe("pending");
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.scheduleId, target.schedule.id)),
    ).toHaveLength(0);
  });

  it("binds exact canonical arguments, run, agent and tool identity without accepting actor input", async () => {
    const { attempt } = await fixture();
    const input = { type: "project.create", title: "Exact proposal" } as const;
    const first = await propose(attempt, input, "stable-call");
    expect(await propose(attempt, input, "stable-call")).toEqual(first);
    await expect(
      propose(attempt, { ...input, title: "Mutated" }, "stable-call"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      nativeActionInput.safeParse({ ...input, actor: { userId: other.id } })
        .success,
    ).toBe(false);
    expect(
      nativeActionInput.safeParse({
        type: "FunctionCall",
        function: "createProject",
        args: input,
      }).success,
    ).toBe(false);
    expect((await pending(first.id))?.agentId).toBe(attempt.agentId);
  });

  it("requires the original authenticated sponsor and same-origin exact approval", async () => {
    const { attempt } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Auth boundary",
    });
    expect((await resolve(attempt.runId, action, { cookie: "" })).status).toBe(
      401,
    );
    expect(
      (await resolve(attempt.runId, action, { cookie: other.cookie })).status,
    ).toBe(403);
    expect(
      (
        await resolve(attempt.runId, action, {
          origin: "https://wrong.example.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (await resolve(attempt.runId, action, { digest: "0".repeat(64) })).status,
    ).toBe(409);
    expect(
      (
        await resolve(attempt.runId, action, {
          extra: { userId: sponsor.id, agentId: attempt.agentId },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await resolve(attempt.runId, action, {
          workspaceId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect((await pending(action.id))?.status).toBe("pending");
    expect(
      await database.db
        .select()
        .from(projects)
        .where(eq(projects.title, "Auth boundary")),
    ).toHaveLength(0);
  });

  it("executes racing double clicks once and persists both proposer and actual approver", async () => {
    const { attempt } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Exactly once",
    });
    const responses = await Promise.all([
      resolve(attempt.runId, action),
      resolve(attempt.runId, action),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const receipts = await Promise.all(responses.map((r) => r.json()));
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]).toMatchObject({
      status: "approved",
      proposedByAgentId: attempt.agentId,
      resolvedBy: sponsor.id,
    });
    expect(
      await database.db
        .select()
        .from(projects)
        .where(eq(projects.title, "Exactly once")),
    ).toHaveLength(1);
    expect(
      (await resolve(attempt.runId, action, { decision: "deny" })).status,
    ).toBe(409);
    expect(
      (await resolve(attempt.runId, action, { cookie: other.cookie })).status,
    ).toBe(403);
    rebuild();
    expect(await (await resolve(attempt.runId, action)).json()).toEqual(
      receipts[0],
    );
  });

  it("denial has a stable receipt and never executes the proposed operation", async () => {
    const { attempt } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Denied project",
    });
    const first = await resolve(attempt.runId, action, { decision: "deny" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      status: "denied",
      result: null,
      resolvedBy: sponsor.id,
    });
    expect((await resolve(attempt.runId, action)).status).toBe(409);
    expect(
      await database.db
        .select()
        .from(projects)
        .where(eq(projects.title, "Denied project")),
    ).toHaveLength(0);
  });

  it("lists only current sponsor-authorized exact pending payloads", async () => {
    const { attempt } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Inspect exact payload",
    });
    const path = `${origin}/api/workspaces/${workspaceId}/runs/${attempt.runId}/actions`;
    const response = await fetch(path, { headers: { cookie: sponsor.cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [
        {
          id: action.id,
          digest: action.digest,
          input: { type: "project.create", title: "Inspect exact payload" },
        },
      ],
      next: null,
    });
    expect(
      (await fetch(path, { headers: { cookie: other.cookie } })).status,
    ).toBe(403);
  });

  it.each(["stop", "deadline", "attempt", "launch", "terminal"] as const)(
    "rejects a %s fence changed after proposal",
    async (fence) => {
      const { attempt } = await fixture();
      const action = await propose(attempt, {
        type: "project.create",
        title: `Fence ${fence}`,
      });
      const change =
        fence === "stop"
          ? { stopRequested: true }
          : fence === "deadline"
            ? { deadlineAt: new Date(0) }
            : fence === "attempt"
              ? { attempt: attempt.attempt + 1 }
              : fence === "launch"
                ? { launchKey: crypto.randomUUID() }
                : { state: "interrupted" as const };
      await scope(async (c) => {
        await c.tx.update(runs).set(change).where(eq(runs.id, attempt.runId));
      });
      expect((await resolve(attempt.runId, action)).status).toBe(403);
      expect((await pending(action.id))?.status).toBe("pending");
      expect(
        await database.db
          .select()
          .from(projects)
          .where(eq(projects.title, `Fence ${fence}`)),
      ).toHaveLength(0);
    },
  );

  it("rechecks workspace role, membership, project role and Agent participation at execution", async () => {
    const { attempt, run, project } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Revoked proposal",
    });
    await database.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, sponsor.id),
        ),
      );
    expect((await resolve(attempt.runId, action)).status).toBe(403);
    await database.db
      .delete(members)
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, sponsor.id),
        ),
      );
    expect((await resolve(attempt.runId, action)).status).toBe(403);
    await database.db
      .insert(members)
      .values({ workspaceId, userId: sponsor.id, role: "owner" });
    await database.db
      .update(projectMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, sponsor.id),
        ),
      );
    expect((await resolve(attempt.runId, action)).status).toBe(403);
    await database.db
      .update(projectMembers)
      .set({ role: "contributor" })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, sponsor.id),
        ),
      );
    await database.db
      .delete(participants)
      .where(
        and(
          eq(participants.chatId, run.chatId),
          eq(participants.agentId, run.agentId),
        ),
      );
    expect((await resolve(attempt.runId, action)).status).toBe(403);
    expect((await pending(action.id))?.status).toBe("pending");
  });

  it("rejects stale target editToken and rolls back operation and receipt together", async () => {
    const { attempt } = await fixture();
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Original",
        body: "Original",
        visibility: "workspace",
      }),
    );
    const action = await propose(attempt, {
      type: "document.update",
      id: doc.id,
      editToken: doc.editToken,
      body: "Agent proposed body",
    });
    await scope((c) =>
      updateDocument(c, doc.id, {
        editToken: doc.editToken,
        body: "Human revised body",
      }),
    );
    expect((await resolve(attempt.runId, action)).status).toBe(409);
    expect((await scope((c) => getDocument(c, doc.id))).body).toBe(
      "Human revised body",
    );
    expect((await pending(action.id))?.status).toBe("pending");
    const badAttachment = await propose(attempt, {
      type: "document.attachments",
      id: doc.id,
      editToken: doc.editToken + 1,
      fileIds: [crypto.randomUUID()],
    });
    expect((await resolve(attempt.runId, badAttachment)).status).not.toBe(200);
    expect((await pending(badAttachment.id))?.status).toBe("pending");
    expect((await scope((c) => getDocument(c, doc.id))).fileIds).toEqual([]);
  });

  it("keeps human Task Done and creator-only Timesheet mutations behind actual approval", async () => {
    const { attempt, project } = await fixture();
    const task = await scope((c) =>
      createTask(c, { projectId: project.id, title: "Done requires a human" }),
    );
    const action = await propose(attempt, {
      type: "task.status",
      id: task.id,
      editToken: task.editToken,
      status: "done",
    });
    expect((await scope((c) => getTask(c, task.id))).status).toBe("todo");
    expect((await resolve(attempt.runId, action)).status).toBe(200);
    expect((await scope((c) => getTask(c, task.id))).status).toBe("done");
    const entry = await scope(
      (c) => createTimesheet(c, { taskId: task.id, duration: 10 }),
      other.id,
    );
    const forbidden = await propose(attempt, {
      type: "timesheet.update",
      id: entry.id,
      duration: 90,
    });
    expect((await resolve(attempt.runId, forbidden)).status).toBe(403);
    expect(
      (
        await database.db
          .select()
          .from(timesheets)
          .where(eq(timesheets.id, entry.id))
      )[0]?.duration,
    ).toBe(10);
    const own = await propose(attempt, {
      type: "timesheet.create",
      taskId: task.id,
      duration: 5,
    });
    expect((await resolve(attempt.runId, own)).status).toBe(200);
    expect(
      await database.db
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.taskId, task.id),
            eq(timesheets.createdBy, sponsor.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it("returns a waiting native tool's durable receipt without retaining a second transcript", async () => {
    const { attempt } = await fixture();
    const controller = new AbortController();
    const input = {
      type: "project.create",
      title: "Waiting native action",
    } as const;
    const waiting = requestNativeAction(
      database.db,
      attempt,
      { toolCallId: "waiting", input },
      controller.signal,
      native,
    );
    let row: typeof runActions.$inferSelect | undefined;
    for (let tries = 0; tries < 100 && !row; tries++) {
      row = (
        await database.db
          .select()
          .from(runActions)
          .where(
            and(
              eq(runActions.runId, attempt.runId),
              eq(runActions.toolCallId, "waiting"),
            ),
          )
      )[0];
      if (!row) await Bun.sleep(20);
    }
    if (!row) throw new Error("Action never became pending");
    const actionId = row.id;
    expect((await resolve(attempt.runId, row)).status).toBe(200);
    expect(await waiting).toMatchObject({
      id: row.id,
      status: "approved",
      result: { id: expect.any(String) },
    });
    expect(await propose(attempt, input, "waiting")).toMatchObject({
      id: row.id,
      status: "approved",
    });
    await database.db
      .update(runs)
      .set({ stopRequested: true })
      .where(eq(runs.id, attempt.runId));
    await expect(
      withRunAttempt(
        database.db,
        attempt,
        (c, run) =>
          getRunAction(
            c,
            run,
            actionId,
            native,
            undefined,
            snapshotRunDocuments,
          ),
        undefined,
        native,
        undefined,
        snapshotRunDocuments,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await resolve(attempt.runId, row)).status).toBe(403);
  });

  it("retains receipt history after terminal Run but rejects replay and foreign readers", async () => {
    const { attempt } = await fixture();
    const action = await propose(attempt, {
      type: "project.create",
      title: "Terminal receipt",
    });
    expect((await resolve(attempt.runId, action)).status).toBe(200);
    await database.db
      .update(runs)
      .set({ state: "finished" })
      .where(eq(runs.id, attempt.runId));
    rebuild();
    const path = `${origin}/api/workspaces/${workspaceId}/runs/${attempt.runId}/actions`;
    const response = await fetch(path, { headers: { cookie: sponsor.cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{ id: action.id, status: "approved", resolvedBy: sponsor.id }],
    });
    expect(
      await (
        await fetch(`${path}?status=pending`, {
          headers: { cookie: sponsor.cookie },
        })
      ).json(),
    ).toMatchObject({ items: [] });
    expect(
      (await fetch(path, { headers: { cookie: other.cookie } })).status,
    ).toBe(403);
    expect((await resolve(attempt.runId, action)).status).toBe(403);
  });

  it("reserves approval calls against cross-tool identity reuse", async () => {
    const { attempt } = await fixture();
    await withRunEffect(
      database.db,
      attempt,
      {
        toolCallId: "cross-tool",
        toolName: "file_create",
        input: { title: "First effect" },
      },
      async () => ({ id: crypto.randomUUID() }),
      undefined,
      native,
      undefined,
      snapshotRunDocuments,
    );
    await expect(
      requestNativeAction(
        database.db,
        attempt,
        {
          toolCallId: "cross-tool",
          input: { type: "project.create", title: "Second effect forbidden" },
        },
        new AbortController().signal,
        native,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await database.db
        .select()
        .from(runActions)
        .where(eq(runActions.runId, attempt.runId)),
    ).toHaveLength(0);
  });

  it("executes concrete write families through HTTP preserving transport invariants", async () => {
    const { attempt } = await fixture();
    const approve = async (input: NativeActionInput) => {
      const action = await propose(attempt, input);
      const response = await resolve(attempt.runId, action);
      expect(response.status, input.type).toBe(200);
      return (
        (await response.json()) as { result: { id: string; editToken: number } }
      ).result;
    };
    const project = await approve({
      type: "project.create",
      title: "Action target",
    });
    await approve({
      type: "project.update",
      id: project.id,
      title: "Updated action target",
    });
    await approve({
      type: "project.member.upsert",
      id: project.id,
      userId: other.id,
      role: "contributor",
    });
    await approve({
      type: "project.member.update",
      id: project.id,
      userId: other.id,
      role: "viewer",
    });
    await approve({
      type: "project.member.delete",
      id: project.id,
      userId: other.id,
    });
    const folder = await approve({
      type: "folder.create",
      title: "Approved folder",
      visibility: "workspace",
      projectId: project.id,
    });
    await approve({
      type: "folder.update",
      id: folder.id,
      title: "Renamed folder",
    });
    expect((await scope((c) => getFolder(c, folder.id))).title).toBe(
      "Renamed folder",
    );
    const collection = await approve({
      type: "collection.create",
      title: "Approved collection",
      projectId: project.id,
      fields: [],
    });
    const updatedCollection = await approve({
      type: "collection.update",
      id: collection.id,
      editToken: collection.editToken,
      view: "list",
    });
    const document = await approve({
      type: "document.create",
      title: "Approved document",
      body: "Exact body",
      projectId: project.id,
      folderId: folder.id,
      visibility: "workspace",
    });
    const updatedDocument = await approve({
      type: "document.update",
      id: document.id,
      editToken: document.editToken,
      body: "Edited exact body",
    });
    const placedDocument = await approve({
      type: "document.collection",
      id: document.id,
      editToken: updatedDocument.editToken,
      collectionId: collection.id,
      properties: {},
    });
    const attached = await approve({
      type: "document.attachments",
      id: document.id,
      editToken: placedDocument.editToken,
      fileIds: [],
    });
    await approve({
      type: "document.archive",
      id: document.id,
      editToken: attached.editToken,
      archived: true,
    });
    await approve({
      type: "collection.archive",
      id: collection.id,
      editToken: updatedCollection.editToken,
      archived: true,
    });
    const skill = await approve({
      type: "skill.create",
      title: "Approved skill",
      instructions: "Do the work",
      visibility: "workspace",
    });
    const updatedSkill = await approve({
      type: "skill.update",
      id: skill.id,
      editToken: skill.editToken,
      instructions: "Updated instructions",
    });
    const skillFiles = await approve({
      type: "skill.files",
      id: skill.id,
      editToken: updatedSkill.editToken,
      files: [],
    });
    const agent = await approve({
      type: "agent.create",
      title: "Configured by approval",
      instructions: "Work",
      model: "fixture",
      visibility: "workspace",
      skillIds: [skill.id],
    });
    expect((await scope((c) => getEnvironment(c, agent.id))).state).toBe(
      "unavailable",
    );
    const updatedAgent = await approve({
      type: "agent.update",
      id: agent.id,
      editToken: agent.editToken,
      title: "Edited Agent",
    });
    const chat = await approve({
      type: "chat.create",
      title: "Approved Chat",
      visibility: "participants",
    });
    await approve({ type: "chat.update", id: chat.id, title: "Renamed Chat" });
    await approve({
      type: "chat.participant.create",
      id: chat.id,
      userId: other.id,
      role: "contributor",
    });
    const participant = (
      await scope((c) => getParticipants(c, chat.id))
    ).items.find((p) => p.userId === other.id);
    if (!participant) throw new Error("Missing participant");
    await approve({
      type: "chat.participant.update",
      id: chat.id,
      participantId: participant.id,
      role: "viewer",
    });
    await approve({
      type: "chat.participant.delete",
      id: chat.id,
      participantId: participant.id,
    });
    const schedule = await approve({
      type: "schedule.create",
      title: "Disabled schedule",
      agentId: agent.id,
      chatId: chat.id,
      runType: "prompt",
      body: "Work later",
      timezone: "UTC",
      status: "disabled",
    });
    await approve({
      type: "schedule.update",
      id: schedule.id,
      editToken: schedule.editToken,
      title: "Renamed schedule",
    });
    const connection = await approve({
      type: "connection.create",
      title: "Connection metadata",
      connectionType: "mcp",
      accountRef: "controlled-fixture",
      visibility: "workspace",
    });
    const configured = await approve({
      type: "connection.update",
      id: connection.id,
      editToken: connection.editToken,
      title: "Renamed connection",
      config: {
        type: "mcp",
        endpoint: "https://fixture.example.test/mcp",
        resources: ["fixture"],
        tools: [{ name: "read", targetArgument: "resource", readOnly: true }],
      },
    });
    await database.db
      .update(connections)
      .set({
        connected: true,
        discovery: { actions: ["read"], resources: ["fixture"] },
      })
      .where(eq(connections.id, connection.id));
    await approve({
      type: "connection.grant",
      id: connection.id,
      editToken: configured.editToken,
      agentId: agent.id,
      audience: { humans: [sponsor.id], agents: [agent.id] },
      resources: ["fixture"],
      operations: { read: "allowed" },
    });
    await approve({
      type: "connection.revoke",
      id: connection.id,
      editToken: configured.editToken,
      agentId: agent.id,
    });
    await approve({
      type: "connection.disconnect",
      id: connection.id,
      editToken: configured.editToken,
    });
    await approve({
      type: "agent.archive",
      id: agent.id,
      editToken: updatedAgent.editToken,
      archived: true,
    });
    await approve({
      type: "skill.archive",
      id: skill.id,
      editToken: skillFiles.editToken,
      archived: true,
    });
    await approve({ type: "chat.archive", id: chat.id, archived: true });
    const emptyFolder = await approve({
      type: "folder.create",
      title: "Empty archive target",
      visibility: "workspace",
    });
    await approve({
      type: "folder.archive",
      id: emptyFolder.id,
      archived: true,
    });
    const task = await scope((c) =>
      createTask(c, {
        projectId: project.id,
        title: "Owner and assignee approval",
      }),
    );
    const assigned = await approve({
      type: "task.update",
      id: task.id,
      editToken: task.editToken,
      ownerId: sponsor.id,
      assigneeUserIds: [sponsor.id],
    });
    await approve({
      type: "task.archive",
      id: task.id,
      editToken: assigned.editToken,
      archived: true,
    });
    const entry = await approve({
      type: "timesheet.create",
      taskId: task.id,
      duration: 5,
    });
    await approve({ type: "timesheet.update", id: entry.id, duration: 10 });
    await approve({ type: "timesheet.delete", id: entry.id });
    expect(
      await database.db
        .select()
        .from(timesheets)
        .where(eq(timesheets.id, entry.id)),
    ).toHaveLength(0);
    await approve({
      type: "skill.import",
      visibility: "user",
      skillMd:
        "---\nname: approved-import\ndescription: Controlled import\n---\nInstructions",
    });
    await approve({ type: "project.archive", id: project.id, archived: true });
  });

  it("rolls back widened Document and Skill visibility when retained Files forbid the new audience", async () => {
    const { attempt } = await fixture();
    const objects = new Map<string, Uint8Array>();
    const storage = fixtureStorage({
      async put(key, bytes) {
        objects.set(key, bytes);
      },
      async get(key) {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("Missing bytes");
        return bytes;
      },
    });
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: sponsor.id },
      {
        requestId: crypto.randomUUID(),
        title: "Private reference",
        type: "text",
        mediaType: "text/plain",
        visibility: "user",
      },
      new TextEncoder().encode("Private bytes never in approval receipt"),
    );
    const approve = async (input: NativeActionInput) => {
      const action = await propose(attempt, input);
      const response = await resolve(attempt.runId, action);
      expect(response.status).toBe(200);
      return (
        (await response.json()) as { result: { id: string; editToken: number } }
      ).result;
    };
    const doc = await approve({
      type: "document.create",
      title: "Private doc",
      body: "Private body",
      visibility: "user",
    });
    const attached = await approve({
      type: "document.attachments",
      id: doc.id,
      editToken: doc.editToken,
      fileIds: [file.id],
    });
    const widening = await propose(attempt, {
      type: "document.update",
      id: doc.id,
      editToken: attached.editToken,
      visibility: "workspace",
    });
    expect((await resolve(attempt.runId, widening)).status).toBe(403);
    expect(await scope((c) => getDocument(c, doc.id))).toMatchObject({
      visibility: "user",
      editToken: attached.editToken,
    });
    expect((await pending(widening.id))?.status).toBe("pending");
    const skill = await approve({
      type: "skill.create",
      title: "Private skill",
      instructions: "Private instructions",
      visibility: "user",
    });
    const linked = await approve({
      type: "skill.files",
      id: skill.id,
      editToken: skill.editToken,
      files: [{ path: "references/private.txt", fileId: file.id }],
    });
    const widenSkill = await propose(attempt, {
      type: "skill.update",
      id: skill.id,
      editToken: linked.editToken,
      visibility: "workspace",
    });
    expect((await resolve(attempt.runId, widenSkill)).status).toBe(403);
    expect(await scope((c) => getSkill(c, skill.id))).toMatchObject({
      visibility: "user",
      editToken: linked.editToken,
    });
    expect((await pending(widenSkill.id))?.status).toBe("pending");
    await approve({
      type: "file.update",
      id: file.id,
      title: "Renamed private reference",
    });
    await approve({ type: "file.archive", id: file.id, archived: true });
  });

  it("authorizes attached sources during native creation, polling and HTTP approval, then rejects audience revocation", async () => {
    const { attempt, run } = await fixture();
    const attachmentProject = await scope(async (c) => {
      const project = await createProject(c, { title: "Attachment audience" });
      await upsertProjectMember(c, project.id, other.id, "contributor");
      return project;
    });
    const bytes = new TextEncoder().encode("Controlled attached source");
    const storage = fixtureStorage({
      async put() {},
      async get() {
        return bytes;
      },
    });
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: sponsor.id },
      {
        requestId: crypto.randomUUID(),
        title: "Source file",
        type: "text",
        mediaType: "text/plain",
        projectId: attachmentProject.id,
        visibility: "workspace",
      },
      bytes,
    );
    const message = await createMessage(
      database.db,
      native,
      workspaceId,
      { userId: sponsor.id },
      run.chatId,
      {
        requestId: crypto.randomUUID(),
        body: "Use this source",
        fileIds: [file.id],
      },
    );
    await database.db
      .update(runs)
      .set({
        inputs: {
          ...run.inputs,
          context: {
            task: null,
            documents: [],
            messages: [
              { id: message.id, body: message.body, fileIds: [file.id] },
            ],
          },
        },
      })
      .where(eq(runs.id, run.id));
    const controller = new AbortController();
    const waiting = requestNativeAction(
      database.db,
      attempt,
      {
        toolCallId: "attached-source",
        input: {
          type: "project.create",
          title: "Authorized attachment approval",
        },
      },
      controller.signal,
      native,
    );
    const outcome = waiting.catch((error: unknown) => error);
    let row: typeof runActions.$inferSelect | undefined;
    for (let tries = 0; tries < 100 && !row; tries++) {
      row = (
        await database.db
          .select()
          .from(runActions)
          .where(
            and(
              eq(runActions.runId, run.id),
              eq(runActions.toolCallId, "attached-source"),
            ),
          )
      )[0];
      if (!row) await Bun.sleep(20);
    }
    if (!row) {
      controller.abort();
      throw new Error("Attached-source action never became pending");
    }
    const actionId = row.id;
    expect((await resolve(run.id, row)).status).toBe(200);
    expect(await outcome).toMatchObject({ status: "approved", id: row.id });
    const next = await propose(attempt, {
      type: "project.create",
      title: "Revoked attachment approval",
    });
    await scope((c) => deleteProjectMember(c, attachmentProject.id, other.id));
    expect((await resolve(run.id, next)).status).toBe(403);
    expect((await pending(next.id))?.status).toBe("pending");
    expect(
      await database.db
        .select()
        .from(projects)
        .where(eq(projects.title, "Revoked attachment approval")),
    ).toHaveLength(0);
    await expect(
      withRunAttempt(
        database.db,
        attempt,
        (c, current) =>
          getRunAction(
            c,
            current,
            actionId,
            native,
            authorizeRunSources,
            snapshotRunDocuments,
          ),
        undefined,
        native,
        authorizeRunSources,
        snapshotRunDocuments,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("cancels waiting on abort without approving or performing a side effect", async () => {
    const { attempt } = await fixture();
    const controller = new AbortController();
    const waiting = requestNativeAction(
      database.db,
      attempt,
      {
        toolCallId: "aborted",
        input: { type: "project.create", title: "Abort no effect" },
      },
      controller.signal,
      native,
    );
    const outcome = expect(waiting).rejects.toThrow();
    await Bun.sleep(50);
    controller.abort(new Error("Fixture stop"));
    await outcome;
    expect(
      await database.db
        .select()
        .from(projects)
        .where(eq(projects.title, "Abort no effect")),
    ).toHaveLength(0);
  });
});
