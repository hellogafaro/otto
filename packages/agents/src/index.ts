import { required } from "@otto/db";
import { getProject } from "@otto/projects";
import {
  advanceRevision,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { agents } from "./schema";
export async function createAgent(
  c: Context,
  input: {
    name: string;
    instructions: string;
    harness: string;
    harnessRelease: string;
    model: string;
    projectId?: string;
    accountConnectionId?: string;
    skillIds?: string[];
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  const agent = required(
    (
      await c.tx
        .insert(agents)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceRevision(c);
  return agent;
}
export async function getAgent(c: Context, id: string) {
  const agent = required(
    (
      await c.tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.workspaceId, c.workspaceId)))
    )[0],
  );
  if (agent.projectId) await getProject(c, agent.projectId);
  return agent;
}
