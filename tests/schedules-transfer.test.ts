import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { dispatchRun } from "../packages/runs/src";
import {
  CRON_QUEUE,
  deliverSchedule,
  reconcileSchedule,
  SCHEDULE_QUEUE,
  validateSchedule,
} from "../packages/schedules/src";
import { openNativeStorage } from "../packages/sessions/src/native";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { pushDatabase } from "../scripts/push";
import {
  controlledSubscription,
  nativeModelAuthorization,
} from "./fixtures/native-model";
import { startPostgres } from "./postgres";

it("offline Schedule rename retains old native queue deliveries, exact retries/history and accepted bytes", async () => {
  const database = await startPostgres();
  let boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  const nativeStorage = await openNativeStorage({
    connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
  });
  let app: ReturnType<typeof createApp>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) => app.fetch(r),
  });
  try {
    const origin = server.url.origin;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      nativeStorage,
      modelAuthorization: nativeModelAuthorization,
    });
    const registration = await auth.api.signUpEmail({
      body: {
        name: "Schedule Owner",
        email: "schedule@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      asResponse: true,
    });
    const cookie = registration.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing authenticated fixture");
    const workspaceId = (
      await claimInstallation(database.db, session.user.id, "Schedules")
    ).id;
    const subscriptionId = await inWorkspace(
      database.db,
      workspaceId,
      { userId: session.user.id },
      controlledSubscription,
    );
    const request = (path: string, method = "GET", json?: unknown) =>
      fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: { cookie, origin, "content-type": "application/json" },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
    const record = z
      .object({ id: z.string(), editToken: z.number().optional() })
      .passthrough();
    const post = async (path: string, json: unknown, method = "POST") => {
      const response = await request(path, method, json);
      expect(response.status, await response.clone().text()).toBe(200);
      return record.parse(await response.json());
    };
    const created = await request("/agents", "POST", {
      title: "Worker",
      instructions: "Work",
      model: "selected",
      subscriptionId,
      visibility: "workspace",
    });
    expect(created.status).toBe(200);
    const agent = z.object({ agent: record }).parse(await created.json()).agent;
    const chat = await post("/chats", {
      title: "Output",
      visibility: "workspace",
    });
    expect(
      (
        await request(`/chats/${chat.id}/participants`, "POST", {
          agentId: agent.id,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    // Private retained bindings are fixture data, not proof of a provisioned computer.
    const retainedScope = JSON.stringify({
      accepted: "schedule-rename-byte-proof",
      sources: [],
    });
    const environment = (
      await database.pool.query(
        'update environments set "executionScope"=$1 where "agentId"=$2 returning id,generation',
        [retainedScope, agent.id],
      )
    ).rows[0];
    if (!environment) throw new Error("Missing Agent Environment");
    await database.pool.query(
      'insert into agent_sessions(id,"workspaceId","chatId","agentId","environmentId","environmentGeneration",scope,"ownerId",provider,model,"accountId","contextRef") values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        crypto.randomUUID(),
        workspaceId,
        chat.id,
        agent.id,
        environment.id,
        environment.generation,
        retainedScope,
        session.user.id,
        "openai",
        "selected",
        "controlled-account",
        crypto.randomUUID(),
      ],
    );
    // Script execution is retired; this transfer proof exercises native prompt admission only.
    const config = {
      title: "Reusable manual work",
      agentId: agent.id,
      chatId: chat.id,
      type: "prompt",
      body: "Controlled native admission; do not execute a model",
      timezone: "Europe/Berlin",
      status: "disabled",
    };
    const manual = await post("/schedules", config);
    const requestId = crypto.randomUUID();
    const oldRun = await post(`/schedules/${manual.id}/run`, { requestId });
    const scheduled = await post("/schedules", {
      ...config,
      title: "Timed work",
      status: "enabled",
      cron: "0 0 1 1 *",
    });
    await reconcileSchedule(database.db, boss, scheduled.id);
    const priorHistoryId = crypto.randomUUID();
    await deliverSchedule(
      database.db,
      boss,
      { scheduleId: manual.id, editToken: 0, id: priorHistoryId },
      nativeModelAuthorization,
      nativeStorage,
    );
    const pendingTick = await boss.send(CRON_QUEUE, {
      automationId: scheduled.id,
      editToken: 0,
    });
    if (!pendingTick) throw new Error("Missing native tick identity");
    const pendingReconcile = await boss.findJobs(SCHEDULE_QUEUE, {
      data: { automationId: scheduled.id },
    });
    expect(pendingReconcile).toHaveLength(1);
    expect((await request(`/runs/${oldRun.id}/stop`, "POST", {})).status).toBe(
      200,
    );
    // Reconstruct captured old physical names only; native delivery rows already have old identities.
    await database.pool.query(`
      DO $$ DECLARE e record; BEGIN
        FOR e IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.conrelid IN ('schedules'::regclass,'schedule_history'::regclass,'runs'::regclass) AND c.conname LIKE '%schedule%' LOOP
          EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',e.relname,e.conname,replace(e.conname,'schedule','automation')); END LOOP;
        FOR e IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('schedules','schedule_history','runs') AND indexname LIKE '%schedule%' LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I',e.indexname,replace(e.indexname,'schedule','automation')); END LOOP;
      END $$;
      ALTER TABLE schedules RENAME TO automations;
      ALTER TABLE schedule_history RENAME TO automation_history;
      ALTER TABLE automation_history RENAME COLUMN "scheduleId" TO "automationId";
      ALTER TABLE runs RENAME COLUMN "scheduleId" TO "automationId";
      ALTER TABLE runs RENAME COLUMN "scheduleEditToken" TO "automationEditToken";
    `);
    const proof = async () => ({
      runs: (
        await database.pool.query(
          'select inputs::text,"requestIdentity"::text from runs order by id',
        )
      ).rows,
      sessions: (
        await database.pool.query(
          "select row_to_json(s)::text from agent_sessions s order by id",
        )
      ).rows,
      scopes: (
        await database.pool.query(
          'select "executionScope" from environments order by id',
        )
      ).rows,
      nativeSchedules: await boss.getSchedules(CRON_QUEUE),
      jobs: (
        await database.pool.query(
          "select id,name,data::text from queue.job order by id",
        )
      ).rows,
    });
    // A controlled old queued row demonstrates refusal; old runtime must stop it before transfer.
    await database.pool.query("update runs set state='queued' where id=$1", [
      oldRun.id,
    ]);
    const oldProof = await proof();
    const sql = await Bun.file(
      new URL("../scripts/rename-schedules.sql", import.meta.url),
    ).text();
    await expect(database.pool.query(sql)).rejects.toThrow("Quiescent Runs");
    await database.pool.query("ROLLBACK");
    expect(await proof()).toEqual(oldProof);
    await database.pool.query(
      "update runs set state='interrupted' where id=$1",
      [oldRun.id],
    );
    const before = await proof();
    const history = (
      await database.pool.query(
        'select id,"automationId", "runId",outcome,"receivedAt" from automation_history',
      )
    ).rows;
    await database.pool.query(sql);
    expect(await proof()).toEqual(before);
    expect(
      (
        await database.pool.query(
          'select id,"scheduleId" as "automationId", "runId",outcome,"receivedAt" from schedule_history',
        )
      ).rows,
    ).toEqual(history);
    expect((await post(`/schedules/${manual.id}/run`, { requestId })).id).toBe(
      oldRun.id,
    );
    expect(await proof()).toEqual(before);
    expect((await request(`/automations/${manual.id}`)).status).toBe(404);
    expect((await request(`/schedules/${scheduled.id}`)).status).toBe(200);
    expect((await request(`/schedules/${scheduled.id}/history`)).status).toBe(
      200,
    );
    await pushDatabase(
      `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    );
    expect(await proof()).toEqual(before);
    const dispatched: string[] = [];
    await boss.stop();
    boss = await startQueue(database.db, database.pool, {
      modelAuthorization: nativeModelAuthorization,
      nativeStorage,
      runtime: {
        async recover() {},
        async dispatch(id) {
          dispatched.push(id);
          await dispatchRun(database.db, id, validateSchedule);
        },
      },
    });
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      nativeStorage,
      modelAuthorization: nativeModelAuthorization,
    });
    await expect
      .poll(
        async () =>
          (
            await database.pool.query(
              'select "runId",outcome from schedule_history where id=$1',
              [pendingTick],
            )
          ).rows[0],
        { timeout: 10000 },
      )
      .toMatchObject({ outcome: "admitted_or_existing" });
    const received = (
      await database.pool.query(
        'select "runId" from schedule_history where id=$1',
        [pendingTick],
      )
    ).rows[0]?.runId;
    expect(typeof received).toBe("string");
    await expect
      .poll(
        async () =>
          (
            await boss.getJobById(
              SCHEDULE_QUEUE,
              pendingReconcile[0]?.id ?? "missing",
            )
          )?.state,
        { timeout: 10000 },
      )
      .toBe("completed");
    await expect
      .poll(() => dispatched.includes(received), { timeout: 10000 })
      .toBe(true);
    const firstCount = (
      await database.pool.query(
        'select count(*)::int as n from runs where "scheduleId"=$1',
        [scheduled.id],
      )
    ).rows[0]?.n;
    await deliverSchedule(
      database.db,
      boss,
      { scheduleId: scheduled.id, editToken: 0, id: pendingTick },
      nativeModelAuthorization,
      nativeStorage,
    );
    expect(
      (
        await database.pool.query(
          'select count(*)::int as n from runs where "scheduleId"=$1',
          [scheduled.id],
        )
      ).rows[0]?.n,
    ).toBe(firstCount);
    await boss.stop();
    boss = await startQueue(database.db, database.pool, { workers: false });
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      nativeStorage,
      modelAuthorization: nativeModelAuthorization,
    });
    expect(
      (
        await database.pool.query(
          "select count(*)::int as n from schedule_history where id=$1",
          [pendingTick],
        )
      ).rows[0]?.n,
    ).toBe(1);
    // Stale queued configuration is rejected at launch; disabling also unschedules cron.
    expect((await request(`/runs/${received}/stop`, "POST", {})).status).toBe(
      200,
    );
    const queued = await post(`/schedules/${scheduled.id}/run`, {
      requestId: crypto.randomUUID(),
    });
    await post(
      `/schedules/${scheduled.id}`,
      { status: "disabled", editToken: 0 },
      "PATCH",
    );
    await dispatchRun(database.db, queued.id, validateSchedule);
    expect(
      (
        await database.pool.query(
          "select state,outcome from runs where id=$1",
          [queued.id],
        )
      ).rows[0],
    ).toEqual({ state: "failed", outcome: "configuration_changed" });
    await reconcileSchedule(database.db, boss, scheduled.id);
    expect(await boss.getSchedule(CRON_QUEUE, scheduled.id)).toBeNull();
    const stale = await deliverSchedule(
      database.db,
      boss,
      { scheduleId: scheduled.id, editToken: 0, id: crypto.randomUUID() },
      nativeModelAuthorization,
      nativeStorage,
    );
    expect(stale.outcome).toBe("stale_configuration");
    const disabledRun = await post(`/schedules/${scheduled.id}/run`, {
      requestId: crypto.randomUUID(),
    });
    expect(disabledRun.state).toBe("queued");
    expect(
      (await request(`/runs/${disabledRun.id}/stop`, "POST", {})).status,
    ).toBe(200);
    await post(
      `/schedules/${scheduled.id}`,
      { status: "archived", editToken: 1 },
      "PATCH",
    );
    expect(
      (
        await request(`/schedules/${scheduled.id}/run`, "POST", {
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    await post(
      `/schedules/${scheduled.id}`,
      { status: "disabled", editToken: 2 },
      "PATCH",
    );
    await reconcileSchedule(database.db, boss, scheduled.id);
    expect(await boss.getSchedule(CRON_QUEUE, scheduled.id)).toBeNull();
  } finally {
    await server.stop(true);
    await boss.stop();
    await nativeStorage.close();
    await database.stop();
  }
}, 60000);
