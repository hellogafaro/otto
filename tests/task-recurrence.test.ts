import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import {
  createProject,
  deleteProjectMember,
  upsertProjectMember,
} from "../packages/projects/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  archiveTask,
  createTask,
  createTimesheet,
  getTask,
  getTasks,
  getTimesheets,
  setTaskStatus,
  updateTask,
} from "../packages/tasks/src";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { controlledSubscription } from "./fixtures/native-model";
import { startPostgres } from "./postgres";

const MONDAYS =
  "DTSTART;TZID=America/New_York:20240101T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO";
const task = z.looseObject({
  id: z.uuid(),
  status: z.enum(["todo", "doing", "done"]),
  editToken: z.number().int(),
  dueAt: z.iso.datetime().nullable(),
  recurrence: z.string().nullable(),
  predecessorId: z.uuid().nullable(),
  successorId: z.uuid().nullable(),
});

describe("completion-created Task recurrence on private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let nativeStorage: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: Awaited<ReturnType<typeof startQueue>>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let app: ReturnType<typeof createApp>;
  let workspaceId: string;
  let projectId: string;
  let ownerCookie: string;
  let ownerId: string;
  const people: Record<string, string> = {};
  let agentId: string;
  const scope = <T>(
    userId: string,
    work: Parameters<typeof inWorkspace<T>>[3],
  ) => inWorkspace(database.db, workspaceId, { userId }, work);
  const as = (name: string) => people[name] as string;
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const request = (path: string, method = "GET", json?: unknown) =>
    fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method,
      headers: {
        cookie: ownerCookie,
        origin,
        "content-type": "application/json",
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  const make = (extra: Record<string, unknown> = {}) =>
    scope(ownerId, (c) =>
      createTask(c, {
        projectId,
        title: "Recurring",
        notes: "Body",
        recurrence: MONDAYS,
        ...extra,
      }),
    );
  const complete = (id: string, userId = ownerId) =>
    scope(userId, async (c) => {
      const current = await getTask(c, id);
      return setTaskStatus(c, id, {
        status: "done",
        editToken: current.editToken,
      });
    });
  const children = async (id: string) =>
    (
      await database.pool.query(
        'select id, "dueAt", status, recurrence, "ownerId", title, notes from tasks where "predecessorId"=$1',
        [id],
      )
    ).rows;
  beforeAll(async () => {
    database = await startPostgres();
    nativeStorage = await openNativeStorage({
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
    app = createApp({ db: database.db, boss, auth, origin, nativeStorage });
    const response = await auth.api.signUpEmail({
      body: {
        name: "owner",
        email: "owner@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      asResponse: true,
    });
    ownerCookie = response.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: ownerCookie }),
    });
    ownerId = session?.user.id ?? "";
    workspaceId = (await claimInstallation(database.db, ownerId, "Recur")).id;
    for (const name of ["alice", "bob"]) {
      const created = await auth.api.signUpEmail({
        body: {
          name,
          email: `${name}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        },
      });
      people[name] = created.user.id;
      await database.db
        .insert(members)
        .values({ workspaceId, userId: created.user.id, role: "contributor" });
    }
    await scope(ownerId, async (c) => {
      projectId = (await createProject(c, { title: "Project" })).id;
      for (const name of ["alice", "bob"])
        await upsertProjectMember(c, projectId, as(name), "contributor");
      agentId = (
        await createAgent(c, {
          title: "Worker",
          instructions: "Work",
          model: "selected",
          subscriptionId: await controlledSubscription(c),
          visibility: "workspace",
        })
      ).id;
    });
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await server?.stop(true);
    await boss?.stop();
    await nativeStorage?.close();
    await database?.stop();
  });

  it("creates the next todo Task at the first occurrence strictly after server completion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Rule: every Monday 09:00 New York. 2024-01-15 and 22 are EST (14:00Z).
    const cases: [string, string][] = [
      ["2024-01-14T17:00:00Z", "2024-01-15T14:00:00.000Z"], // Sunday completion: tomorrow
      ["2024-01-16T17:00:00Z", "2024-01-22T14:00:00.000Z"], // Tuesday: next Monday
      ["2024-01-22T13:59:59.999Z", "2024-01-22T14:00:00.000Z"], // just before an occurrence
      ["2024-01-22T14:00:00.000Z", "2024-01-29T14:00:00.000Z"], // exactly on one: the next
      ["2024-02-07T05:00:00Z", "2024-02-12T14:00:00.000Z"], // overdue by weeks: nearest future
      ["2024-03-09T12:00:00Z", "2024-03-11T13:00:00.000Z"], // across US DST: still 09:00 local
    ];
    for (const [completion, due] of cases) {
      const original = await make({
        dueAt: new Date("2024-01-01T14:00:00Z"),
        assigneeUserIds: [as("alice")],
      });
      at(completion);
      const done = await complete(original.id);
      expect(done.status).toBe("done");
      const [child] = await children(original.id);
      expect(child, completion).toBeDefined();
      expect(new Date(child.dueAt).toISOString(), completion).toBe(due);
      expect(child).toMatchObject({
        status: "todo",
        recurrence: MONDAYS,
        ownerId,
        title: "Recurring",
        notes: "Body",
      });
      expect(done.successorId).toBe(child.id);
      const read = await scope(ownerId, (c) => getTask(c, child.id));
      expect(read).toMatchObject({
        predecessorId: original.id,
        successorId: null,
        assigneeUserIds: [as("alice")],
      });
      // Completed Task and its manual time are untouched.
      expect(
        await scope(ownerId, (c) => getTask(c, original.id)),
      ).toMatchObject({
        status: "done",
        dueAt: new Date("2024-01-01T14:00:00Z"),
      });
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["Date"] });
    }
  });

  it("creates exactly one successor across reopen, repeated Done and concurrent completion; Timesheets stay with the original", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2024-01-10T12:00:00Z");
    const original = await make();
    const minutes = await scope(as("alice"), (c) =>
      createTimesheet(c, { taskId: original.id, duration: 25 }),
    );
    const first = await complete(original.id);
    const [child] = await children(original.id);
    expect(child).toBeDefined();
    // Reopen, then complete later: the known successor is kept, no second child.
    const reopened = await scope(ownerId, (c) =>
      setTaskStatus(c, original.id, {
        status: "doing",
        editToken: first.editToken,
      }),
    );
    expect(reopened.successorId).toBe(child.id);
    at("2024-03-01T12:00:00Z");
    const again = await complete(original.id);
    expect(again.successorId).toBe(child.id);
    // Done on an already Done Task changes no relation either.
    await complete(original.id);
    expect(await children(original.id)).toHaveLength(1);
    // The database itself refuses a second child for one predecessor.
    await expect(
      database.pool.query(
        `insert into tasks ("workspaceId","projectId",title,"ownerId","predecessorId")
         values ($1,$2,'dup',$3,$4)`,
        [workspaceId, projectId, ownerId, original.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    // Original keeps all of its own time; the successor starts empty.
    expect(
      (await scope(ownerId, (c) => getTimesheets(c, { taskId: original.id })))
        .items,
    ).toEqual([minutes]);
    expect(
      (await scope(ownerId, (c) => getTimesheets(c, { taskId: child.id })))
        .items,
    ).toEqual([]);
    vi.useRealTimers();
    // Concurrent completions with the same token: one wins, the other is a conflict, one successor.
    const racing = await make();
    const attempt = () =>
      request(`/tasks/${racing.id}/status`, "POST", {
        status: "done",
        editToken: racing.editToken,
      });
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await children(racing.id)).toHaveLength(1);
  });

  it("keeps the original anchor: INTERVAL phase, COUNT and UNTIL never restart on completion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const biweekly = await make({
      recurrence:
        "DTSTART;TZID=America/New_York:20240101T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3",
    });
    at("2024-01-02T12:00:00Z");
    await complete(biweekly.id);
    const [second] = await children(biweekly.id);
    expect(new Date(second.dueAt).toISOString()).toBe(
      "2024-01-15T14:00:00.000Z",
    );
    expect(second.recurrence).toBe(biweekly.recurrence);
    at("2024-01-16T12:00:00Z");
    await complete(second.id);
    const [third] = await children(second.id);
    expect(new Date(third.dueAt).toISOString()).toBe(
      "2024-01-29T14:00:00.000Z",
    );
    // Third of COUNT=3 is the last: completion marks Done with no successor.
    at("2024-01-30T12:00:00Z");
    expect((await complete(third.id)).status).toBe("done");
    expect(await children(third.id)).toEqual([]);
    const until = await make({
      recurrence:
        "DTSTART;TZID=America/New_York:20240101T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20240110T000000Z",
    });
    at("2024-01-02T12:00:00Z");
    await complete(until.id);
    const [last] = await children(until.id);
    expect(new Date(last.dueAt).toISOString()).toBe("2024-01-08T14:00:00.000Z");
    at("2024-01-09T12:00:00Z");
    await complete(last.id);
    expect(await children(last.id)).toEqual([]);
  });

  it("follows RFC 5545 for nonexistent and repeated local times and month ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const gap = await make({
      recurrence:
        "DTSTART;TZID=America/New_York:20270312T023000\nRRULE:FREQ=DAILY",
    });
    at("2027-03-13T12:00:00Z");
    await complete(gap.id);
    // 02:30 does not exist on 2027-03-14: that instance is ignored, not shifted.
    expect(new Date((await children(gap.id))[0].dueAt).toISOString()).toBe(
      "2027-03-15T06:30:00.000Z",
    );
    const month = await make({
      recurrence:
        "DTSTART;TZID=Europe/Madrid:20270131T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31",
    });
    at("2027-02-01T12:00:00Z");
    await complete(month.id);
    expect(new Date((await children(month.id))[0].dueAt).toISOString()).toBe(
      "2027-03-31T07:00:00.000Z",
    );
  });

  it("copies only currently eligible assignees; the completed Task keeps all of its own", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2024-01-10T12:00:00Z");
    const work = await make({
      assigneeUserIds: [as("alice"), as("bob")],
      assigneeAgentIds: [agentId],
    });
    await scope(ownerId, (c) => deleteProjectMember(c, projectId, as("bob")));
    const done = await complete(work.id);
    const [child] = await children(work.id);
    const read = await scope(ownerId, (c) => getTask(c, child.id));
    expect(read.assigneeUserIds).toEqual([as("alice")]);
    expect(read.assigneeAgentIds).toEqual([agentId]);
    expect(done.assigneeUserIds).toEqual([as("alice"), as("bob")].sort());
    expect(done.assigneeAgentIds).toEqual([agentId]);
    await scope(ownerId, (c) =>
      upsertProjectMember(c, projectId, as("bob"), "contributor"),
    );
  });

  it("rejects Done atomically when the owner is ineligible or the rule can no longer be evaluated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2024-01-10T12:00:00Z");
    const ineligible = await make({ ownerId: as("alice") });
    await database.pool.query(
      'delete from project_members where "projectId"=$1 and "userId"=$2',
      [projectId, as("alice")],
    );
    const before = await scope(ownerId, getCursor);
    await expect(complete(ineligible.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await scope(ownerId, (c) => getTask(c, ineligible.id)),
    ).toMatchObject({ status: "todo", editToken: ineligible.editToken });
    expect(await children(ineligible.id)).toEqual([]);
    expect(await scope(ownerId, getCursor)).toBe(before);
    await scope(ownerId, (c) =>
      upsertProjectMember(c, projectId, as("alice"), "contributor"),
    );
    // A stored rule that cannot be evaluated is a deliberate conflict before any mutation.
    const broken = await make();
    await database.pool.query(`update tasks set recurrence=$2 where id=$1`, [
      broken.id,
      "DTSTART;TZID=UTC:20240101T090000\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
    ]);
    await expect(complete(broken.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await scope(ownerId, (c) => getTask(c, broken.id))).toMatchObject({
      status: "todo",
    });
    expect(await children(broken.id)).toEqual([]);
  });

  it("creates no successor for non-recurring, archived or exhausted Tasks and never changes completed state", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2024-01-10T12:00:00Z");
    const plain = await make({ recurrence: null });
    await complete(plain.id);
    expect(await children(plain.id)).toEqual([]);
    const archived = await make();
    await scope(ownerId, (c) =>
      archiveTask(c, archived.id, true, archived.editToken),
    );
    await complete(archived.id);
    expect(await children(archived.id)).toEqual([]);
    // Agents never complete Tasks, so no successor can come from one.
    const agentTask = await make();
    await expect(
      inWorkspace(database.db, workspaceId, { userId: ownerId, agentId }, (c) =>
        setTaskStatus(c, agentTask.id, {
          status: "done",
          editToken: agentTask.editToken,
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await children(agentTask.id)).toEqual([]);
  });

  it("validates, edits and clears dueAt and recurrence strictly through authenticated HTTP", async () => {
    const created = task.parse(
      await (
        await request("/tasks", "POST", {
          projectId,
          title: "HTTP",
          dueAt: "2030-05-01T10:00:00+02:00",
          recurrence: `${MONDAYS.replace("America/New_York", "america/new_york")}\n`,
          predecessorId: crypto.randomUUID(),
        })
      ).json(),
    );
    expect(created).toMatchObject({
      dueAt: "2030-05-01T08:00:00.000Z",
      recurrence: MONDAYS,
      predecessorId: null,
      successorId: null,
    });
    const before = await scope(ownerId, getCursor);
    const bad = [
      "RRULE:FREQ=WEEKLY",
      `${MONDAYS}\nEXDATE:20240108T140000Z`,
      MONDAYS.replace("FREQ=WEEKLY", "FREQ=HOURLY"),
      MONDAYS.replace("America/New_York", "Mars/Base"),
      MONDAYS.replace("BYDAY=MO", "BYDAY=MO;FOO=1"),
      MONDAYS.replace("BYDAY=MO", "BYDAY=MO;COUNT=2;UNTIL=20250101T000000Z"),
      MONDAYS.replace("BYDAY=MO", "BYDAY=MO;UNTIL=20250101T000000"),
      "DTSTART;TZID=UTC:20240101T090000\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
      "x".repeat(401),
    ];
    for (const recurrence of bad) {
      const response = await request(`/tasks/${created.id}`, "PATCH", {
        editToken: created.editToken,
        recurrence,
      });
      expect(response.status, recurrence).toBe(400);
    }
    expect(
      (
        await request(`/tasks/${created.id}`, "PATCH", {
          editToken: created.editToken,
          dueAt: "tomorrow",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/tasks/${created.id}`, "PATCH", {
          editToken: created.editToken,
          predecessorId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(await scope(ownerId, getCursor)).toBe(before);
    const cleared = task.parse(
      await (
        await request(`/tasks/${created.id}`, "PATCH", {
          editToken: created.editToken,
          dueAt: null,
          recurrence: null,
        })
      ).json(),
    );
    expect(cleared).toMatchObject({ dueAt: null, recurrence: null });
    const listed = await scope(ownerId, (c) => getTasks(c, { projectId }));
    expect(listed.items.length).toBeGreaterThan(0);
    // The same allowlisted edit also changes recurrence after creation.
    const edited = await scope(ownerId, (c) =>
      updateTask(c, created.id, {
        editToken: cleared.editToken,
        recurrence: MONDAYS,
      }),
    );
    expect(edited.recurrence).toBe(MONDAYS);
  });

  const LEAP_INTERVAL =
    "DTSTART;TZID=UTC:20240229T090000\nRRULE:FREQ=DAILY;INTERVAL=1000;BYMONTH=2;BYMONTHDAY=29";
  const post = (recurrence: string) =>
    request("/tasks", "POST", { projectId, title: "Bounds", recurrence });
  /** Largest gap between 5 ms timer ticks while the work runs: a synchronous stall shows up as lag. */
  const lagDuring = async <T>(work: () => Promise<T>) => {
    let last = performance.now();
    let max = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      max = Math.max(max, now - last - 5);
      last = now;
    }, 5);
    try {
      return { result: await work(), lag: max };
    } finally {
      clearInterval(timer);
    }
  };

  it("rejects duplicate RRULE parts in any letter case and canonicalizes single lowercase parts", async () => {
    const duplicates = [
      "FREQ=DAILY;freq=WEEKLY",
      "FREQ=DAILY;INTERVAL=2;interval=3",
      "FREQ=WEEKLY;BYDAY=MO;byday=TU",
      "FREQ=DAILY;COUNT=2;count=5",
      "FREQ=DAILY;UNTIL=20270101T000000Z;until=20280101T000000Z",
      "FREQ=DAILY;Count=2;COUNT=2",
    ];
    for (const rule of duplicates) {
      const response = await post(
        `DTSTART;TZID=America/New_York:20261005T090000\nRRULE:${rule}`,
      );
      expect(response.status, rule).toBe(400);
    }
    const lower = task.parse(
      await (
        await post(
          "DTSTART;TZID=America/New_York:20261005T090000\nRRULE:freq=weekly;byday=mo",
        )
      ).json(),
    );
    expect(lower.recurrence).toBe(
      "DTSTART;TZID=America/New_York:20261005T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO",
    );
  });

  it("bounds evaluation work: pathological rules fail honestly without stalling the event loop, legitimate sparse, leap and COUNT rules still work", async () => {
    const pathological = [
      "DTSTART;TZID=America/New_York:20261206T090000\nRRULE:FREQ=YEARLY;BYDAY=TH,SU;BYSETPOS=111",
      "DTSTART;TZID=America/New_York:20261206T090000\nRRULE:FREQ=YEARLY;BYDAY=MO;BYSETPOS=366",
    ];
    for (const rule of pathological) {
      const { result, lag } = await lagDuring(async () => {
        const [created, unrelated] = await Promise.all([
          post(rule),
          request(`/tasks?projectId=${projectId}`),
        ]);
        return { created, unrelated };
      });
      expect(result.created.status, rule).toBe(400);
      expect(result.unrelated.status).toBe(200);
      expect(lag, rule).toBeLessThan(400);
    }
    // The same on the Done path: a stored unevaluable rule is a bounded conflict with no mutation.
    const stored = await make();
    await database.pool.query("update tasks set recurrence=$2 where id=$1", [
      stored.id,
      pathological[0],
    ]);
    const before = await scope(ownerId, getCursor);
    const { result: done, lag } = await lagDuring(() =>
      request(`/tasks/${stored.id}/status`, "POST", {
        status: "done",
        editToken: stored.editToken,
      }),
    );
    expect(done.status).toBe(409);
    expect(lag).toBeLessThan(400);
    expect(await children(stored.id)).toEqual([]);
    expect(await scope(ownerId, getCursor)).toBe(before);
    expect((await scope(ownerId, (c) => getTask(c, stored.id))).status).toBe(
      "todo",
    );
    const legitimate = [
      "DTSTART;TZID=UTC:20240229T090000\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
      "DTSTART;TZID=UTC:20240101T090000\nRRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO;COUNT=100",
      "DTSTART;TZID=UTC:20000101T090000\nRRULE:FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYSETPOS=-1;COUNT=1000",
      "DTSTART;TZID=UTC:20240131T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=1000",
      "DTSTART;TZID=UTC:20261005T090000\nRRULE:FREQ=YEARLY;INTERVAL=1000",
    ];
    for (const rule of legitimate)
      expect((await post(rule)).status, rule).toBe(200);
  });

  it("never turns an unrepresentable or unsearchable result into a false end or a server error", async () => {
    const response = await post(LEAP_INTERVAL);
    expect(response.status).toBe(400);
    for (const rule of [
      "DTSTART;TZID=America/Los_Angeles:99991231T230000\nRRULE:FREQ=DAILY;COUNT=2",
      "DTSTART;TZID=UTC:20240101T090000\nRRULE:FREQ=MONTHLY;INTERVAL=1000;BYMONTHDAY=31;BYMONTH=2",
    ])
      expect((await post(rule)).status, rule).toBe(400);
    // Stored rules whose next instant would be beyond year 9999, or that never match, conflict before any write.
    for (const rule of [
      LEAP_INTERVAL,
      "DTSTART;TZID=UTC:20240101T090000\nRRULE:FREQ=MONTHLY;INTERVAL=1000;BYMONTHDAY=31;BYMONTH=2",
    ]) {
      const stored = await make();
      await database.pool.query("update tasks set recurrence=$2 where id=$1", [
        stored.id,
        rule,
      ]);
      const before = await scope(ownerId, getCursor);
      const done = await request(`/tasks/${stored.id}/status`, "POST", {
        status: "done",
        editToken: stored.editToken,
      });
      expect(done.status, rule).toBe(409);
      expect(await children(stored.id)).toEqual([]);
      expect(await scope(ownerId, getCursor)).toBe(before);
      expect((await scope(ownerId, (c) => getTask(c, stored.id))).status).toBe(
        "todo",
      );
    }
  });

  it("rejects the YEARLY forms the library mis-expands or ignores, on create and update with no mutation, and keeps the qualified forms", async () => {
    const at9 = "DTSTART;TZID=America/New_York:20240101T090000\nRRULE:";
    const editable = await make();
    const before = {
      cursor: await scope(ownerId, getCursor),
      rows: (await database.pool.query("select count(*)::int n from tasks"))
        .rows,
    };
    // Plain weekday beside an ordinal one without BYMONTH silently dropped Saturdays; +/-53 spilled into the next year.
    for (const rule of [
      "FREQ=YEARLY;BYDAY=SA,2FR",
      "FREQ=YEARLY;BYDAY=2FR,SA",
      "FREQ=YEARLY;BYDAY=53MO",
      "FREQ=YEARLY;BYDAY=-53MO",
      "FREQ=YEARLY;BYDAY=+53SU",
      // BYMONTHDAY beside an ordinal BYDAY was ignored without BYMONTH (days 22-28, never the 15th).
      "FREQ=YEARLY;BYMONTHDAY=15;BYDAY=4FR",
      "FREQ=YEARLY;BYMONTHDAY=15;BYDAY=-1FR",
    ])
      expect((await post(at9 + rule)).status, rule).toBe(400);
    // The same guard on update: 400 with the stored recurrence, edit token and cursor untouched.
    const stored = async () =>
      (
        await database.pool.query(
          "select row_to_json(t)::text row from tasks t where id=$1",
          [editable.id],
        )
      ).rows;
    const beforeEdit = {
      cursor: await scope(ownerId, getCursor),
      row: await stored(),
    };
    for (const rule of [
      "FREQ=YEARLY;BYMONTHDAY=15;BYDAY=4FR",
      "FREQ=YEARLY;BYDAY=SA,2FR",
    ])
      expect(
        (
          await request(`/tasks/${editable.id}`, "PATCH", {
            editToken: editable.editToken,
            recurrence: at9 + rule,
          })
        ).status,
        rule,
      ).toBe(400);
    expect({
      cursor: await scope(ownerId, getCursor),
      row: await stored(),
    }).toEqual(beforeEdit);
    expect({
      cursor: await scope(ownerId, getCursor),
      rows: (await database.pool.query("select count(*)::int n from tasks"))
        .rows,
    }).toEqual(before);
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2024-01-02T12:00:00Z");
    // Accepted controls produce the expected independently computed next instants.
    const controls: [string, string][] = [
      ["FREQ=MONTHLY;BYDAY=SA,2FR", "2024-01-06T14:00:00.000Z"], // Saturday 6 Jan 09:00 EST
      ["FREQ=YEARLY;BYMONTH=6;BYDAY=SA,2FR", "2024-06-01T13:00:00.000Z"], // Saturday 1 Jun 09:00 EDT
      ["FREQ=YEARLY;BYDAY=2FR", "2024-01-12T14:00:00.000Z"], // 2nd Friday of the year
      ["FREQ=YEARLY;BYDAY=FR,SA", "2024-01-05T14:00:00.000Z"],
      ["FREQ=YEARLY;BYDAY=52MO", "2024-12-23T14:00:00.000Z"], // 52nd Monday
      ["FREQ=YEARLY;BYDAY=-52MO", "2024-01-08T14:00:00.000Z"], // 52nd Monday from the end
      // Fridays that are the 15th: 15 March 2024 (EDT); BYMONTH makes the ordinal month-scoped and keeps BYMONTHDAY.
      ["FREQ=YEARLY;BYMONTHDAY=15;BYDAY=FR", "2024-03-15T13:00:00.000Z"],
      ["FREQ=YEARLY;BYMONTHDAY=15", "2024-01-15T14:00:00.000Z"],
      [
        "FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=23;BYDAY=4FR",
        "2026-01-23T14:00:00.000Z",
      ],
      [
        "FREQ=MONTHLY;BYMONTHDAY=22,23,24,25,26,27,28;BYDAY=4FR",
        "2024-01-26T14:00:00.000Z",
      ],
    ];
    for (const [rule, due] of controls) {
      const created = await make({ recurrence: at9 + rule });
      await complete(created.id);
      expect(
        new Date((await children(created.id))[0].dueAt).toISOString(),
        rule,
      ).toBe(due);
    }
  });
});
