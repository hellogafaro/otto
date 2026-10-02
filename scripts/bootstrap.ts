import { openDatabase } from "@otto/db";
import { claimInstallation } from "../packages/workspaces/src";

const connectionString = process.env.DATABASE_URL;
const userId = process.argv[2];
const name = process.argv[3];
if (!connectionString || !userId || !name)
  throw new Error(
    "Use the secret wrapper: bun scripts/bootstrap.ts <existing-user-id> <workspace-name>",
  );
const { db, pool } = openDatabase({ connectionString });
try {
  const workspace = await claimInstallation(db, userId, name);
  console.log(JSON.stringify({ workspaceId: workspace.id }));
} finally {
  await pool.end();
}
