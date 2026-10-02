import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createRunTools } from "../apps/server/src/tools";
import { createConnection } from "../packages/connections/src";
import { resolveDocumentProposal } from "../packages/documents/src";
import { documentProposals } from "../packages/documents/src/schema";
import type { ProcessInspection } from "../packages/environments/src";
import { environments } from "../packages/environments/src/schema";
import {
  createRunRuntime,
  type RunRuntime,
  withRunAttempt,
} from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { required } from "../packages/shared/src";
import { setTaskStatus } from "../packages/tasks/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { harnesses } from "./fixtures/harnesses";
import { startPostgres } from "./postgres";

/** Real auth/HTTP/PG/queue/runtime; controlled computers prove Otto decisions, not VM containment. */
describe("execution authority and retained sources", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let computer: ControlledComputer;
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let accountId: string;
  let owner: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let stopMode: "confirmed" | "false" | "throw" = "confirmed";
  let stopCalls = 0;
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
  async function setup(projectId?: string, role?: "conversation" | "project") {
    const agent = z.object({ agent: record }).parse(
      await post("/agents", {
        projectId,
        name: "Authority fixture",
        visibility: "workspace",
        instructions: "Work",
        harness: "fixture",
        model: "fixture",
        connectionId: accountId,
      }),
    ).agent;
    await post(`/agents/${agent.id}/computer`, { computerRef: agent.id });
    const conversation = record.parse(
      await post("/conversations", {
        title: "Source",
        access: "restricted",
        projectId,
      }),
    );
    await post(`/conversations/${conversation.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    if (role)
      await post(`/conversations/${conversation.id}/participants`, {
        userId: viewer.id,
        role: role === "conversation" ? "viewer" : "contributor",
      });
    return { agent, conversation };
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
      type?: "prompt" | "script";
      documentIds?: string[];
      skillIds?: string[];
      taskId?: string;
    } = {},
  ) {
    const { skillIds, ...selection } = input;
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
    const run = record.parse(
      await post("/runs", {
        agentId: source.agent.id,
        conversationId: source.conversation.id,
        requestId: crypto.randomUUID(),
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
    // Fixture auth configuration; production verification is exercised in operations.test.ts.
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ db: database.db, boss, auth, origin, harnesses });
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
        .object({ user: z.object({ id: z.string() }) })
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
    accountId = (
      await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        createConnection(c, {
          name: "Fixture native",
          visibility: "workspace",
          type: "model",
          accountRef: "controlled-only",
        }),
      )
    ).id;
    computer = new ControlledComputer(accountId);
    runtime = createRunRuntime(database.db, {
      harnesses,
      deadlineMs: 20000,
      handleTool: createRunTools(database.db, boss, { harnesses }),
      backend: {
        provider: computer.provider,
        inspectComputer: () => computer.inspectComputer(),
        lookup: async (ref, key) => {
          const result = await computer.lookup(ref, key);
          return result.state === "exited"
            ? { ...result, stopped: stopMode === "confirmed" }
            : result;
        },
        launch: async (input) => {
          const process = await computer.launch(input);
          return {
            ...process,
            stop: async () => {
              stopCalls++;
              if (stopMode === "throw")
                throw new Error("Controlled unconfirmed tree");
              if (stopMode === "false") return { stopped: false };
              return process.stop();
            },
          };
        },
      },
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      harnesses,
      runtime,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      harnesses,
    });
  });
  afterAll(async () => {
    await worker?.stop({ graceful: false });
    await computer?.close();
    await runtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("denies sponsor-inherited private Agent peer requests through the actual ACP tool", async () => {
    const source = await setup();
    const target = await setup();
    await post(
      `/agents/${target.agent.id}`,
      { visibility: "user", editToken: 0 },
      owner,
      "PATCH",
    );
    await post(`/conversations/${source.conversation.id}/participants`, {
      agentId: target.agent.id,
      role: "contributor",
    });
    const before = computer.toolResults.length;
    const run = await launch(source, {
      body: `_tool=${JSON.stringify({ name: "agent.request", requestId: crypto.randomUUID(), agentId: target.agent.id, body: "finish" })}`,
    });
    await terminal(run.id);
    expect(computer.toolResults.slice(before)).toContainEqual(
      expect.objectContaining({
        code: -32603,
        message: "Otto operation denied or unavailable",
      }),
    );
    expect(
      await database.db.select().from(runs).where(eq(runs.parentRunId, run.id)),
    ).toHaveLength(0);
  });
  it.each(["skill", "connection"] as const)(
    "denies inherited user %s dependencies on workspace peer Agents",
    async (resource) => {
      const source = await setup();
      const target = await setup();
      if (resource === "skill") {
        const skill = record.parse(
          await post("/documents", {
            title: "User skill",
            body: "Private",
            skill: true,
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
      const account = z
        .object({ editToken: z.number() })
        .parse(await (await request(`/connections/${accountId}`)).json());
      if (resource === "connection")
        await post(
          `/connections/${accountId}`,
          { visibility: "user", editToken: account.editToken },
          owner,
          "PATCH",
        );
      try {
        await post(`/conversations/${source.conversation.id}/participants`, {
          agentId: target.agent.id,
          role: "contributor",
        });
        const before = computer.toolResults.length;
        const run = await launch(source, {
          body: `_tool=${JSON.stringify({ name: "agent.request", requestId: crypto.randomUUID(), agentId: target.agent.id, body: "finish" })}`,
        });
        await terminal(run.id);
        expect(computer.toolResults.slice(before)).toContainEqual(
          expect.objectContaining({ code: -32603 }),
        );
        expect(
          await database.db
            .select()
            .from(runs)
            .where(eq(runs.parentRunId, run.id)),
        ).toHaveLength(0);
      } finally {
        if (resource === "connection")
          await post(
            `/connections/${accountId}`,
            { visibility: "workspace", editToken: account.editToken + 1 },
            owner,
            "PATCH",
          );
      }
    },
  );
  it("reauthorizes the accepted native Connection after Agent selection changes", async () => {
    const source = await setup();
    const run = await launch(source, { body: "hold" });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    await post(
      `/agents/${source.agent.id}`,
      { connectionId: null, editToken: 0 },
      owner,
      "PATCH",
    );
    await post(`/connections/${accountId}/disconnect`, {});
    await expect
      .poll(async () => (await saved(run.id)).state, { timeout: 2000 })
      .toBe("interrupted");
  });
  it.each(["conversation", "project"] as const)(
    "denies %s viewers control without persisting or delivering it",
    async (role) => {
      const project = record.parse(
        await post("/projects", { name: "Control" }),
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
        await expect
          .poll(
            async () =>
              (
                await database.db
                  .select()
                  .from(runActivity)
                  .where(eq(runActivity.runId, run.id))
              ).length,
          )
          .toBe(1);
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
        await post(`/conversations/${source.conversation.id}/archive`, {
          archived: true,
          editToken: 0,
        });
        expect(
          await post(`/runs/${run.id}/steer`, {
            requestId: crypto.randomUUID(),
            body: "Authorized archived control",
          }),
        ).toEqual({ delivered: true });
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
          access: "restricted",
          readerIds: [owner.id],
        },
        viewer,
      ),
    );
    const source = await setup();
    const first = await launch(source, { documentIds: [doc.id] });
    expect((await terminal(first.id)).state).toBe("finished");
    const launches = computer.launches;
    await post(
      `/documents/${doc.id}/access`,
      { readerIds: [], writerIds: [], editToken: 0 },
      viewer,
      "PUT",
    );
    expect((await request(`/documents/${doc.id}`)).status).toBe(403);
    const next = await launch(source, { documentIds: [] });
    const result = await terminal(next.id);
    expect(result.sessionId).not.toBe((await saved(first.id)).sessionId);
    expect(result.state).toBe("failed");
    expect(computer.launches).toBe(launches);
  });

  it.each(["false", "throw"] as const)(
    "keeps the script lease fenced when tree-stop is %s after parent exit",
    async (mode) => {
      const source = await setup();
      const before = stopCalls;
      stopMode = mode;
      try {
        const run = await launch(source, {
          type: "script",
          body: "fixture parent exit",
        });
        expect((await terminal(run.id)).state).toBe("uncertain");
        expect(stopCalls).toBeGreaterThan(before);
        await runtime.reconcile(run.id);
        expect((await saved(run.id)).state).toBe("uncertain");
        const environment = (
          await database.db
            .select()
            .from(environments)
            .where(eq(environments.agentId, source.agent.id))
        )[0];
        expect(environment).toMatchObject({
          state: "uncertain",
          activeRunId: run.id,
        });
      } finally {
        stopMode = "confirmed";
      }
    },
  );

  it("submits a scoped ACP skill proposal with Agent authorship for human-only application", async () => {
    const project = record.parse(await post("/projects", { name: "Proposal" }));
    const doc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "accepted-skill",
        body: "Original",
        visibility: "workspace",
        skill: true,
      }),
    );
    const source = await setup(project.id);
    const run = await launch(source, {
      skillIds: [doc.id],
      body: `_tool=${JSON.stringify({ name: "document.proposeChange", documentId: doc.id, title: "accepted-skill", body: "Proposed", editToken: 0 })}`,
    });
    expect((await terminal(run.id)).state).toBe("finished");
    const proposals = await database.db
      .select()
      .from(documentProposals)
      .where(eq(documentProposals.documentId, doc.id));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      agentId: source.agent.id,
      proposerId: owner.id,
      body: "Proposed",
      editToken: 0,
    });
    expect(await (await request(`/documents/${doc.id}`)).json()).toMatchObject({
      body: "Original",
    });
    await post(
      `/documents/${doc.id}/proposals/${record.parse(proposals[0]).id}/resolve`,
      { accept: true },
    );
    expect(await (await request(`/documents/${doc.id}`)).json()).toMatchObject({
      body: "Proposed",
      editToken: 1,
    });
  });
  it("retains Task scope across new Sessions and refuses incomplete legacy computer scope", async () => {
    const project = record.parse(
      await post("/projects", { name: "Retained task" }),
    );
    const task = record.parse(
      await post("/tasks", { projectId: project.id, title: "Accepted task" }),
    );
    const source = await setup(project.id);
    const first = await launch(source, { taskId: task.id });
    expect((await terminal(first.id)).state).toBe("finished");
    const before = computer.launches;
    const omitted = await launch(source);
    expect((await terminal(omitted.id)).state).toBe("failed");
    expect(computer.launches).toBe(before);
    // A known old shape lacks retained-source identity; never reconstruct it from current grants.
    await database.db
      .update(environments)
      .set({
        executionScope: JSON.stringify({
          humans: [owner.id],
          agents: [source.agent.id],
          grants: [],
          skills: [],
        }),
      })
      .where(eq(environments.agentId, source.agent.id));
    const legacy = await launch(source, { taskId: task.id });
    expect((await terminal(legacy.id)).state).toBe("failed");
    expect(computer.launches).toBe(before);
  });

  it("limits live tool reads/proposals to accepted sources and keeps archive distinct from revoked authority", async () => {
    const project = record.parse(
      await post("/projects", { name: "Scoped reads" }),
    );
    const doc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "selected",
        body: "Accepted text",
        access: "inherited",
      }),
    );
    const other = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "not selected",
        body: "Not supplied",
        access: "inherited",
      }),
    );
    const task = record.parse(
      await post("/tasks", { projectId: project.id, title: "Unaccepted Task" }),
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
    const tool = createRunTools(database.db, boss, { harnesses });
    try {
      await expect(
        tool(identity, { name: "document.get", documentId: other.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        tool(identity, { name: "task.get", taskId: task.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        tool(identity, {
          name: "document.proposeChange",
          documentId: other.id,
          title: "not selected",
          body: "No",
          editToken: 0,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await post(`/documents/${doc.id}/archive`, {
        archived: true,
        editToken: 0,
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
    } finally {
      await post(`/runs/${run.id}/stop`, {});
      await terminal(run.id);
    }
    await expect(
      tool(identity, { name: "document.get", documentId: doc.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("creates an ACP Task owned by its eligible human sponsor and records Agent authorship", async () => {
    const project = record.parse(
      await post("/projects", { name: "Agent Task" }),
    );
    const source = await setup(project.id);
    const run = await launch(source, {
      body: `_tool=${JSON.stringify({ name: "task.create", title: "Agent captured work", notes: "Scoped notes" })}`,
    });
    expect((await terminal(run.id)).state).toBe("finished");
    const task = z
      .object({ id: z.uuid(), ownerId: z.string(), status: z.literal("todo") })
      .parse(computer.toolResults.at(-1));
    expect(task.ownerId).toBe(owner.id);
    const messages = z
      .array(
        z.object({ body: z.string(), authorAgentId: z.string().nullable() }),
      )
      .parse(
        await (
          await request(`/conversations/${source.conversation.id}/messages`)
        ).json(),
      );
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
    const tool = createRunTools(database.db, boss, { harnesses });
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
      await post("/projects", { name: "Proposal fencing" }),
    );
    const doc = record.parse(
      await post("/documents", {
        projectId: project.id,
        title: "selected",
        body: "Original",
        access: "inherited",
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
    const tool = createRunTools(database.db, boss, { harnesses });
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
        withRunAttempt(database.db, identity, (c) =>
          resolveDocumentProposal(c, doc.id, proposal.id, true),
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
        access: "inherited",
      }),
    );
    const privateSource = await setup();
    const denied = await launch(privateSource, {
      documentIds: [wide.id],
      body: `_tool=${JSON.stringify({ ...proposalInput, documentId: wide.id, title: "workspace source" })}`,
    });
    await terminal(denied.id);
    expect(computer.toolResults.at(-1)).toMatchObject({ code: -32603 });
    expect(
      await database.db
        .select()
        .from(documentProposals)
        .where(eq(documentProposals.documentId, wide.id)),
    ).toHaveLength(0);
  });

  it("retains uncertainty when a server tool ignores cancellation despite a confirmed remote tree Stop", async () => {
    await worker.stop({ graceful: false });
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const isolated = createRunRuntime(database.db, {
      backend: computer,
      harnesses,
      deadlineMs: 30000,
      handleTool: async () => {
        entered();
        await blocked;
        return { late: true };
      },
    });
    try {
      const source = await setup();
      const run = record.parse(
        await post("/runs", {
          agentId: source.agent.id,
          conversationId: source.conversation.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: '_tool={"name":"human.ask","body":"Controlled blocked server I/O"}',
        }),
      );
      await isolated.dispatch(run.id);
      await started;
      const before = performance.now();
      expect(
        await isolated.stop(workspaceId, { userId: owner.id }, run.id),
      ).toEqual({ stopped: false });
      expect(performance.now() - before).toBeLessThan(8000);
      expect(await saved(run.id)).toMatchObject({
        state: "uncertain",
        stopRequested: true,
      });
      expect(
        (
          await database.db
            .select()
            .from(environments)
            .where(eq(environments.agentId, source.agent.id))
        )[0],
      ).toMatchObject({ state: "uncertain", activeRunId: run.id });
      await isolated.reconcile(run.id);
      expect((await saved(run.id)).state).toBe("uncertain");
    } finally {
      release();
      await expect(isolated.close()).rejects.toThrow(
        "Runtime persistence/cleanup failed",
      );
      worker = await startQueue(database.db, database.pool, {
        runtime,
        harnesses,
      });
    }
  });
  it.each([false, true])(
    "keeps a pending launch fenced until its eventual tree stop is acknowledged (%s)",
    async (confirmed) => {
      await worker.stop({ graceful: false });
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const isolated = createRunRuntime(database.db, {
        harnesses,
        backend: {
          provider: computer.provider,
          inspectComputer: () => computer.inspectComputer(),
          lookup: (ref, key) => computer.lookup(ref, key),
          launch: async (input) => {
            entered();
            await gate;
            const process = await computer.launch(input);
            return {
              ...process,
              stop: async () =>
                confirmed ? process.stop() : { stopped: false },
            };
          },
        },
      });
      const restarted = createRunRuntime(database.db, {
        backend: computer,
        harnesses,
      });
      let dispatch: Promise<void> | undefined;
      try {
        const source = await setup();
        const run = record.parse(
          await post("/runs", {
            agentId: source.agent.id,
            conversationId: source.conversation.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "hold",
          }),
        );
        dispatch = isolated.dispatch(run.id);
        await started;
        expect(
          await isolated.stop(workspaceId, { userId: owner.id }, run.id),
        ).toEqual({ stopped: false });
        await isolated.reconcile(run.id);
        // A second runtime has no access to the original in-memory starting map.
        await restarted.reconcile(run.id);
        expect((await saved(run.id)).state).toBe("uncertain");
        expect(
          required(
            (
              await database.db
                .select()
                .from(environments)
                .where(eq(environments.agentId, source.agent.id))
            )[0],
          ).activeRunId,
        ).toBe(run.id);
        release();
        await dispatch;
        expect((await saved(run.id)).state).toBe(
          confirmed ? "interrupted" : "uncertain",
        );
        expect(
          required(
            (
              await database.db
                .select()
                .from(environments)
                .where(eq(environments.agentId, source.agent.id))
            )[0],
          ).activeRunId,
        ).toBe(confirmed ? null : run.id);
        if (!confirmed) {
          const next = record.parse(
            await post("/runs", {
              agentId: source.agent.id,
              conversationId: source.conversation.id,
              requestId: crypto.randomUUID(),
              type: "prompt",
              body: "hold",
            }),
          );
          const launches = computer.launches;
          await expect(isolated.dispatch(next.id)).rejects.toMatchObject({
            code: "unavailable",
          });
          await post(`/runs/${next.id}/stop`, {});
          expect(computer.launches).toBe(launches);
        }
      } finally {
        release();
        await dispatch;
        await isolated.close();
        await restarted.close();
        worker = await startQueue(database.db, database.pool, {
          runtime,
          harnesses,
        });
      }
    },
  );

  it("persists unjoined server-tool uncertainty during shutdown and refuses recovery release", async () => {
    await worker.stop({ graceful: false });
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const isolated = createRunRuntime(database.db, {
      backend: computer,
      harnesses,
      handleTool: async () => {
        entered();
        await blocked;
        return { late: true };
      },
    });
    const fresh = createRunRuntime(database.db, {
      backend: computer,
      harnesses,
    });
    try {
      const source = await setup();
      const run = record.parse(
        await post("/runs", {
          agentId: source.agent.id,
          conversationId: source.conversation.id,
          requestId: crypto.randomUUID(),
          type: "prompt",
          body: '_tool={"name":"human.ask","body":"blocked shutdown"}',
        }),
      );
      await isolated.dispatch(run.id);
      await started;
      await expect(isolated.close()).rejects.toThrow(
        "Runtime persistence/cleanup failed",
      );
      expect(
        required(
          (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
        ),
      ).toMatchObject({
        state: "uncertain",
        outcome: "tool_cleanup_unconfirmed",
      });
      await computer.close();
      await fresh.reconcile(run.id);
      expect(
        required(
          (
            await database.db
              .select()
              .from(environments)
              .where(eq(environments.agentId, source.agent.id))
          )[0],
        ),
      ).toMatchObject({ activeRunId: run.id, state: "uncertain" });
    } finally {
      release();
      await fresh.close();
      worker = await startQueue(database.db, database.pool, {
        runtime,
        harnesses,
      });
    }
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
          await (
            await request(
              `/conversations/${source.conversation.id}/participants`,
            )
          ).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/conversations/${source.conversation.id}/participants/${participant.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/conversations/${source.conversation.id}/participants`, {
      agentId: source.agent.id,
      role: "viewer",
    });
    const input = {
      agentId: source.agent.id,
      conversationId: source.conversation.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body: "hold",
    };
    const launches = computer.launches;
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
          await (
            await request(
              `/conversations/${source.conversation.id}/participants`,
            )
          ).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/conversations/${source.conversation.id}/participants/${viewerParticipant.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/conversations/${source.conversation.id}/participants`, {
      agentId: source.agent.id,
      role: "contributor",
    });
    const run = await launch(source, { body: "hold" });
    await expect.poll(async () => (await saved(run.id)).state).toBe("running");
    const current = required(
      page
        .parse(
          await (
            await request(
              `/conversations/${source.conversation.id}/participants`,
            )
          ).json(),
        )
        .items.find((p) => p.agentId === source.agent.id),
    );
    await post(
      `/conversations/${source.conversation.id}/participants/${current.id}`,
      {},
      owner,
      "DELETE",
    );
    await post(`/conversations/${source.conversation.id}/participants`, {
      agentId: source.agent.id,
      role: "viewer",
    });
    await terminal(run.id);
    expect((await saved(run.id)).state).toBe("interrupted");
    expect(computer.launches).toBe(launches + 1);
  });

  it("returns accepted Task content while retaining current Task authorization", async () => {
    const project = record.parse(
      await post("/projects", { name: "Accepted task" }),
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
    const tools = createRunTools(database.db, boss, { harnesses });
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
      body: `_tool=${JSON.stringify({ name: "task.get", taskId: task.id })}`,
      taskId: task.id,
    });
    await terminal(next.id);
    expect(computer.toolResults.at(-1)).toEqual({
      id: task.id,
      title: "Current B",
      notes: "Notes B",
    });
  });

  it("denies a directed ACP request to a viewer Agent without creating child work", async () => {
    const source = await setup();
    const target = await setup();
    await post(`/conversations/${source.conversation.id}/participants`, {
      agentId: target.agent.id,
      role: "viewer",
    });
    const before = computer.toolResults.length;
    const run = await launch(source, {
      body: `_tool=${JSON.stringify({ name: "agent.request", requestId: crypto.randomUUID(), agentId: target.agent.id, body: "finish" })}`,
    });
    await terminal(run.id);
    expect(computer.toolResults.slice(before)).toContainEqual(
      expect.objectContaining({ code: -32603 }),
    );
    expect(
      await database.db.select().from(runs).where(eq(runs.parentRunId, run.id)),
    ).toHaveLength(0);
  });
  it.each(["throw", "unknown"] as const)(
    "retains lost-launch acknowledgement across %s, absence and unconfirmed exit",
    async (first) => {
      await worker.stop({ graceful: false });
      let inspections = 0;
      const isolated = createRunRuntime(database.db, {
        harnesses,
        backend: {
          provider: computer.provider,
          inspectComputer: () => computer.inspectComputer(),
          launch: async () => {
            throw new Error(
              "Controlled lost acknowledgement; launch may still arrive",
            );
          },
          lookup: async (_ref, key): Promise<ProcessInspection> => {
            const step = inspections++;
            if (step === 0) {
              if (first === "throw")
                throw new Error("Controlled transient lookup failure");
              return { state: "unknown" };
            }
            if (step === 1) return { state: "absent" };
            return {
              state: "exited",
              reference: key,
              exitCode: 0,
              stopped: step >= 3,
            };
          },
        },
      });
      try {
        const source = await setup();
        const run = record.parse(
          await post("/runs", {
            agentId: source.agent.id,
            conversationId: source.conversation.id,
            requestId: crypto.randomUUID(),
            type: "script",
            body: "hold",
          }),
        );
        await isolated.dispatch(run.id);
        const current = async () =>
          required(
            (
              await database.db.select().from(runs).where(eq(runs.id, run.id))
            )[0],
          );
        expect(await current()).toMatchObject({
          state: "uncertain",
          outcome: "launch_acknowledgement_missing",
        });
        for (let step = 0; step < 3; step++) {
          await isolated.reconcile(run.id);
          expect(await current()).toMatchObject({
            state: "uncertain",
            outcome: "launch_acknowledgement_missing",
          });
          expect(
            required(
              (
                await database.db
                  .select()
                  .from(environments)
                  .where(eq(environments.agentId, source.agent.id))
              )[0],
            ),
          ).toMatchObject({ state: "uncertain", activeRunId: run.id });
        }
        await isolated.reconcile(run.id);
        expect(await current()).toMatchObject({
          state: "interrupted",
          outcome: "recovered_process_exit_without_confirmed_result",
        });
        expect(
          required(
            (
              await database.db
                .select()
                .from(environments)
                .where(eq(environments.agentId, source.agent.id))
            )[0],
          ),
        ).toMatchObject({ state: "ready", activeRunId: null });
      } finally {
        await isolated.close();
        worker = await startQueue(database.db, database.pool, {
          runtime,
          harnesses,
        });
      }
    },
  );
});
