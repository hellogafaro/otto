import {
  CRON_QUEUE,
  deliverOccurrence,
  reconcileSchedule,
  SCHEDULE_QUEUE,
  validateAutomation,
} from "@otto/automations";
import type { Database } from "@otto/db";
import { dispatchRun, RUN_QUEUE, recoverRuns } from "@otto/runs";
import type { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { createLogger } from "./logger";
export const JOBS_SCHEMA = "otto_jobs";
/** Starts library-owned queues in the existing server, with automatic DDL disabled. */
export async function startJobs(
  db: Database,
  pool: Pool,
  workers = true,
  install = false,
) {
  const logger = createLogger();
  const boss = new PgBoss({
    schema: JOBS_SCHEMA,
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
  await boss.start();
  for (const name of [RUN_QUEUE, CRON_QUEUE, SCHEDULE_QUEUE]) {
    if (!install) {
      if (!(await boss.getQueue(name))) {
        await boss.stop();
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
    await recoverRuns(db, boss);
    await boss.work(
      RUN_QUEUE,
      { batchSize: 4, localConcurrency: 2 },
      async (jobs) => {
        for (const job of jobs) {
          const { runId } = z.object({ runId: z.uuid() }).parse(job.data);
          await dispatchRun(db, runId, validateAutomation);
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
          .object({ automationId: z.uuid(), token: z.number().int() })
          .parse(job.data);
        await deliverOccurrence(db, boss, { ...data, jobId: job.id });
      }
    });
  }
  return boss;
}
