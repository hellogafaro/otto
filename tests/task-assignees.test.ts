import { hc } from "hono/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RpcApp } from "../apps/server/src/api";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import {
  createProject,
  deleteProjectMember,
  upsertProjectMember,
} from "../packages/projects/src";
import {
  createTask,
  createTimesheet,
  getTask,
  getTasks,
  setTaskStatus,
  updateTask,
} from "../packages/tasks/src";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { controlledSubscription } from "./fixtures/pi";
import { startPostgres } from "./postgres";

const task = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archived: z.boolean(),
    projectId: z.uuid(),
    title: z.string(),
    notes: z.string(),
    dueAt: z.iso.datetime().nullable(),
    recurrence: z.string().nullable(),
    predecessorId: z.uuid().nullable(),
    successorId: z.uuid().nullable(),
    ownerId: z.string(),
    status: z.enum(["todo", "doing", "done"]),
    editToken: z.number().int(),
    assigneeUserIds: z.array(z.string()),
    assigneeAgentIds: z.array(z.uuid()),
  })
  .strict();
const page = z.object({ items: z.array(task), next: z.uuid().nullable() });
type Human = { id: string; cookie: string };

describe("multiple Task assignees through authenticated HTTP and private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let projectId: string;
  let owner: Human;
  let alice: Human;
  let bob: Human;
  let carol: Human; // Project viewer
  let dave: Human; // workspace member outside the Project
  let wsViewer: Human; // workspace viewer inside the Project
  let outsider: Human; // no membership here
  let workspaceAgent: string;
  let projectAgent: string;
  let otherProjectAgent: string;
  let privateAgent: string;
  let foreignAgent: string;
  const scope = <T>(
    userId: string,
    work: Parameters<typeof inWorkspace<T>>[3],
  ) => inWorkspace(database.db, workspaceId, { userId }, work);
  const request = (
    path: string,
    method = "GET",
    json?: unknown,
    cookie = owner.cookie,
  ) =>
    fetch(`${origin}/api${path}`, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  const url = `/workspaces/`;
  const tasksUrl = () => `${url}${workspaceId}/tasks`;
  const snapshot = async () => ({
    cursor: await scope(owner.id, getCursor),
    tasks: (
      await database.pool.query(
        "select row_to_json(t)::text from tasks t order by id",
      )
    ).rows,
    users: (
      await database.pool.query(
        "select row_to_json(t)::text from tasks_users t order by 1",
      )
    ).rows,
    agents: (
      await database.pool.query(
        "select row_to_json(t)::text from tasks_agents t order by 1",
      )
    ).rows,
    runs: (await database.pool.query("select count(*)::int as n from runs"))
      .rows,
  });
  const create = async (json: Record<string, unknown>, cookie?: string) =>
    request(tasksUrl(), "POST", { projectId, title: "Task", ...json }, cookie);
  const read = async (id: string) =>
    task.parse(await (await request(`${tasksUrl()}/${id}`)).json());
  beforeAll(async () => {
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
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ db: database.db, boss, auth, origin });
    const signup = async (label: string, http = false) => {
      const body = {
        name: label,
        email: `${label}@example.test`,
        password: crypto.randomUUID() + crypto.randomUUID(),
      };
      const response = http
        ? await fetch(`${origin}/api/auth/sign-up/email`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        : await auth.api.signUpEmail({ body, asResponse: true });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie") ?? "";
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      if (!session) throw new Error("Missing authenticated fixture");
      return { id: session.user.id, cookie };
    };
    owner = await signup("owner", true);
    alice = await signup("alice");
    bob = await signup("bob");
    carol = await signup("carol");
    dave = await signup("dave");
    wsViewer = await signup("ws-viewer");
    outsider = await signup("outsider");
    workspaceId = (await claimInstallation(database.db, owner.id, "Assign")).id;
    await database.db.insert(members).values(
      [alice, bob, carol, dave].map((human) => ({
        workspaceId,
        userId: human.id,
        role: "contributor" as const,
      })),
    );
    await database.db
      .insert(members)
      .values({ workspaceId, userId: wsViewer.id, role: "viewer" });
    let otherProjectId = "";
    await scope(owner.id, async (c) => {
      projectId = (await createProject(c, { title: "Project" })).id;
      otherProjectId = (await createProject(c, { title: "Other" })).id;
      for (const human of [alice, bob, wsViewer])
        await upsertProjectMember(c, projectId, human.id, "contributor");
      await upsertProjectMember(c, projectId, carol.id, "viewer");
      const subscriptionId = await controlledSubscription(c);
      const agent = async (title: string, extra: object = {}) =>
        (
          await createAgent(c, {
            title,
            instructions: "Work",
            model: "selected",
            subscriptionId,
            visibility: "workspace",
            ...extra,
          })
        ).id;
      workspaceAgent = await agent("Workspace");
      projectAgent = await agent("Project", { projectId });
      otherProjectAgent = await agent("Other", {
        projectId: otherProjectId,
      });
    });
    privateAgent = await scope(alice.id, async (c) => {
      return (
        await createAgent(c, {
          title: "Private",
          instructions: "Work",
          model: "selected",
          subscriptionId: await controlledSubscription(c),
          visibility: "user",
        })
      ).id;
    });
    const foreignWorkspaceId = crypto.randomUUID();
    await database.db
      .insert(workspaces)
      .values({ id: foreignWorkspaceId, title: "Foreign" });
    await database.db.insert(members).values({
      workspaceId: foreignWorkspaceId,
      userId: owner.id,
      role: "owner",
    });
    foreignAgent = await inWorkspace(
      database.db,
      foreignWorkspaceId,
      { userId: owner.id },
      async (c) =>
        (
          await createAgent(c, {
            title: "Foreign",
            instructions: "Work",
            model: "selected",
            subscriptionId: await controlledSubscription(c),
            visibility: "workspace",
          })
        ).id,
    );
  });
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("creates and hydrates zero, many and mixed assignees without changing ownership or starting Runs", async () => {
    const empty = task.parse(await (await create({ title: "Empty" })).json());
    expect(empty).toMatchObject({
      assigneeUserIds: [],
      assigneeAgentIds: [],
      ownerId: owner.id,
    });
    const mixed = task.parse(
      await (
        await create({
          title: "Mixed",
          assigneeUserIds: [bob.id, alice.id],
          assigneeAgentIds: [projectAgent, workspaceAgent],
        })
      ).json(),
    );
    expect(mixed.ownerId).toBe(owner.id);
    expect(mixed.assigneeUserIds).toEqual([alice.id, bob.id].sort());
    expect(mixed.assigneeAgentIds).toEqual(
      [projectAgent, workspaceAgent].sort(),
    );
    expect(await read(mixed.id)).toEqual(mixed);
    // Same selections through the typed client exercise the generated RPC shape.
    const client = hc<RpcApp>(`${origin}/api`, {
      headers: { cookie: owner.cookie, origin },
    });
    const typed = await client.workspaces[":workspaceId"].tasks.$post({
      param: { workspaceId },
      json: { projectId, title: "Typed", assigneeUserIds: [alice.id] },
    });
    expect(typed.status).toBe(200);
    expect((await snapshot()).runs).toEqual([{ n: 0 }]);
  });

  it("rejects ineligible, foreign, duplicate, malformed, oversized and agent-authored selections with no side effects", async () => {
    const base = task.parse(await (await create({ title: "Guarded" })).json());
    const patch = (json: Record<string, unknown>, cookie?: string) =>
      request(
        `${tasksUrl()}/${base.id}`,
        "PATCH",
        { editToken: base.editToken, ...json },
        cookie,
      );
    const before = await snapshot();
    const denied: [string, Record<string, unknown>, number][] = [
      ["workspace member outside Project", { assigneeUserIds: [dave.id] }, 403],
      ["Project viewer", { assigneeUserIds: [carol.id] }, 403],
      ["workspace viewer", { assigneeUserIds: [wsViewer.id] }, 403],
      ["user without membership", { assigneeUserIds: [outsider.id] }, 403],
      ["unknown user", { assigneeUserIds: ["nobody"] }, 403],
      [
        "valid plus ineligible user",
        { assigneeUserIds: [alice.id, dave.id] },
        403,
      ],
      [
        "Agent bound to another Project",
        { assigneeAgentIds: [otherProjectAgent] },
        403,
      ],
      [
        "another user's private Agent",
        { assigneeAgentIds: [privateAgent] },
        403,
      ],
      [
        "Agent from another workspace",
        { assigneeAgentIds: [foreignAgent] },
        404,
      ],
      ["unknown Agent", { assigneeAgentIds: [crypto.randomUUID()] }, 404],
      [
        "atomic rollback with a valid title",
        {
          title: "Must not persist",
          assigneeUserIds: [alice.id],
          assigneeAgentIds: [workspaceAgent, otherProjectAgent],
        },
        403,
      ],
      ["duplicate user", { assigneeUserIds: [alice.id, alice.id] }, 400],
      [
        "duplicate Agent differing only by case",
        {
          assigneeAgentIds: [workspaceAgent, workspaceAgent.toUpperCase()],
        },
        400,
      ],
      ["malformed Agent ID", { assigneeAgentIds: ["not-a-uuid"] }, 400],
      ["empty user ID", { assigneeUserIds: [""] }, 400],
      [
        "more than twenty users",
        { assigneeUserIds: Array.from({ length: 21 }, (_, i) => `u${i}`) },
        400,
      ],
      ["old singular alias", { assigneeUserId: alice.id }, 400],
      ["non-array selection", { assigneeUserIds: alice.id }, 400],
    ];
    for (const [label, json, status] of denied) {
      const response = await patch(json);
      expect(response.status, label).toBe(status);
    }
    expect(
      (await patch({ assigneeUserIds: [alice.id] }, wsViewer.cookie)).status,
    ).toBe(403);
    expect(
      (
        await request(`${tasksUrl()}/${base.id}/assignee`, "POST", {
          userId: alice.id,
        })
      ).status,
    ).toBe(404);
    expect(await snapshot()).toEqual(before);
    // Agents author nothing here, and creation applies the same eligibility checks.
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id, agentId: workspaceAgent },
        (c) =>
          updateTask(c, base.id, {
            editToken: base.editToken,
            assigneeUserIds: [alice.id],
          }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id, agentId: workspaceAgent },
        (c) =>
          createTask(c, {
            projectId,
            title: "x",
            ownerId: owner.id,
            assigneeUserIds: [alice.id],
          }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await create({ assigneeUserIds: [dave.id] })).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it("replaces one kind at a time, clears with an empty array and fences stale edits", async () => {
    const base = task.parse(
      await (
        await create({
          title: "Replace",
          assigneeUserIds: [alice.id],
          assigneeAgentIds: [workspaceAgent],
        })
      ).json(),
    );
    const replaced = task.parse(
      await (
        await request(`${tasksUrl()}/${base.id}`, "PATCH", {
          editToken: base.editToken,
          assigneeUserIds: [bob.id, alice.id],
        })
      ).json(),
    );
    expect(replaced.assigneeUserIds).toEqual([alice.id, bob.id].sort());
    expect(replaced.assigneeAgentIds).toEqual([workspaceAgent]);
    expect(replaced.editToken).toBe(base.editToken + 1);
    const stale = await snapshot();
    expect(
      (
        await request(`${tasksUrl()}/${base.id}`, "PATCH", {
          editToken: base.editToken,
          assigneeUserIds: [],
        })
      ).status,
    ).toBe(409);
    expect(await snapshot()).toEqual(stale);
    const cleared = task.parse(
      await (
        await request(`${tasksUrl()}/${base.id}`, "PATCH", {
          editToken: replaced.editToken,
          assigneeAgentIds: [],
          assigneeUserIds: [],
        })
      ).json(),
    );
    expect(cleared).toMatchObject({
      assigneeUserIds: [],
      assigneeAgentIds: [],
      ownerId: owner.id,
    });
    expect(
      (
        await request(`${tasksUrl()}/${base.id}`, "PATCH", {
          editToken: cleared.editToken,
        })
      ).status,
    ).toBe(400);
  });

  it("serializes concurrent stale updates: one wins and the loser changes nothing", async () => {
    const base = task.parse(await (await create({ title: "Race" })).json());
    const attempt = (userId: string) =>
      request(`${tasksUrl()}/${base.id}`, "PATCH", {
        editToken: base.editToken,
        assigneeUserIds: [userId],
      });
    const results = await Promise.all([attempt(alice.id), attempt(bob.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = task.parse(
      await results.find((r) => r.status === 200)?.json(),
    );
    expect(winner.assigneeUserIds).toHaveLength(1);
    expect(await read(base.id)).toEqual(winner);
  });

  it("filters by contained member and paginates without duplicate rows", async () => {
    const project = (
      await scope(owner.id, (c) => createProject(c, { title: "Paging" }))
    ).id;
    await scope(owner.id, async (c) => {
      for (const human of [alice, bob])
        await upsertProjectMember(c, project, human.id, "contributor");
    });
    const created = await scope(owner.id, async (c) => {
      const rows = [];
      for (let i = 0; i < 5; i++)
        rows.push(
          await createTask(c, {
            projectId: project,
            title: `P${i}`,
            assigneeUserIds: i % 2 ? [alice.id, bob.id] : [alice.id],
            assigneeAgentIds: i === 3 ? [workspaceAgent] : [],
          }),
        );
      return rows;
    });
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const response = await request(
        `${tasksUrl()}?projectId=${project}&limit=2${after ? `&after=${after}` : ""}`,
      );
      const result = page.parse(await response.json());
      expect(result.items.length).toBeLessThanOrEqual(2);
      for (const item of result.items) {
        expect(item.assigneeUserIds).toContain(alice.id);
        seen.push(item.id);
      }
      after = result.next ?? undefined;
    } while (after);
    expect(seen).toEqual(created.map((row) => row.id).sort());
    const byBob = page.parse(
      await (
        await request(
          `${tasksUrl()}?projectId=${project}&assigneeUserId=${bob.id}`,
        )
      ).json(),
    );
    expect(byBob.items.map((row) => row.title).sort()).toEqual(["P1", "P3"]);
    const byAgent = page.parse(
      await (
        await request(
          `${tasksUrl()}?projectId=${project}&assigneeAgentId=${workspaceAgent}`,
        )
      ).json(),
    );
    expect(byAgent.items.map((row) => row.title)).toEqual(["P3"]);
    expect(byAgent.items[0]?.assigneeAgentIds).toEqual([workspaceAgent]);
  });

  it("keeps stored assignments readable after Project removal, denies re-assigning ineligible members and preserves Done, owner and Timesheets", async () => {
    const work = task.parse(
      await (
        await create({
          title: "Lifecycle",
          assigneeUserIds: [alice.id, bob.id],
        })
      ).json(),
    );
    await scope(owner.id, (c) => deleteProjectMember(c, projectId, bob.id));
    const afterDemotion = await read(work.id);
    expect(afterDemotion.assigneeUserIds).toEqual([alice.id, bob.id].sort());
    expect(
      (
        await request(`${tasksUrl()}/${work.id}`, "PATCH", {
          editToken: work.editToken,
          assigneeUserIds: [alice.id, bob.id],
        })
      ).status,
    ).toBe(403);
    const dropped = task.parse(
      await (
        await request(`${tasksUrl()}/${work.id}`, "PATCH", {
          editToken: work.editToken,
          assigneeUserIds: [alice.id],
        })
      ).json(),
    );
    expect(dropped.assigneeUserIds).toEqual([alice.id]);
    // Assignees are not owners; Agents never complete Tasks; humans still do.
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id, agentId: workspaceAgent },
        (c) =>
          setTaskStatus(c, work.id, {
            status: "done",
            editToken: dropped.editToken,
          }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const minutes = await scope(alice.id, (c) =>
      createTimesheet(c, { taskId: work.id, duration: 15 }),
    );
    expect(minutes).toMatchObject({ taskId: work.id, createdBy: alice.id });
    const done = await scope(owner.id, (c) =>
      setTaskStatus(c, work.id, {
        status: "done",
        editToken: dropped.editToken,
      }),
    );
    expect(done).toMatchObject({
      status: "done",
      ownerId: owner.id,
      assigneeUserIds: [alice.id],
    });
    expect(
      (await scope(owner.id, (c) => getTasks(c, { projectId, status: "done" })))
        .items,
    ).toContainEqual(await scope(owner.id, (c) => getTask(c, work.id)));
  });

  it("enforces workspace-safe junction relations and uniqueness in PostgreSQL", async () => {
    const mine = task.parse(
      await (
        await create({ title: "Relations", assigneeUserIds: [alice.id] })
      ).json(),
    );
    const insert = (sql: string, values: unknown[]) =>
      database.pool.query(sql, values);
    await expect(
      insert(
        'insert into tasks_users ("workspaceId","taskId","userId") values ($1,$2,$3)',
        [workspaceId, mine.id, alice.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      insert(
        'insert into tasks_users ("workspaceId","taskId","userId") values ($1,$2,$3)',
        [crypto.randomUUID(), mine.id, bob.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      insert(
        'insert into tasks_agents ("workspaceId","taskId","agentId") values ($1,$2,$3)',
        [workspaceId, mine.id, foreignAgent],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      insert(
        'insert into tasks_users ("workspaceId","taskId","userId") values ($1,$2,$3)',
        [workspaceId, mine.id, "missing-user"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(
      (
        await database.pool.query(
          "select 1 from information_schema.columns where table_name=$1 and column_name in ($2,$3)",
          ["tasks", "assigneeUserId", "assigneeAgentId"],
        )
      ).rowCount,
    ).toBe(0);
  });
});
