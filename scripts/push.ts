import { openDatabase } from "@otto/db";
import type { PoolClient } from "pg";
import { getConstructionPlans } from "pg-boss";
import { createLogger } from "../apps/server/src/logger";
import { startQueue } from "../apps/server/src/queue";

/** Native development schema sync; the config limits ownership to declared public tables. */
export async function pushDatabase(connectionString: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--bun",
      "drizzle-kit",
      "push",
      "--config=drizzle.config.ts",
    ],
    {
      cwd: new URL("../", import.meta.url).pathname,
      env: { PATH: process.env.PATH, DATABASE_URL: connectionString },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    },
  );
  const [output, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  // Native CLI does not apply destructive changes without interactive confirmation.
  // Reject incomplete/interactive runs even if that pinned CLI exits zero on EOF.
  const changed = output.includes("Changes applied");
  if (exitCode !== 0 || (!changed && !output.includes("No changes detected")))
    throw new Error(
      "Native schema push failed or requires interactive review; no automatic destructive approval",
    );
  return { changed };
}

if (import.meta.main) {
  const logger = createLogger();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error("DATABASE_URL must be injected through the secret wrapper");
    process.exitCode = 1;
  } else {
    const { db, pool } = openDatabase({ connectionString });
    pool.on("error", () => logger.error("schema database connection failure"));
    let lock: PoolClient | undefined;
    try {
      lock = await pool.connect();
      await lock.query("select pg_advisory_lock(1635021935, 1)");
      const legacy = await pool.query(
        "select to_regnamespace('otto_jobs') as legacy",
      );
      if (legacy.rows[0]?.legacy)
        throw new Error("Legacy queue requires operator migration");
      const result = await pushDatabase(connectionString);
      const existing = await pool.query(
        "select to_regclass('queue.version') as version",
      );
      if (!existing.rows[0]?.version)
        await pool.query(getConstructionPlans("queue"));
      const boss = await startQueue(db, pool, {
        workers: false,
        install: true,
      });
      await boss.stop();
      logger.info(result, "development schema sync complete");
    } catch {
      logger.error(
        "schema sync failed; inspect compatibility and connection configuration",
      );
      process.exitCode = 1;
    } finally {
      // Destroying the session releases its advisory lock, including after failures.
      lock?.release(true);
      await pool.end();
    }
  }
}
