import { openDatabase } from "@otto/db";
import { DomainError } from "@otto/shared";
import { z } from "zod";
import { ensureDefaultAgent } from "../packages/agents/src/server";
import {
  createEnvironment,
  getEnvironment,
} from "../packages/environments/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";

const connectionString = process.env.DATABASE_URL;
const [userId, target, workspaceId, ...extra] = process.argv.slice(2);
if (
  !connectionString ||
  !userId ||
  !target ||
  extra.length ||
  (target !== "--workspace" && workspaceId !== undefined)
)
  throw new Error(
    "Use the secret wrapper: bun scripts/bootstrap.ts <existing-user-id> <workspace-title> or <existing-user-id> --workspace <existing-workspace-id>",
  );
const existingWorkspaceId =
  target === "--workspace" ? z.uuid().parse(workspaceId) : undefined;
const { db, pool } = openDatabase({ connectionString });
try {
  const workspace = existingWorkspaceId
    ? { id: existingWorkspaceId }
    : await claimInstallation(db, userId, target);
  await inWorkspace(db, workspace.id, { userId }, async (c) => {
    if (c.role !== "owner") throw new DomainError("forbidden");
    const agent = await ensureDefaultAgent(c);
    try {
      await getEnvironment(c, agent.id);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "not_found")
        throw error;
      await createEnvironment(c, agent.id);
    }
  });
  console.log(JSON.stringify({ workspaceId: workspace.id }));
} finally {
  await pool.end();
}
