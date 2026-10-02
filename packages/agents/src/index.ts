import { getProject } from "@otto/projects";
import {
  DomainError,
  filterPage,
  getPage,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  advanceCursor,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt } from "drizzle-orm";
import { agents } from "./schema";
export async function createAgent(
  c: Context,
  input: {
    visibility?: "user" | "workspace";
    name: string;
    instructions: string;
    harness: string;
    model: string;
    projectId?: string;
    connectionId?: string;
    skillIds?: string[];
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (
    (input.skillIds?.length ?? 0) > 50 ||
    (input.skillIds && new Set(input.skillIds).size !== input.skillIds.length)
  )
    throw new DomainError("invalid", "Agent selection limit");
  if (input.projectId) await getProject(c, input.projectId, true);
  const agent = required(
    (
      await c.tx
        .insert(agents)
        .values({
          visibility: input.visibility,
          name: input.name,
          instructions: input.instructions,
          harness: input.harness,
          model: input.model,
          projectId: input.projectId,
          connectionId: input.connectionId,
          skillIds: input.skillIds,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
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
  if (agent.visibility === "user" && agent.ownerId !== c.actor.userId)
    throw new DomainError("forbidden");
  if (agent.projectId) await getProject(c, agent.projectId);
  return agent;
}

export async function getAgents(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    projectId?: string;
    archived?: boolean;
  } = {},
) {
  const { limit } = parsePageOptions(filter);
  if (filter.projectId) await getProject(c, filter.projectId);
  const candidates = await c.tx
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, c.workspaceId),
        eq(agents.archived, filter.archived ?? false),
        filter.after ? gt(agents.id, filter.after) : undefined,
        filter.projectId ? eq(agents.projectId, filter.projectId) : undefined,
      ),
    )
    .orderBy(agents.id)
    .limit(limit + 1);
  return filterPage(
    getPage(candidates, (row) => row.id, limit),
    async (agent) => {
      await getAgent(c, agent.id);
      return agent;
    },
  );
}
export async function updateAgent(
  c: Context,
  id: string,
  input: {
    visibility?: "user" | "workspace";
    name?: string;
    instructions?: string;
    harness?: string;
    model?: string;
    connectionId?: string | null;
    skillIds?: string[];
    editToken: number;
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (
    (input.skillIds?.length ?? 0) > 50 ||
    (input.skillIds && new Set(input.skillIds).size !== input.skillIds.length)
  )
    throw new DomainError("invalid", "Agent selection limit");
  const current = await getAgent(c, id);
  if (current.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  if (current.editToken !== input.editToken)
    throw new DomainError("conflict", "Agent changed");
  if (
    [
      input.visibility,
      input.name,
      input.instructions,
      input.harness,
      input.model,
      input.connectionId,
      input.skillIds,
    ].every((value) => value === undefined)
  )
    throw new DomainError("invalid", "No editable fields");
  const updated = required(
    (
      await c.tx
        .update(agents)
        .set({
          visibility: input.visibility,
          name: input.name,
          instructions: input.instructions,
          harness: input.harness,
          model: input.model,
          connectionId: input.connectionId,
          skillIds: input.skillIds,
          editToken: current.editToken + 1,
        })
        .where(eq(agents.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}

export async function archiveAgent(c: Context, id: string, archived: boolean) {
  requireHuman(c);
  requireWriter(c);
  const agent = await getAgent(c, id);
  if (agent.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(agents)
    .set({ archived, editToken: agent.editToken + 1 })
    .where(eq(agents.id, id));
  await advanceCursor(c);
}
