import { getAgent } from "@otto/agents";
import { required } from "@otto/shared";

import { advanceCursor, type Context, requireHuman } from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { environments } from "./schema";
/** Creates a durable unavailable Environment record. It does not provision a computer. */
export async function createEnvironment(c: Context, agentId: string) {
  requireHuman(c);
  await getAgent(c, agentId);
  const environment = required(
    (
      await c.tx
        .insert(environments)
        .values({
          workspaceId: c.workspaceId,
          agentId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return environment;
}
export async function getEnvironment(c: Context, agentId: string) {
  await getAgent(c, agentId);
  return required(
    (
      await c.tx
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.workspaceId, c.workspaceId),
            eq(environments.agentId, agentId),
          ),
        )
    )[0],
  );
}
