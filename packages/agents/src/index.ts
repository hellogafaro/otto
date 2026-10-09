import {
  authorizedPage,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import { getProject, projectReadable } from "@otto/projects";
import { DomainError, type PageOptions, required } from "@otto/shared";
import { getSubscription } from "@otto/subscriptions";
import {
  advanceCursor,
  type Context,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, or } from "drizzle-orm";
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
  // An Agent may only name an account its author may use: shared, or their own.
  if (input.subscriptionId) {
    const provider = await getSubscription(c, input.subscriptionId);
    if (
      provider.provider === "codex" ||
      provider.status !== "enabled" ||
      !provider.models.includes(input.model)
    )
      throw new DomainError(
        "invalid",
        "Choose an available provider and configured model",
      );
  }
  const agent = required(
    (
      await c.tx
        .insert(agents)
        .values({
          visibility: input.visibility,
          title: input.title,
          instructions: input.instructions,
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

const agentSorts = {
  title: textKey(agents.title),
  createdAt: timeKey(agents.createdAt),
  updatedAt: timeKey(agents.updatedAt),
};
export const AGENT_SORTS = sortNames(agentSorts);
export async function getAgents(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    projectId?: string;
    visibility?: "user" | "workspace";
    createdBy?: string;
    archived?: boolean;
    query?: string;
  } = {},
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getAgents",
    scope: c,
    filter: f,
    keys: agentSorts,
    id: agents.id,
  });
  if (f.projectId) await getProject(c, f.projectId);
  const candidates = await c.tx
    .select({ id: agents.id, position: plan.position })
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, c.workspaceId),
        eq(agents.archived, f.archived),
        f.projectId ? eq(agents.projectId, f.projectId) : undefined,
        projectReadable(c, agents.projectId),
        f.visibility ? eq(agents.visibility, f.visibility) : undefined,
        f.createdBy ? eq(agents.createdBy, f.createdBy) : undefined,
        // Narrowing only: another person's private Agents are never scanned; getAgent stays the authority.
        or(
          eq(agents.visibility, "workspace"),
          eq(agents.createdBy, c.actor.userId),
        ),
        f.query ? matchesText(agents.title, f.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(candidates, plan, (row) => row.id),
    (agent) => getAgent(c, agent.id),
    plan,
  );
}
export async function updateAgent(
  c: Context,
  id: string,
  input: {
    visibility?: "user" | "workspace";
    title?: string;
    instructions?: string;
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
  if (
    current.isDefault &&
    input.visibility !== undefined &&
    input.visibility !== "workspace"
  )
    throw new DomainError("forbidden", "Default agent must remain shared");
  if (current.editToken !== input.editToken)
    throw new DomainError("conflict", "Agent changed");
  const subscriptionId =
    input.subscriptionId === undefined
      ? current.subscriptionId
      : input.subscriptionId;
  const model = input.model ?? current.model;
  if (
    subscriptionId &&
    (subscriptionId !== current.subscriptionId || model !== current.model)
  ) {
    const provider = await getSubscription(c, subscriptionId);
    if (
      provider.provider === "codex" ||
      provider.status !== "enabled" ||
      !provider.models.includes(model)
    )
      throw new DomainError(
        "invalid",
        "Choose an available provider and configured model",
      );
  }
  if (
    [
      input.visibility,
      input.title,
      input.instructions,
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
  if (agent.isDefault && archived)
    throw new DomainError("forbidden", "Default agent cannot be archived");
  await c.tx
    .update(agents)
    .set({ archived, editToken: agent.editToken + 1 })
    .where(eq(agents.id, id));
  await advanceCursor(c);
}
