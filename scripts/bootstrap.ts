import { openDatabase } from "@otto/db";
import { claimInstallation } from "../packages/workspaces/src";

const connectionString = process.env.DATABASE_URL;
const userId = process.argv[2];
const title = process.argv[3];
if (!connectionString || !userId || !title)
  throw new Error(
    "Use the secret wrapper: bun scripts/bootstrap.ts <existing-user-id> <workspace-title>",
  );
const { db, pool } = openDatabase({ connectionString });
try {
  const workspace = await claimInstallation(db, userId, title);
  console.log(JSON.stringify({ workspaceId: workspace.id }));
} finally {
  await pool.end();
}
