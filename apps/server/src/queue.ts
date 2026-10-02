import {
  CRON_QUEUE,
  deliverAutomation,
  reconcileSchedule,
  SCHEDULE_QUEUE,
  validateAutomation,
} from "@otto/automations";
import { recoverConnectionOperations } from "@otto/connections/server";
import type { Database } from "@otto/db";
import {
  dispatchRun,
  failQueuedRun,
  type Harnesses,
  RUN_QUEUE,
  recoverRuns,
} from "@otto/runs";
import type { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { createLogger } from "./logger";
export const QUEUE_SCHEMA = "queue";
const RECOVERY_QUEUE = "connection-recovery";
/** Starts library-owned queues in the existing server, with automatic DDL disabled. */
export async function startQueue(
  db: Database,
  pool: Pool,
  options: {
    workers?: boolean;
    install?: boolean;
    harnesses?: Harnesses;
    runtime?: {
      dispatch(runId: string): Promise<void>;
      recover(): Promise<void>;
    };
  } = {},
) {
  const { workers = true, install = false, runtime } = options;
  const logger = createLogger();
  const boss = new PgBoss({
    schema: QUEUE_SCHEMA,
    migrate: false,
    db: {
      async executeSql(text, values) {
        return pool.query(text, values);
      },
    },
  });
  boss.on("error", (error) =>
    logger.error({ errorType: error.name }, "job failure"),
  );
  try {
    const legacy = await pool.query(
      "select to_regnamespace('otto_jobs') as legacy",
    );
    if (legacy.rows[0]?.legacy)
      throw new Error(
        "Legacy otto_jobs schema requires an operator-reviewed queue migration; startup refuses to abandon outstanding jobs",
      );
    await boss.start();
    for (const name of [
      RUN_QUEUE,
      CRON_QUEUE,
      SCHEDULE_QUEUE,
      RECOVERY_QUEUE,
    ]) {
      if (!install) {
        if (!(await boss.getQueue(name))) {
          throw new Error("Job queues require migration");
        }
        continue;
      }
      await boss.createQueue(name, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 60,
        retentionSeconds: 86400,
      });
    }
    if (workers) {
      const recovery = await recoverConnectionOperations(db);
      if (recovery.hasMore) await boss.send(RECOVERY_QUEUE, {});
      // Fresh interrupted claims become stale after startup; pg-boss owns the periodic work.
      await boss.schedule(
        RECOVERY_QUEUE,
        "* * * * *",
        {},
        {
          key: "connections",
          tz: "UTC",
          missed: "skip",
        },
      );
      await boss.work(RECOVERY_QUEUE, async () => {
        const recovery = await recoverConnectionOperations(db);
        if (recovery.hasMore) await boss.send(RECOVERY_QUEUE, {});
      });
      await runtime?.recover();
      await recoverRuns(db, boss);
      await boss.work(
        RUN_QUEUE,
        { batchSize: 1, localConcurrency: 2, includeMetadata: true },
        async (jobs) => {
          for (const job of jobs) {
            const { runId } = z.object({ runId: z.uuid() }).parse(job.data);
            try {
              if (runtime) await runtime.dispatch(runId);
              else await dispatchRun(db, runId, validateAutomation);
            } catch (error) {
              if (job.retryCount >= job.retryLimit)
                await failQueuedRun(db, runId, "dispatch_retries_exhausted");
              throw error;
            }
          }
        },
      );
      await boss.work(SCHEDULE_QUEUE, async (jobs) => {
        for (const job of jobs) {
          const { automationId } = z
            .object({ automationId: z.uuid() })
            .parse(job.data);
          await reconcileSchedule(db, boss, automationId);
        }
      });
      await boss.work(CRON_QUEUE, async (jobs) => {
        for (const job of jobs) {
          const data = z
            .object({ automationId: z.uuid(), editToken: z.number().int() })
            .parse(job.data);
          await deliverAutomation(
            db,
            boss,
            { ...data, id: job.id },
            options.harnesses,
          );
        }
      });
    }
    return boss;
  } catch (error) {
    try {
      await boss.stop({ graceful: false });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Queue startup and cleanup failed",
      );
    }
    throw error;
  }
}
