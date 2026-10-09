import { eq } from "drizzle-orm";
import { hc } from "hono/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RpcApp } from "../apps/server/src/api";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  createTask,
  createTimesheet,
  deleteTimesheet,
  getTimesheets,
  updateTimesheet,
} from "../packages/tasks/src";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { pushDatabase } from "../scripts/push";
import { startPostgres } from "./postgres";

const entry = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    taskId: z.uuid(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    duration: z.number().int().positive(),
    notes: z.string().nullable(),
  })
  .strict();
const page = z.object({ items: z.array(entry), next: z.uuid().nullable() });

describe("manual Task timesheets through authenticated HTTP and private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let emptyTaskId: string;
  let foreignTaskId: string;
  let foreignWorkspaceId: string;
  let owner: { id: string; cookie: string };
  let author: { id: string; cookie: string };
  let admin: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let projectViewer: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let saved: z.infer<typeof entry>;
  let authored: z.infer<typeof entry>;
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
  const url = () => `/workspaces/${workspaceId}/timesheets`;
  const snapshot = async () => ({
    cursor: await scope(owner.id, getCursor),
    rows: (
      await database.pool.query(
        "select row_to_json(t)::text from timesheets t order by id",
      )
    ).rows,
  });
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
    const signup = async (label: string) => {
      const body = {
        name: label,
        email: `${label}@example.test`,
        password: crypto.randomUUID() + crypto.randomUUID(),
      };
      // Three real HTTP registrations; extra role fixtures use the same Better Auth
      // endpoint internally rather than weakening its shared signup rate limit.
      const response = ["owner", "author", "admin"].includes(label)
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
    owner = await signup("owner");
    author = await signup("author");
    admin = await signup("admin");
    viewer = await signup("viewer");
    projectViewer = await signup("project-viewer");
    outsider = await signup("outsider");
    workspaceId = (await claimInstallation(database.db, owner.id, "Time")).id;
    await database.db.insert(members).values([
      { workspaceId, userId: author.id, role: "contributor" },
      { workspaceId, userId: admin.id, role: "admin" },
      { workspaceId, userId: viewer.id, role: "viewer" },
      { workspaceId, userId: projectViewer.id, role: "contributor" },
    ]);
    await scope(owner.id, async (c) => {
      projectId = (await createProject(c, { title: "Project" })).id;
      for (const human of [author, admin, viewer])
        await upsertProjectMember(c, projectId, human.id, "contributor");
      await upsertProjectMember(c, projectId, projectViewer.id, "viewer");
      taskId = (await createTask(c, { projectId, title: "Work" })).id;
      emptyTaskId = (await createTask(c, { projectId, title: "Empty" })).id;
    });
    foreignWorkspaceId = crypto.randomUUID();
    await database.db
      .insert(workspaces)
      .values({ id: foreignWorkspaceId, title: "Foreign" });
    await database.db.insert(members).values({
      workspaceId: foreignWorkspaceId,
      userId: owner.id,
      role: "owner",
    });
    foreignTaskId = await inWorkspace(
      database.db,
      foreignWorkspaceId,
      { userId: owner.id },
      async (c) => {
        const project = await createProject(c, { title: "Other" });
        return (await createTask(c, { projectId: project.id, title: "Other" }))
          .id;
      },
    );
  });
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });
  it("creates server-owned minutes, corrects only duration/notes and advances cursor once per write", async () => {
    const before = await snapshot();
    const start = Date.now();
    const client = hc<RpcApp>(`${origin}/api`, {
      headers: { cookie: owner.cookie, origin },
    });
    const response = await client.workspaces[":workspaceId"].timesheets.$post({
      param: { workspaceId },
      json: { taskId, duration: 30, notes: "Research" },
    });
    expect(response.status).toBe(200);
    saved = entry.parse(await response.json());
    expect(saved).toMatchObject({
      taskId,
      workspaceId,
      createdBy: owner.id,
      duration: 30,
      notes: "Research",
    });
    expect(Date.parse(saved.createdAt)).toBeGreaterThanOrEqual(start - 1000);
    expect(Date.parse(saved.createdAt)).toBeLessThanOrEqual(Date.now());
    expect((await snapshot()).cursor).toBe(before.cursor + 1);
    expect(
      entry.parse(await (await request(`${url()}/${saved.id}`)).json()),
    ).toEqual(saved);
    const changed = await request(`${url()}/${saved.id}`, "PATCH", {
      duration: 45,
      notes: null,
    });
    expect(changed.status).toBe(200);
    saved = entry.parse(await changed.json());
    expect(saved).toMatchObject({
      duration: 45,
      notes: null,
      createdBy: owner.id,
    });
    expect((await snapshot()).cursor).toBe(before.cursor + 2);
    const logged = await request(
      url(),
      "POST",
      { taskId, duration: 15 },
      author.cookie,
    );
    expect(logged.status).toBe(200);
    authored = entry.parse(await logged.json());
    for (const human of [viewer, projectViewer, admin]) {
      const read = await request(
        `${url()}/${authored.id}`,
        "GET",
        undefined,
        human.cookie,
      );
      expect(read.status).toBe(200);
    }
  });
  it("rejects invalid, forged, agent, foreign and other-author writes without row/cursor effects", async () => {
    const before = await snapshot();
    for (const input of [
      { taskId, duration: 0 },
      { taskId, duration: -1 },
      { taskId, duration: 1.5 },
      { taskId, duration: 2147483648 },
      { taskId, duration: 1, notes: "😀".repeat(1001) },
      { taskId, duration: 1, createdBy: author.id },
      { taskId, duration: 1, createdAt: "2000-01-01T00:00:00Z" },
      { taskId, durationMs: 60000 },
      { taskId, duration: 1, agentId: crypto.randomUUID() },
    ])
      expect((await request(url(), "POST", input)).status).toBe(400);
    for (const input of [
      {},
      { taskId: emptyTaskId },
      { createdBy: owner.id },
      { createdAt: saved.createdAt },
      { notes: 5 },
      { duration: 0 },
    ])
      expect(
        (await request(`${url()}/${saved.id}`, "PATCH", input)).status,
      ).toBe(400);
    for (const human of [viewer, projectViewer]) {
      expect(
        (await request(url(), "POST", { taskId, duration: 1 }, human.cookie))
          .status,
      ).toBe(403);
    }
    for (const human of [owner, admin]) {
      expect(
        (
          await request(
            `${url()}/${authored.id}`,
            "PATCH",
            { duration: 1 },
            human.cookie,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            `${url()}/${authored.id}`,
            "DELETE",
            undefined,
            human.cookie,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (await request(url(), "POST", { taskId: foreignTaskId, duration: 1 }))
        .status,
    ).toBe(404);
    expect((await request(`${url()}?taskId=${foreignTaskId}`)).status).toBe(
      404,
    );
    expect(
      (
        await request(
          `/workspaces/${foreignWorkspaceId}/timesheets/${saved.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request(`${url()}/${saved.id}`, "GET", undefined, outsider.cookie))
        .status,
    ).toBe(403);
    expect(
      (await request(`${url()}/${saved.id}`, "GET", undefined, "")).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/api${url()}`, {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin: "https://foreign.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ taskId, duration: 1 }),
        })
      ).status,
    ).toBe(403);
    const forged = { taskId, duration: 1, createdBy: author.id };
    await expect(
      scope(owner.id, (c) => createTimesheet(c, forged)),
    ).rejects.toMatchObject({ code: "invalid" });
    const forgedUpdate = { duration: 1, taskId: emptyTaskId };
    await expect(
      scope(owner.id, (c) => updateTimesheet(c, saved.id, forgedUpdate)),
    ).rejects.toMatchObject({ code: "invalid" });
    for (const duration of [NaN, Infinity, 0, -1, 0.5, 2147483648])
      await expect(
        scope(owner.id, (c) => createTimesheet(c, { taskId, duration })),
      ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      scope(owner.id, (c) =>
        updateTimesheet(c, saved.id, { notes: "😀".repeat(1001) }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      scope(owner.id, (c) =>
        createTimesheet(c, { taskId: "bad", duration: 1 }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    for (const work of [
      (c: Parameters<typeof createTimesheet>[0]) =>
        createTimesheet(c, { taskId, duration: 1 }),
      (c: Parameters<typeof updateTimesheet>[0]) =>
        updateTimesheet(c, saved.id, { duration: 1 }),
      (c: Parameters<typeof deleteTimesheet>[0]) =>
        deleteTimesheet(c, saved.id),
    ])
      await expect(
        inWorkspace<unknown>(
          database.db,
          workspaceId,
          { userId: owner.id, agentId: crypto.randomUUID() },
          work,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(before);
  });
  it("bounds Task/author/logging-date lookup with truthful continuation and invalid cursor denial", async () => {
    const first = page.parse(
      await (await request(`${url()}?taskId=${taskId}&limit=1`)).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.next).not.toBeNull();
    const second = page.parse(
      await (
        await request(`${url()}?taskId=${taskId}&limit=1&after=${first.next}`)
      ).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((r) => r.id))).toEqual(
      new Set([saved.id, authored.id]),
    );
    const exact = page.parse(
      await (await request(`${url()}?taskId=${taskId}&limit=2`)).json(),
    );
    expect(exact.items).toHaveLength(2);
    expect(exact.next).toBeNull();
    const filtered = page.parse(
      await (
        await request(`${url()}?taskId=${taskId}&createdBy=${author.id}`)
      ).json(),
    );
    expect(filtered.items).toEqual([authored]);
    const from = encodeURIComponent(authored.createdAt);
    const to = encodeURIComponent(
      new Date(Date.parse(authored.createdAt) + 1000).toISOString(),
    );
    expect(
      page.parse(
        await (
          await request(
            `${url()}?taskId=${taskId}&createdBy=${author.id}&from=${from}&to=${to}`,
          )
        ).json(),
      ).items,
    ).toEqual([authored]);
    expect(
      page.parse(
        await (
          await request(`${url()}?taskId=${taskId}&to=2000-01-01T00:00:00Z`)
        ).json(),
      ).items,
    ).toEqual([]);
    expect(
      page.parse(
        await (await request(`${url()}?taskId=${emptyTaskId}`)).json(),
      ),
    ).toEqual({ items: [], next: null });
    for (const query of [
      "",
      `taskId=${taskId}&limit=101`,
      `taskId=${taskId}&after=bad`,
      `taskId=${taskId}&from=bad`,
      `taskId=${taskId}&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z`,
      `taskId=${taskId}&createdBy=`,
    ])
      expect((await request(`${url()}?${query}`)).status).toBe(400);
    await expect(
      scope(owner.id, (c) => getTimesheets(c, { taskId, from: new Date(NaN) })),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      page.parse(
        await (
          await request(
            `${url()}?taskId=${taskId}&after=ffffffff-ffff-ffff-ffff-ffffffffffff`,
          )
        ).json(),
      ),
    ).toEqual({ items: [], next: null });
    for (let i = 0; i < 2; i++)
      expect(
        (await request(url(), "POST", { taskId: emptyTaskId, duration: 1 }))
          .status,
      ).toBe(200);
    const position = page.parse(
      await (await request(`${url()}?taskId=${emptyTaskId}&limit=1`)).json(),
    );
    expect(position.next).not.toBeNull();
    expect(
      (await request(`${url()}/${position.items[0]?.id}`, "DELETE")).status,
    ).toBe(200);
    const continued = page.parse(
      await (
        await request(
          `${url()}?taskId=${emptyTaskId}&limit=1&after=${position.next}`,
        )
      ).json(),
    );
    expect(continued.items).toHaveLength(1);
    expect(continued.next).toBeNull();
    expect(
      (await request(`${url()}/${continued.items[0]?.id}`, "DELETE")).status,
    ).toBe(200);
  });
  it("permits Done/archive corrections, rechecks current Project/workspace access and preserves history", async () => {
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/tasks/${taskId}/status`,
          "POST",
          { status: "done", editToken: 0 },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/tasks/${taskId}/archive`,
          "POST",
          { archived: true, editToken: 1 },
        )
      ).status,
    ).toBe(200);
    const response = await request(url(), "POST", { taskId, duration: 5 });
    expect(response.status).toBe(200);
    const doneEntry = entry.parse(await response.json());
    const corrected = await request(`${url()}/${doneEntry.id}`, "PATCH", {
      notes: "Correction",
    });
    expect(corrected.status).toBe(200);
    expect(entry.parse(await corrected.json())).toMatchObject({
      createdAt: doneEntry.createdAt,
      duration: 5,
      notes: "Correction",
    });
    const beforeDelete = (await snapshot()).cursor;
    expect((await request(`${url()}/${doneEntry.id}`, "DELETE")).status).toBe(
      200,
    );
    expect((await snapshot()).cursor).toBe(beforeDelete + 1);
    expect((await request(`${url()}/${doneEntry.id}`)).status).toBe(404);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/projects/${projectId}/members/${author.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    const before = await snapshot();
    for (const [method, json] of [
      ["GET", undefined],
      ["PATCH", { duration: 1 }],
      ["DELETE", undefined],
    ] as const)
      expect(
        (await request(`${url()}/${authored.id}`, method, json, author.cookie))
          .status,
      ).toBe(403);
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(before);
    expect(
      entry.parse(await (await request(`${url()}/${authored.id}`)).json()),
    ).toEqual(authored);
    await scope(owner.id, (c) =>
      upsertProjectMember(c, projectId, author.id, "contributor"),
    );
    await database.db.delete(members).where(eq(members.userId, author.id));
    const removed = await snapshot();
    expect(
      (
        await request(
          `${url()}/${authored.id}`,
          "PATCH",
          { duration: 1 },
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(removed);
  });
  it("enforces native constraints and repeats schema push preserving entries and queue objects", async () => {
    const insert = (
      workspace: string,
      task: string,
      creator: string,
      duration: unknown,
      notes: string | null = null,
    ) =>
      database.pool.query(
        'insert into timesheets("workspaceId","taskId","createdBy",duration,notes) values($1,$2,$3,$4,$5)',
        [workspace, task, creator, duration, notes],
      );
    await expect(
      insert(workspaceId, foreignTaskId, owner.id, 1),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "timesheets_task_workspace_fk",
    });
    await expect(
      insert(workspaceId, taskId, "missing", 1),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "timesheets_createdBy_fk",
    });
    await expect(
      insert(workspaceId, taskId, owner.id, 0),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "timesheets_duration_positive",
    });
    await expect(
      insert(workspaceId, taskId, owner.id, "1.5"),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      insert(workspaceId, taskId, owner.id, 2147483648),
    ).rejects.toMatchObject({ code: "22003" });
    await expect(
      insert(workspaceId, taskId, owner.id, 1, "😀".repeat(1001)),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "timesheets_notes_bytes",
    });
    const jobId = await boss.send(
      RUN_QUEUE,
      { runId: crypto.randomUUID() },
      { startAfter: 60 },
    );
    const before = await snapshot();
    const definitions = async () =>
      (
        await database.pool.query(
          "select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='timesheets'::regclass order by conname",
        )
      ).rows;
    const original = await definitions();
    const schemaUrl = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    await pushDatabase(schemaUrl);
    await pushDatabase(schemaUrl);
    expect(await snapshot()).toEqual(before);
    expect(await definitions()).toEqual(original);
    expect(await boss.getJobById(RUN_QUEUE, jobId ?? "")).not.toBeNull();
  });
});
