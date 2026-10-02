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
import { agentSkills, agents } from "./schema";

/** Skill selections are sets of canonical UUIDs, not an instruction priority list. */
function normalizeSkillIds(ids?: string[]) {
  if (ids === undefined) return undefined;
  const selected = ids.map((id) => id.toLowerCase()).sort();
  if (selected.length > 50 || new Set(selected).size !== selected.length)
    throw new DomainError("invalid", "Agent selection limit");
  return selected;
}

export async function createAgent(
  c: Context,
  input: {
    visibility?: "user" | "workspace";
    title: string;
    instructions: string;
    harness: string;
    model: string;
    projectId?: string;
    subscriptionId?: string;
    skillIds?: string[];
  },
) {
  requireHuman(c);
  requireWriter(c);
  const skillIds = normalizeSkillIds(input.skillIds);
  if (input.projectId) await getProject(c, input.projectId, true);
  const agent = required(
    (
      await c.tx
        .insert(agents)
        .values({
          visibility: input.visibility,
          title: input.title,
          instructions: input.instructions,
          harness: input.harness,
          model: input.model,
          projectId: input.projectId,
          subscriptionId: input.subscriptionId,
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
        })
        .returning()
    )[0],
  );
  if (skillIds?.length)
    await c.tx.insert(agentSkills).values(
      skillIds.map((skillId) => ({
        workspaceId: c.workspaceId,
        agentId: agent.id,
        skillId,
      })),
    );
  await advanceCursor(c);
  return getAgent(c, agent.id);
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
  if (agent.visibility === "user" && agent.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  if (agent.projectId) await getProject(c, agent.projectId);
  const selected = await c.tx
    .select({ skillId: agentSkills.skillId })
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.agentId, id),
        eq(agentSkills.workspaceId, c.workspaceId),
      ),
    )
    .orderBy(agentSkills.skillId)
    .limit(51);
  if (selected.length > 50)
    throw new DomainError("invalid", "Agent selection limit");
  return { ...agent, skillIds: selected.map((row) => row.skillId) };
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
    .select({ id: agents.id })
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
    (agent) => getAgent(c, agent.id),
  );
}
export async function updateAgent(
  c: Context,
  id: string,
  input: {
    visibility?: "user" | "workspace";
    title?: string;
    instructions?: string;
    harness?: string;
    model?: string;
    subscriptionId?: string | null;
    skillIds?: string[];
    editToken: number;
  },
) {
  requireHuman(c);
  requireWriter(c);
  const skillIds = normalizeSkillIds(input.skillIds);
  const current = await getAgent(c, id);
  if (current.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  if (current.editToken !== input.editToken)
    throw new DomainError("conflict", "Agent changed");
  if (
    [
      input.visibility,
      input.title,
      input.instructions,
      input.harness,
      input.model,
      input.subscriptionId,
      skillIds,
    ].every((value) => value === undefined)
  )
    throw new DomainError("invalid", "No editable fields");
  const updated = required(
    (
      await c.tx
        .update(agents)
        .set({
          visibility: input.visibility,
          title: input.title,
          instructions: input.instructions,
          harness: input.harness,
          model: input.model,
          subscriptionId: input.subscriptionId,
          editToken: current.editToken + 1,
        })
        .where(eq(agents.id, id))
        .returning()
    )[0],
  );
  if (skillIds !== undefined) {
    await c.tx
      .delete(agentSkills)
      .where(
        and(
          eq(agentSkills.agentId, id),
          eq(agentSkills.workspaceId, c.workspaceId),
        ),
      );
    if (skillIds.length)
      await c.tx.insert(agentSkills).values(
        skillIds.map((skillId) => ({
          workspaceId: c.workspaceId,
          agentId: id,
          skillId,
        })),
      );
  }
  await advanceCursor(c);
  return {
    ...updated,
    skillIds: skillIds ?? current.skillIds,
  };
}

export async function archiveAgent(c: Context, id: string, archived: boolean) {
  requireHuman(c);
  requireWriter(c);
  const agent = await getAgent(c, id);
  if (agent.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx
    .update(agents)
    .set({ archived, editToken: agent.editToken + 1 })
    .where(eq(agents.id, id));
  await advanceCursor(c);
}
