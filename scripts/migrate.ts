import { openDatabase } from "@otto/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL must be injected through the secret wrapper");
const { db, pool } = openDatabase({ connectionString });
try {
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  });
} finally {
  await pool.end();
}
