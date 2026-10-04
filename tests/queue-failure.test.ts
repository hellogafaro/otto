import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createChat, createParticipant } from "../packages/chats/src";
import { createEnvironment } from "../packages/environments/src";
import { admitRun, RUN_QUEUE } from "../packages/runs/src";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { startPostgres } from "./postgres";

describe("pg-boss dispatch failure ownership with controlled compute", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss | undefined;
  let runtime: ReturnType<typeof createRunRuntime>;
  let computer: ControlledComputer;
  let workspaceId: string;
  const scope = <T>(fn: Parameters<typeof inWorkspace<T>>[3]) =>
    inWorkspace(database.db, workspaceId, { userId: "owner" }, fn);
  const saved = async (id: string) =>
    (await database.db.select().from(runs).where(eq(runs.id, id)))[0];
  const job = async (id: string) =>
    (await boss.findJobs(RUN_QUEUE, { data: { runId: id } }))[0];

  beforeEach(async () => {
    expect(process.versions.bun).toBeTruthy();
    worker = undefined;
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
    workspaceId = (await claimInstallation(database.db, "owner", "Queue")).id;
    computer = new ControlledComputer("script-fixture-no-account");
    runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 20000,
    });
  });
  afterEach(async () => {
    await worker?.stop();
    await computer?.close();
    await runtime?.close();
    await boss?.stop();
    await database?.stop();
  });

  async function setup() {
    const target = await scope(async (c) => {
      const agent = await createAgent(c, {
        title: "Queue fixture",
        instructions: "Controlled script only",
        model: "fixture",
      });
      await createEnvironment(c, agent.id);
      const chat = await createChat(c, {
        title: "Queue fixture",
        visibility: "workspace",
      });
      await createParticipant(c, chat.id, {
        agentId: agent.id,
        role: "contributor",
      });
      return { agentId: agent.id, chatId: chat.id };
    });
    await runtime.bind(
      workspaceId,
      { userId: "owner" },
      target.agentId,
      target.agentId,
    );
    return target;
  }
  const admit = (target: Awaited<ReturnType<typeof setup>>, body = "finish") =>
    scope((c) =>
      admitRun(
        c,
        boss,
        {
          ...target,
          requestId: crypto.randomUUID(),
          type: "script",
          body,
        },
        pi,
      ),
    );

  it.each(["preparation", "busy-exhausted", "busy-retry"] as const)(
    "%s does not fail or consume retries for another Environment's work",
    async (mode) => {
      const accepted: {
        target: Awaited<ReturnType<typeof setup>>;
        run: Awaited<ReturnType<typeof admit>>;
      }[] = [];
      for (let i = 0; i < 3; i++) {
        const target = await setup();
        accepted.push({ target, run: await admit(target) });
      }
      // Shorten only the fixture retry budget, keeping the production admission path.
      await database.pool.query(
        "update queue.job set retry_limit=$1,retry_delay=1 where name=$2",
        [mode === "busy-retry" ? 1 : 0, RUN_QUEUE],
      );
      let failingId: string | undefined;
      let holder: Awaited<ReturnType<typeof admit>> | undefined;
      const attempts = new Map<string, number>();
      const failures: string[] = [];
      worker = await startQueue(database.db, database.pool, {
        runtime: {
          recover: () => runtime.recover(),
          async dispatch(id) {
            attempts.set(id, (attempts.get(id) ?? 0) + 1);
            try {
              // Pick the first delivered Run: SQL UPDATE RETURNING has no row-order guarantee.
              if (!failingId) {
                failingId = id;
                if (mode === "preparation")
                  throw new Error("Controlled preparation failure");
                const entry = accepted.find(({ run }) => run.id === id);
                if (!entry) throw new Error("Unexpected first dispatch");
                const heldRun = await admit(entry.target, "hold");
                holder = heldRun;
                await runtime.dispatch(heldRun.id);
                await expect
                  .poll(async () => (await saved(heldRun.id))?.state)
                  .toBe("running");
              }
              await runtime.dispatch(id);
            } catch (error) {
              failures.push(
                error instanceof Error ? error.message : String(error),
              );
              throw error;
            }
          },
        },
      });
      if (mode === "busy-retry") {
        await expect
          .poll(
            async () => (failingId ? (await job(failingId))?.state : undefined),
            { timeout: 10000 },
          )
          .toBe("retry");
        expect(failures).toContain("Environment busy");
        if (!holder) throw new Error("Missing held Run");
        await runtime.stop(workspaceId, { userId: "owner" }, holder.id);
      }
      await expect
        .poll(
          async () => {
            const states = await Promise.all(
              accepted.map(async ({ run }) => (await job(run.id))?.state),
            );
            return states.every(
              (state) => state === "completed" || state === "failed",
            );
          },
          { timeout: 10000 },
        )
        .toBe(true);
      if (!failingId) throw new Error("No dispatch attempted");
      const failedId = failingId;
      const siblings = accepted
        .filter(({ run }) => run.id !== failedId)
        .map(({ run }) => run);
      const observations = await Promise.all(
        accepted.map(async ({ run }) => ({
          role: run.id === failedId ? "failing" : "sibling",
          state: (await saved(run.id))?.state,
          job: (await job(run.id))?.state,
          retryCount: (await job(run.id))?.retryCount,
          attempts: attempts.get(run.id) ?? 0,
        })),
      );
      console.info(JSON.stringify({ mode, observations, failures }));
      await expect
        .poll(async () =>
          Promise.all(
            siblings.map(async (run) => (await saved(run.id))?.state),
          ),
        )
        .toEqual(["finished", "finished"]);
      for (const sibling of siblings) {
        expect(await job(sibling.id)).toMatchObject({
          state: "completed",
          retryCount: 0,
        });
        expect(attempts.get(sibling.id)).toBe(1);
      }
      if (mode === "busy-retry") {
        await expect
          .poll(async () => (await saved(failedId))?.state)
          .toBe("finished");
        expect(await job(failedId)).toMatchObject({ retryCount: 1 });
        expect(attempts.get(failedId)).toBe(2);
        if (!holder) throw new Error("Missing held Run");
        expect((await saved(holder.id))?.state).toBe("interrupted");
      } else {
        expect(await saved(failedId)).toMatchObject({
          state: "failed",
          outcome: "dispatch_retries_exhausted",
        });
        expect(attempts.get(failedId)).toBe(1);
        expect(failures).toContain(
          mode === "preparation"
            ? "Controlled preparation failure"
            : "Environment busy",
        );
      }
    },
  );
});
