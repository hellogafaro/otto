import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJobs } from "../apps/server/src/jobs";
import { createAgent } from "../packages/agents/src";
import { saveArtifact } from "../packages/artifacts/src";
import {
  CRON_QUEUE,
  createAutomation,
  deliverOccurrence,
  reconcileSchedule,
  saveAutomation,
  validateAutomation,
} from "../packages/automations/src";
import {
  addParticipant,
  createConversation,
} from "../packages/conversations/src";
import { createDocument, saveDocument } from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import {
  admitRun,
  dispatchRun,
  RUN_QUEUE,
  recordRunOutcome,
  recoverRuns,
} from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("real atomic Run and pg-boss admission", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let workspaceId: string;
  let agentId: string;
  let conversationId: string;
  let skillId: string;
  const scope = <T>(fn: Parameters<typeof inWorkspace<T>>[3]) =>
    inWorkspace(database.db, workspaceId, { userId: "owner" }, fn);
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startJobs(database.db, database.pool, false, true);
    await database.db.insert(users).values({
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    });
    workspaceId = (await claimInstallation(database.db, "owner", "Runs")).id;
    await scope(async (c) => {
      agentId = (
        await createAgent(c, {
          name: "Worker",
          instructions: "Do work",
          harness: "codex-acp",
          harnessRelease: "unqualified",
          model: "selected",
        })
      ).id;
      await createEnvironment(c, agentId);
      conversationId = (
        await createConversation(c, { title: "Shared", access: "inherited" })
      ).id;
      await addParticipant(c, conversationId, { agentId, role: "contributor" });
      skillId = (
        await createDocument(c, {
          title: "A skill",
          body: "Original instructions",
          skill: true,
          access: "inherited",
        })
      ).id;
    });
  });
  afterAll(async () => {
    await boss?.stop();
    await database?.stop();
  });
  const request = () => ({
    requestId: crypto.randomUUID(),
    conversationId,
    agentId,
    kind: "prompt" as const,
    body: "Hello",
    skillIds: [skillId],
  });
  it("rolls back Run, Session and queue job together", async () => {
    const input = request();
    const before = await database.pool.query(
      "select count(*)::int as count from agent_session",
    );
    await expect(
      scope(async (c) => {
        await admitRun(c, boss, input);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    const saved = await database.db
      .select()
      .from(runs)
      .where(eq(runs.requestId, input.requestId));
    expect(saved).toHaveLength(0);
    const jobs = await boss.findJobs<{ runId: string }>(RUN_QUEUE);
    expect(jobs).toHaveLength(0);
    const after = await database.pool.query(
      "select count(*)::int as count from agent_session",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
  it("deduplicates admission and keeps skill instructions from the accepted attempt", async () => {
    const input = request();
    const run = await scope((c) => admitRun(c, boss, input));
    const same = await scope((c) => admitRun(c, boss, input));
    expect(same.id).toBe(run.id);
    expect((await boss.findJobs(RUN_QUEUE)).length).toBe(1);
    await scope((c) =>
      saveDocument(c, skillId, {
        title: "A skill",
        body: "New instructions",
        editToken: 0,
      }),
    );
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(saved?.inputs.skills[0]?.instructions).toBe("Original instructions");
    expect(saved?.sessionId).toBeTruthy();
    const first = await dispatchRun(database.db, run.id);
    const duplicate = await dispatchRun(database.db, run.id);
    expect(first).toMatchObject({
      state: "failed",
      outcome: "compute_provider_not_selected",
    });
    expect(duplicate).toEqual(first);
  });
  it("rejects stale attempt results and leaves the durable state unchanged", async () => {
    const run = await scope((c) => admitRun(c, boss, request()));
    await expect(
      scope((c) =>
        recordRunOutcome(c, {
          id: run.id,
          attempt: 99,
          launchKey: crypto.randomUUID(),
          state: "finished",
          outcome: "wrong attempt",
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.state,
    ).toBe("queued");
    await dispatchRun(database.db, run.id);
  });
  it("deduplicates cron delivery, fences paused configuration and stores scripts without Sessions", async () => {
    const input = {
      name: "Nightly",
      agentId,
      conversationId,
      kind: "script" as const,
      body: "echo hello",
      skillIds: [],
      cron: "* * * * *",
      timezone: "Europe/Berlin",
      enabled: true,
    };
    const automation = await scope((c) => createAutomation(c, boss, input));
    await reconcileSchedule(database.db, boss, automation.id);
    const schedules = await boss.getSchedules(CRON_QUEUE);
    expect(schedules.some((s) => s.key === automation.id)).toBe(true);
    const tick = {
      automationId: automation.id,
      token: 0,
      jobId: crypto.randomUUID(),
    };
    const first = await deliverOccurrence(database.db, boss, tick);
    expect((await deliverOccurrence(database.db, boss, tick)).runId).toBe(
      first.runId,
    );
    const next = await deliverOccurrence(database.db, boss, {
      ...tick,
      jobId: crypto.randomUUID(),
    });
    expect(next.runId).toBe(first.runId);
    const saved = (
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.id, first.runId ?? ""))
    )[0];
    expect(saved?.sessionId).toBeNull();
    await scope((c) =>
      saveAutomation(c, boss, automation.id, {
        ...input,
        enabled: false,
        editToken: 0,
      }),
    );
    expect(
      await deliverOccurrence(database.db, boss, {
        ...tick,
        jobId: crypto.randomUUID(),
      }),
    ).toMatchObject({ outcome: "stale_configuration" });
    expect(
      await dispatchRun(database.db, first.runId ?? "", validateAutomation),
    ).toMatchObject({ outcome: "configuration_changed" });
    await reconcileSchedule(database.db, boss, automation.id);
    expect(
      (await boss.getSchedules(CRON_QUEUE)).some(
        (s) => s.key === automation.id,
      ),
    ).toBe(false);
  });
  it("requires a fresh Session when retained skill scope changes", async () => {
    const first = await scope((c) => admitRun(c, boss, request()));
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, first.id))
    )[0];
    await expect(
      scope((c) =>
        admitRun(c, boss, {
          ...request(),
          sessionId: saved?.sessionId ?? undefined,
          skillIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await dispatchRun(database.db, first.id);
  });
  it("recovers bookkeeping without requeuing a possibly launched execution", async () => {
    const run = await scope((c) => admitRun(c, boss, request()));
    await database.db
      .update(runs)
      .set({ state: "launching" })
      .where(eq(runs.id, run.id));
    const before = (await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } }))
      .length;
    await recoverRuns(database.db, boss);
    await recoverRuns(database.db, boss);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0],
    ).toMatchObject({
      state: "uncertain",
      outcome: "server_restarted_execution_unconfirmed",
    });
    expect(
      (await boss.findJobs(RUN_QUEUE, { data: { runId: run.id } })).length,
    ).toBe(before);
  });
  it("processes real pg-boss delivery and duplicate delivery through the server worker", async () => {
    const input = request();
    const run = await scope((c) => admitRun(c, boss, input));
    const workers = await startJobs(database.db, database.pool, true);
    try {
      await expect
        .poll(
          async () =>
            (
              await database.db.select().from(runs).where(eq(runs.id, run.id))
            )[0]?.state,
          { timeout: 10000 },
        )
        .toBe("failed");
      const duplicate = await boss.send(RUN_QUEUE, { runId: run.id });
      await expect
        .poll(
          async () =>
            (await boss.findJobs(RUN_QUEUE, { id: duplicate ?? "" }))[0]?.state,
          { timeout: 10000 },
        )
        .toBe("completed");
      expect(
        await database.db
          .select()
          .from(runs)
          .where(eq(runs.requestId, input.requestId)),
      ).toHaveLength(1);
    } finally {
      await workers.stop();
    }
  });
  it("does not widen saved Run output to people invited after admission", async () => {
    await database.db.insert(users).values({
      id: "new-reader",
      name: "New reader",
      email: "reader@example.test",
      emailVerified: true,
    });
    const run = await scope((c) => admitRun(c, boss, request()));
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "new-reader", role: "viewer" });
    const storage = {
      async put() {
        throw new Error("Storage must not be reached");
      },
      async get() {
        return new Uint8Array();
      },
    };
    await expect(
      saveArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        {
          sourceRunId: run.id,
          requestId: crypto.randomUUID(),
          title: "Output",
          kind: "text",
          mediaType: "text/plain",
          access: "inherited",
        },
        new Uint8Array([1]),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await dispatchRun(database.db, run.id);
  });
  it("rechecks sponsor membership on duplicate queue delivery", async () => {
    const run = await scope((c) => admitRun(c, boss, request()));
    await database.db.delete(members).where(eq(members.userId, "owner"));
    expect(await dispatchRun(database.db, run.id)).toMatchObject({
      state: "failed",
      outcome: "authorization_revoked",
    });
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.outcome,
    ).toBe("authorization_revoked");
  });
});
