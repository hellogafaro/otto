import { createTool } from "@mastra/core/tools";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { authorizeRunSources } from "../apps/server/src/run-sources";
import { createNativeRunTools, createRunTools } from "../apps/server/src/tools";
import {
  createDocument,
  resolveDocumentProposal,
  snapshotRunDocuments,
} from "../packages/library/src";
import { documentProposals } from "../packages/library/src/schema";
import { projectMembers } from "../packages/projects/src/schema";
import {
  createRunRuntime,
  type RunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import { required } from "../packages/shared/src";
import { skillProposals } from "../packages/skills/src/schema";

import { setSubscriptionApiKey } from "../packages/subscriptions/src/server";
import { setTaskStatus } from "../packages/tasks/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import {
  controlledModel,
  controlledSubscription,
  fixtureEncryptionKey,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("execution authority and retained sources", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
  const observedResults: unknown[] = [];
  let modelStarts = 0;
  const prompts: unknown[] = [];
  const modelFixtures = new Map<
    string,
    Parameters<typeof controlledModel>[0]
  >();
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let accountId: string;
  let owner: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };

  const record = z.object({ id: z.uuid() });
  async function request(
    path: string,
    body?: unknown,
    human = owner,
    method = "POST",
  ) {
    return fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        cookie: human.cookie,
        origin,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function post(
    path: string,
    body: unknown,
    human = owner,
    method = "POST",
  ) {
    const response = await request(path, body, human, method);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }
  async function setup(projectId?: string, role?: "chat" | "project") {
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        projectId,
        title: "Authority fixture",
        visibility: "workspace",
        instructions: "Work",
        model: "fixture",
        subscriptionId: accountId,
      }),
    ).agent;

    const chat = record.parse(
      await post("/chats", {
        title: "Source",
        visibility: "participants",
        projectId,
      }),
    );
    await post(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    if (role)
      await post(`/chats/${chat.id}/participants`, {
        userId: viewer.id,
        role: role === "chat" ? "viewer" : "contributor",
      });
    return { agent, chat };
  }
  const saved = async (id: string) =>
    z
      .object({
        id: z.uuid(),
        state: z.string(),
        stopRequested: z.boolean(),
        sessionId: z.string().nullable(),
      })
      .parse((await database.db.select().from(runs).where(eq(runs.id, id)))[0]);
  async function launch(
    source: Awaited<ReturnType<typeof setup>>,
    input: {
      body?: string;
      tool?: { name: string; [key: string]: unknown };
      type?: "prompt" | "script";
      documentIds?: string[];
      skillIds?: string[];
      taskId?: string;
    } = {},
  ) {
    const { skillIds, tool, ...selection } = input;
    if (skillIds) {
      const current = z
        .object({ editToken: z.number() })
        .parse(
          await (
            await fetch(
              `${origin}/api/workspaces/${workspaceId}/agents/${source.agent.id}`,
              { headers: { cookie: owner.cookie } },
            )
          ).json(),
        );
      await post(
        `/agents/${source.agent.id}`,
        { skillIds, editToken: current.editToken },
        owner,
        "PATCH",
      );
    }
    const requestId = crypto.randomUUID();
    const {
      name,
      requestId: _requestId,
      ...toolInput
    } = tool ?? { name: "", requestId: undefined };
    modelFixtures.set(requestId, {
      hold: input.body === "hold",
      onPrompt: (prompt) => prompts.push(prompt),
      ...(name
        ? {
            toolRequests: [
              { toolName: name.replaceAll(".", "_"), input: toolInput },
            ],
          }
        : {}),
    });
    const run = record.parse(
      await post("/runs", {
        agentId: source.agent.id,
        chatId: source.chat.id,
        requestId,
        type: "prompt",
        body: "finish",
        ...selection,
      }),
    );
    await expect
      .poll(async () => (await saved(run.id)).state, { timeout: 10000 })
      .not.toBe("queued");
    return run;
  }
  async function terminal(id: string) {
    await expect
      .poll(async () => (await saved(id)).state, { timeout: 10000 })
      .toMatch(/^(finished|failed|interrupted|uncertain)$/);
    await expect.poll(() => runtime.health().active).toBe(0);
    return saved(id);
  }
  beforeAll(async () => {
    expect(process.versions.bun).toBeTruthy();
    database = await startPostgres();
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
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
    async function human(name: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: `${name}@authority.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      const body = z
        .object({
          user: z.object({ id: z.string(), emailVerified: z.literal(false) }),
        })
        .parse(await response.json());
      return {
        id: body.user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    }
    owner = await human("owner");
    viewer = await human("viewer");
    workspaceId = (await claimInstallation(database.db, owner.id, "Authority"))
      .id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: viewer.id, role: "contributor" });
    accountId = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      controlledSubscription,
    );
    runtime = createRunRuntime(database.db, {
      storage: native,
      authorizeSources: authorizeRunSources,
      deadlineMs: 20000,
      resolveModel: async (attempt, signal) => {
        modelStarts++;
        const row = required(
          (
            await database.db
              .select()
              .from(runs)
              .where(eq(runs.id, attempt.runId))
          )[0],
        );
        return controlledModel({ ...modelFixtures.get(row.requestId), signal });
      },
      tools: (attempt, signal) => {
        const tools = createNativeRunTools(
          database.db,
          boss,
          attempt,
          { native, models: nativeModelAuthorization },
          signal,
        );
        return Object.fromEntries(
          Object.entries(tools).map(([name, tool]) => {
            if (!("execute" in tool) || !tool.execute)
              throw new Error("Expected executable native tool");
            const execute = tool.execute;
            return [
              name,
              {
                ...tool,
                execute: async (...args: Parameters<typeof execute>) => {
                  try {
                    const result = await execute(args[0], args[1]);
                    observedResults.push(result);
                    return result;
                  } catch (error) {
                    observedResults.push({ success: false });
                    throw error;
                  }
                },
              },
            ];
          }),
        );
      },
      publishOutput: async () => {},
      snapshotDocuments: snapshotRunDocuments,
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      nativeStorage: native,
      modelAuthorization: nativeModelAuthorization,
      encryptionKey: fixtureEncryptionKey,
      runtime,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
    });
  });
  afterAll(async () => {
    await worker?.stop({ graceful: false });
    await runtime?.close();
    await native?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  function invokeTools() {
    const execute = createRunTools(database.db, boss, {
      native,
      models: nativeModelAuthorization,
    });
    return (identity: Parameters<typeof execute>[0], value: unknown) =>
      execute(identity, value, undefined, crypto.randomUUID());
  }
  it.each(["stop", "shutdown"] as const)(
    "preserves unjoined native server-tool uncertainty after %s and recovery",
    async (control) => {
      await worker.stop({ graceful: false });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const isolated = createRunRuntime(database.db, {
        storage: native,
        authorizeSources: authorizeRunSources,
        resolveModel: async () =>
          controlledModel({
            toolRequests: [{ toolName: "blocked_effect", input: {} }],
          }),
        tools: () => ({
          blocked_effect: createTool({
            id: "blocked_effect",
            description: "Deterministic cancellation-ignoring fixture",
            inputSchema: z.object({}).strict(),
            execute: async () => {
              entered.resolve();
              await release.promise;
              return { late: true };
            },
          }),
        }),
        publishOutput: async () => {},
        snapshotDocuments: snapshotRunDocuments,
      });
      const fresh = createRunRuntime(database.db, {
        storage: native,
        authorizeSources: authorizeRunSources,
        resolveModel: async () => controlledModel(),
        tools: () => ({}),
        publishOutput: async () => {},
        snapshotDocuments: snapshotRunDocuments,
      });
      let dispatch: Promise<void> | undefined;
      try {
        const source = await setup();
        const run = record.parse(
          await post("/runs", {
            agentId: source.agent.id,
            chatId: source.chat.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "Native cancellation fixture",
          }),
        );
        dispatch = isolated.dispatch(run.id);
        await entered.promise;
        const before = performance.now();
        if (control === "stop")
          await isolated.stop(workspaceId, { userId: owner.id }, run.id);
        else await isolated.close();
        expect(performance.now() - before).toBeLessThan(8000);
        expect(await saved(run.id)).toMatchObject({
          state: "uncertain",
          ...(control === "stop" ? { stopRequested: true } : {}),
        });
        await fresh.reconcile(run.id);
        expect((await saved(run.id)).state).toBe("uncertain");
        const next = record.parse(
          await post("/runs", {
            agentId: source.agent.id,
            chatId: source.chat.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "Must stay fenced",
          }),
        );
        await expect(fresh.dispatch(next.id)).rejects.toThrow("busy");
        await fresh.stop(workspaceId, { userId: owner.id }, next.id);
      } finally {
        release.resolve();
        await dispatch;
        await isolated.close();
        await fresh.close();
        worker = await startQueue(database.db, database.pool, { runtime });
      }
    },
  );

  it("isolates accepted Task context from fresh Sessions and refuses incompatible Session reuse", async () => {
    const project = record.parse(
      await post("/projects", { title: "Native retained task" }),
    );
    const task = record.parse(
      await post("/tasks", {
        projectId: project.id,
        title: "Accepted isolated task",
      }),
    );
    const source = await setup(project.id);
    const first = await launch(source, { taskId: task.id });
    expect((await terminal(first.id)).state).toBe("finished");
    expect(JSON.stringify(prompts.at(-1))).toContain("Accepted isolated task");
    expect(
      (
        await request("/runs", {
          agentId: source.agent.id,
          chatId: source.chat.id,
          sessionId: (await saved(first.id)).sessionId,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: "Omit task from retained Session",
        })
      ).status,
    ).toBe(409);
    const next = await launch(source);
    expect((await terminal(next.id)).state).toBe("finished");
    expect((await saved(next.id)).sessionId).not.toBe(
      (await saved(first.id)).sessionId,
    );
    expect(JSON.stringify(prompts.at(-1))).not.toContain(
      "Accepted isolated task",
    );
    expect(JSON.stringify(prompts.at(-1))).not.toContain(task.id);
  });
  it("denies sponsor-inherited private Agent peer requests through a native tool", async () => {
    const source = await setup();
    const target = await setup();
    await post(
      `/agents/${target.agent.id}`,
      { visibility: "user", editToken: 0 },
      owner,
      "PATCH",
    );
    await post(`/chats/${source.chat.id}/participants`, {
      agentId: target.agent.id,
      role: "contributor",
    });
    const before = observedResults.length;
    const run = await launch(source, {
      tool: {
        name: "agent.request",
        requestId: crypto.randomUUID(),
        agentId: target.agent.id,
        body: "finish",
      },
    });
    await terminal(run.id);
    expect(observedResults.slice(before)).toContainEqual(
      expect.objectContaining({ success: false }),
    );
    expect(
      await database.db.select().from(runs).where(eq(runs.parentRunId, run.id)),
    ).toHaveLength(0);
  });
  it.each(["skill", "subscription"] as const)(
    "denies inherited user %s dependencies on workspace peer Agents",
    async (resource) => {
      const source = await setup();
      const target = await setup();
      if (resource === "skill") {
        const skill = record.parse(
          await post("/skills", {
            title: "User skill",
            instructions: "Private",

            visibility: "user",
          }),
        );
        await post(
          `/agents/${target.agent.id}`,
          { skillIds: [skill.id], editToken: 0 },
          owner,
          "PATCH",
        );
      }
      if (resource === "subscription")
        await post(
          `/subscriptions/${accountId}`,
          { visibility: "user" },
          owner,
          "PATCH",
        );
      try {
        await post(`/chats/${source.chat.id}/participants`, {
          agentId: target.agent.id,
          role: "contributor",
        });
        const before = observedResults.length;
        const run = await launch(source, {
          tool: {
            name: "agent.request",
            requestId: crypto.randomUUID(),
            agentId: target.agent.id,
            body: "finish",
          },
        });
        await terminal(run.id);
        expect(observedResults.slice(before)).toContainEqual(
          expect.objectContaining({ success: false }),
        );
        expect(
          await database.db
            .select()
            .from(runs)
            .where(eq(runs.parentRunId, run.id)),
        ).toHaveLength(0);
      } finally {
        if (resource === "subscription")
          await post(
            `/subscriptions/${accountId}`,
            { visibility: "workspace" },
            owner,
            "PATCH",
          );
      }
    },
  );
  it("reauthorizes the accepted native Subscription after Agent selection changes", async () => {
    const source = await setup();
    const run = await launch(source, { body: "hold" });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    await post(
      `/agents/${source.agent.id}`,
      { subscriptionId: null, editToken: 0 },
      owner,
      "PATCH",
    );
    await post(
      `/subscriptions/${accountId}`,
      { status: "disabled" },
      owner,
      "PATCH",
    );
    await expect
      .poll(async () => (await saved(run.id)).state, { timeout: 2000 })
      .toBe("interrupted");
    await post(
      `/subscriptions/${accountId}`,
      { status: "needs_auth" },
      owner,
      "PATCH",
    );
    await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
      setSubscriptionApiKey(
        c,
        accountId,
        { apiKey: "fixture-not-a-real-key" },
        fixtureEncryptionKey,
      ),
    );
  });
  it("keeps noncreator participant Run controls and discussion after creator archive", async () => {
    const source = await setup(undefined, "project");
    const run = await launch(source, { body: "hold" });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    try {
      await post(`/chats/${source.chat.id}/archive`, {
        archived: true,
      });
      expect(
        (
          await request(
            `/runs/${run.id}/steer`,
            { requestId: crypto.randomUUID(), body: "Contributor control" },
            viewer,
          )
        ).status,
      ).toBe(503);
      expect(
        (
          await request(
            `/chats/${source.chat.id}/messages`,
            {
              requestId: crypto.randomUUID(),
              body: "Archived contributor discussion",
            },
            viewer,
          )
        ).status,
      ).toBe(200);
      expect((await request(`/runs/${run.id}/stop`, {}, viewer)).status).toBe(
        200,
      );
      expect((await terminal(run.id)).state).toBe("interrupted");
      await post(`/chats/${source.chat.id}/archive`, {
        archived: false,
      });
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await terminal(run.id);
    }
  });
  it.each(["chat", "project"] as const)(
    "denies %s viewers control without persisting or delivering it",
    async (role) => {
      const project = record.parse(
        await post("/projects", { title: "Control" }),
      );
      await post(`/projects/${project.id}/members`, {
        userId: viewer.id,
        role: role === "project" ? "viewer" : "contributor",
      });
      const source = await setup(project.id, role);
      const run = await launch(source, { body: "hold" });
      await expect
        .poll(async () => (await saved(run.id)).state)
        .toBe("running");
      try {
        const before = await database.db
          .select()
          .from(runActivity)
          .where(eq(runActivity.runId, run.id));
        expect(
          (
            await request(
              `/runs/${run.id}/steer`,
              { requestId: crypto.randomUUID(), body: "Unauthorized" },
              viewer,
            )
          ).status,
        ).toBe(403);
        expect((await request(`/runs/${run.id}/stop`, {}, viewer)).status).toBe(
          403,
        );
        expect(await saved(run.id)).toMatchObject({
          state: "running",
          stopRequested: false,
        });
        expect(
          await database.db
            .select()
            .from(runActivity)
            .where(eq(runActivity.runId, run.id)),
        ).toEqual(before);
        await post(`/projects/${project.id}/archive`, { archived: true });
        await post(`/chats/${source.chat.id}/archive`, {
          archived: true,
          editToken: 0,
        });
        expect(
          (
            await request(`/runs/${run.id}/steer`, {
              requestId: crypto.randomUUID(),
              body: "Authorized archived control",
            })
          ).status,
        ).toBe(503);
      } finally {
        await post(`/runs/${run.id}/stop`, {});
        await terminal(run.id);
      }
    },
  );

  it("does not reuse working state after an accepted Document is revoked and omitted from a fresh Session", async () => {
    const doc = record.parse(
      await post(
        "/documents",
        {
          title: "Retained private source",
          body: "Saved source",
          visibility: "workspace",
        },
        viewer,
      ),
    );
    const source = await setup();
    const first = await launch(source, { documentIds: [doc.id] });
    expect((await terminal(first.id)).state).toBe("finished");
    const launches = modelStarts;
    expect(JSON.stringify(prompts.at(-1))).toContain("Saved source");
    await post(
      `/documents/${doc.id}`,
      { visibility: "user", editToken: 0 },
      viewer,
      "PATCH",
    );
    expect((await request(`/documents/${doc.id}`)).status).toBe(403);
    expect(
      (
        await request("/runs", {
          agentId: source.agent.id,
          chatId: source.chat.id,
          sessionId: (await saved(first.id)).sessionId,
          type: "prompt",
          body: "Reuse revoked source",
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    const next = await launch(source, { documentIds: [] });
    const result = await terminal(next.id);
    expect(result.sessionId).not.toBe((await saved(first.id)).sessionId);
    expect(result.state).toBe("finished");
    expect(modelStarts).toBe(launches + 1);
    expect(JSON.stringify(prompts.at(-1))).not.toContain("Saved source");
    expect(JSON.stringify(prompts.at(-1))).not.toContain(doc.id);
  });

  it("submits a scoped native skill proposal with Agent authorship for human-only application", async () => {
    const project = record.parse(
      await post("/projects", { title: "Proposal" }),
    );
    const doc = record.parse(
      await post("/skills", {
        projectId: project.id,
        title: "accepted-skill",
        instructions: "Original",
        visibility: "workspace",
      }),
    );
    const source = await setup(project.id);
    const run = await launch(source, {
      skillIds: [doc.id],
      tool: {
        name: "skill.proposeChange",
        skillId: doc.id,
        title: "accepted-skill",
        instructions: "Proposed",
        editToken: 0,
      },
    });
    expect((await terminal(run.id)).state).toBe("finished");
    const proposals = await database.db
      .select()
      .from(skillProposals)
      .where(eq(skillProposals.skillId, doc.id));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      agentId: source.agent.id,
      proposerId: owner.id,
      instructions: "Proposed",
      editToken: 0,
    });
    expect(await (await request(`/skills/${doc.id}`)).json()).toMatchObject({
      instructions: "Original",
    });
    await post(
      `/skills/${doc.id}/proposals/${record.parse(proposals[0]).id}/resolve`,
      { accept: true },
    );
    expect(await (await request(`/skills/${doc.id}`)).json()).toMatchObject({
      instructions: "Proposed",
      editToken: 1,
    });
  });
  it("allows current Project reads while preserving private, Project, revocation and accepted-proposal fences", async () => {
    const project = record.parse(
      await post("/projects", { title: "Scoped reads" }),
    );
    const doc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "selected",
        body: "Accepted text",
        visibility: "workspace",
      }),
    );
    const other = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "not selected",
        body: "Not supplied",
        visibility: "workspace",
      }),
    );
    const task = record.parse(
      await post("/tasks", { projectId: project.id, title: "Unaccepted Task" }),
    );
    const source = await setup(project.id);
    const privateDoc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "Private",
        body: "Private content",
        visibility: "user",
      }),
    );
    const otherProject = record.parse(
      await post("/projects", { title: "Outside accepted Project" }),
    );
    const outsideDoc = record.parse(
      await post("/documents", {
        projectId: otherProject.id,
        title: "Outside",
        body: "Outside content",
        visibility: "workspace",
      }),
    );
    const memberProject = record.parse(
      await post("/projects", { title: "Nonmember Project" }),
    );
    const nonmemberDoc = record.parse(
      await post("/documents", {
        projectId: memberProject.id,
        title: "Nonmember",
        body: "Nonmember content",
        visibility: "workspace",
      }),
    );
    await post(`/projects/${memberProject.id}/members`, {
      userId: viewer.id,
      role: "contributor",
    });
    await database.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, memberProject.id),
          eq(projectMembers.userId, owner.id),
        ),
      );
    const otherWorkspace = required(
      (
        await database.db
          .insert(workspaces)
          .values({ title: "Other fixture workspace" })
          .returning()
      )[0],
    );
    await database.db.insert(members).values({
      workspaceId: otherWorkspace.id,
      userId: owner.id,
      role: "owner",
    });
    const crossWorkspace = await inWorkspace(
      database.db,
      otherWorkspace.id,
      { userId: owner.id },
      (c) =>
        createDocument(c, {
          title: "Other workspace",
          body: "Other workspace content",
          visibility: "workspace",
        }),
    );
    const run = await launch(source, { body: "hold", documentIds: [doc.id] });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    const row = required(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    );
    const identity = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    const tool = invokeTools();
    try {
      expect(
        await tool(identity, { name: "document.get", documentId: other.id }),
      ).toMatchObject({ body: "Not supplied" });
      expect(
        await tool(identity, { name: "task.get", taskId: task.id }),
      ).toMatchObject({ title: "Unaccepted Task" });
      for (const documentId of [privateDoc.id, outsideDoc.id, nonmemberDoc.id])
        await expect(
          tool(identity, { name: "document.get", documentId }),
        ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        tool(identity, { name: "document.get", documentId: crossWorkspace.id }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        await tool(identity, {
          name: "document.proposeChange",
          documentId: other.id,
          title: "not selected",
          body: "Current authorized proposal",
          editToken: 0,
        }),
      ).toMatchObject({ documentId: other.id });
      await post(
        `/documents/${doc.id}`,
        { body: "Human edited current content", editToken: 0 },
        owner,
        "PATCH",
      );
      expect(
        await tool(identity, { name: "document.get", documentId: doc.id }),
      ).toMatchObject({ body: "Accepted text" });
      await post(`/documents/${doc.id}/archive`, {
        archived: true,
        editToken: 1,
      });
      expect(
        await tool(identity, { name: "document.get", documentId: doc.id }),
      ).toMatchObject({ body: "Accepted text" });
      await expect(
        tool(identity, {
          name: "document.proposeChange",
          documentId: doc.id,
          title: "selected",
          body: "Stale",
          editToken: 0,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      // Accepted token also prevents choosing a new current token to silently freshen the proposal.
      await expect(
        tool(identity, {
          name: "document.proposeChange",
          documentId: doc.id,
          title: "selected",
          body: "Freshened",
          editToken: 1,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await post(
        `/documents/${other.id}`,
        { visibility: "user", editToken: 0 },
        owner,
        "PATCH",
      );
      await expect(
        tool(identity, { name: "document.get", documentId: other.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        tool(identity, { name: "document.get", documentId: doc.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect((await terminal(run.id)).state).toBe("interrupted");
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await terminal(run.id);
    }
    await expect(
      tool(identity, { name: "document.get", documentId: doc.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("creates a native Task owned by its eligible human sponsor and records Agent authorship", async () => {
    const project = record.parse(
      await post("/projects", { title: "Agent Task" }),
    );
    const source = await setup(project.id);
    const run = await launch(source, {
      tool: {
        name: "task.create",
        title: "Agent captured work",
        notes: "Scoped notes",
      },
    });
    expect((await terminal(run.id)).state).toBe("finished");
    const task = z
      .object({ id: z.uuid(), ownerId: z.string(), status: z.literal("todo") })
      .parse(observedResults.at(-1));
    expect(task.ownerId).toBe(owner.id);
    const messages = z
      .array(
        z.object({ body: z.string(), authorAgentId: z.string().nullable() }),
      )
      .parse(await (await request(`/chats/${source.chat.id}/messages`)).json());
    expect(messages).toContainEqual(
      expect.objectContaining({
        authorAgentId: source.agent.id,
        body: `Created Task ${task.id}: Agent captured work`,
      }),
    );
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id, agentId: source.agent.id },
        (c) => setTaskStatus(c, task.id, { status: "done", editToken: 0 }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const holding = await launch(source, { body: "hold" });
    await expect
      .poll(async () => (await saved(holding.id)).state)
      .toBe("running");
    const row = required(
      (await database.db.select().from(runs).where(eq(runs.id, holding.id)))[0],
    );
    const tool = invokeTools();
    const identity = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    try {
      await expect(
        tool(identity, {
          name: "task.create",
          title: "Forged",
          ownerId: viewer.id,
        }),
      ).rejects.toThrow();
      // Adding an unaccepted recipient must block publication into this wider Project.
      await post(`/projects/${project.id}/members`, {
        userId: viewer.id,
        role: "viewer",
      });
      await expect(
        tool(identity, { name: "task.create", title: "Would leak" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await post(`/runs/${holding.id}/stop`, {});
      await terminal(holding.id);
    }
  });

  it("keeps proposal application human-only and rejects stale source edits and publication to a wider audience", async () => {
    const project = record.parse(
      await post("/projects", { title: "Proposal fencing" }),
    );
    const doc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "selected",
        body: "Original",
        visibility: "workspace",
      }),
    );
    const source = await setup(project.id);
    const run = await launch(source, { body: "hold", documentIds: [doc.id] });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    const row = required(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    );
    const identity = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    const tool = invokeTools();
    const proposalInput = {
      name: "document.proposeChange",
      documentId: doc.id,
      title: "selected",
      body: "Proposal",
      editToken: 0,
    };
    try {
      const proposal = record.parse(await tool(identity, proposalInput));
      await expect(
        withRunAttempt(
          database.db,
          identity,
          (c) => resolveDocumentProposal(c, doc.id, proposal.id, true),
          undefined,
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      await post(
        `/documents/${doc.id}`,
        { body: "Human edit", editToken: 0 },
        owner,
        "PATCH",
      );
      expect(
        (
          await request(
            `/documents/${doc.id}/proposals/${proposal.id}/resolve`,
            { accept: true },
          )
        ).status,
      ).toBe(409);
      await expect(tool(identity, proposalInput)).rejects.toMatchObject({
        code: "conflict",
      });
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await terminal(run.id);
    }
    const wide = record.parse(
      await post("/documents", {
        title: "workspace source",
        body: "Shared",
        visibility: "workspace",
      }),
    );
    const privateSource = await setup();
    const denied = await launch(privateSource, {
      documentIds: [wide.id],
      tool: {
        ...proposalInput,
        documentId: wide.id,
        title: "workspace source",
      },
    });
    await terminal(denied.id);
    expect(observedResults.at(-1)).toMatchObject({ success: false });
    expect(
      await database.db
        .select()
        .from(documentProposals)
        .where(eq(documentProposals.documentId, wide.id)),
    ).toHaveLength(0);
  });

  it("denies viewer Agent admission and reauthorizes its writer role during active execution", async () => {
    const source = await setup();
    const page = z.object({
      items: z.array(
        z.object({ id: z.uuid(), agentId: z.string().nullable() }),
      ),
    });
    const participant = required(
      page
        .parse(
          await (await request(`/chats/${source.chat.id}/participants`)).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/chats/${source.chat.id}/participants/${participant.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/chats/${source.chat.id}/participants`, {
      agentId: source.agent.id,
      role: "viewer",
    });
    const input = {
      agentId: source.agent.id,
      chatId: source.chat.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body: "hold",
    };
    const launches = modelStarts;
    expect((await request("/runs", input)).status).toBe(403);
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.requestId, input.requestId)),
    ).toHaveLength(0);
    const viewerParticipant = required(
      page
        .parse(
          await (await request(`/chats/${source.chat.id}/participants`)).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/chats/${source.chat.id}/participants/${viewerParticipant.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/chats/${source.chat.id}/participants`, {
      agentId: source.agent.id,
      role: "contributor",
    });
    const run = await launch(source, { body: "hold" });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    const current = required(
      page
        .parse(
          await (await request(`/chats/${source.chat.id}/participants`)).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/chats/${source.chat.id}/participants/${current.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/chats/${source.chat.id}/participants`, {
      agentId: source.agent.id,
      role: "viewer",
    });
    await terminal(run.id);
    expect((await saved(run.id)).state).toBe("interrupted");
    expect(modelStarts).toBe(launches + 1);
  });

  it("returns accepted Task content while retaining current Task authorization", async () => {
    const project = record.parse(
      await post("/projects", { title: "Accepted task" }),
    );
    const task = record.parse(
      await post("/tasks", {
        projectId: project.id,
        title: "Accepted A",
        notes: "Notes A",
      }),
    );
    const source = await setup(project.id);
    const run = await launch(source, { body: "hold", taskId: task.id });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    const row = required(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    );
    const identity = {
      runId: row.id,
      agentId: row.agentId,
      attempt: row.attempt,
      launchKey: row.launchKey,
    };
    const tools = invokeTools();
    try {
      await post(
        `/tasks/${task.id}`,
        { title: "Current B", notes: "Notes B", editToken: 0 },
        owner,
        "PATCH",
      );
      expect(
        await tools(identity, { name: "task.get", taskId: task.id }),
      ).toEqual({ id: task.id, title: "Accepted A", notes: "Notes A" });
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await terminal(run.id);
    }
    const next = await launch(source, {
      tool: { name: "task.get", taskId: task.id },
      taskId: task.id,
    });
    await terminal(next.id);
    expect(observedResults.at(-1)).toEqual({
      id: task.id,
      title: "Current B",
      notes: "Notes B",
    });
  });

  it("denies a directed native request to a viewer Agent without creating child work", async () => {
    const source = await setup();
    const target = await setup();
    await post(`/chats/${source.chat.id}/participants`, {
      agentId: target.agent.id,
      role: "viewer",
    });
    const before = observedResults.length;
    const run = await launch(source, {
      tool: {
        name: "agent.request",
        requestId: crypto.randomUUID(),
        agentId: target.agent.id,
        body: "finish",
      },
    });
    await terminal(run.id);
    expect(observedResults.slice(before)).toContainEqual(
      expect.objectContaining({ success: false }),
    );
    expect(
      await database.db.select().from(runs).where(eq(runs.parentRunId, run.id)),
    ).toHaveLength(0);
  });
});
