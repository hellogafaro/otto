import { openDatabase } from "@otto/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getConstructionPlans } from "pg-boss";
import { startJobs } from "../apps/server/src/jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL must be injected through the secret wrapper");
const { db, pool } = openDatabase({ connectionString });
try {
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
  const existing = await pool.query(
    "select to_regclass('otto_jobs.version') as version",
  );
  if (!existing.rows[0]?.version)
    await pool.query(getConstructionPlans("otto_jobs"));
  const boss = await startJobs(db, pool, false, true);
  await boss.stop();
} finally {
  await pool.end();
}
