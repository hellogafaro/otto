import { getAgent } from "@otto/agents";
import {
  authorizedPage,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import {
  getProject,
  getProjectAudience,
  projectReadable,
} from "@otto/projects";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  creatorIsMember,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { formatSkillFile, parseSkillFile } from "./format";
import { type SkillFileReference, skillProposals, skills } from "./schema";
export async function createSkill(
  c: Context,
  input: {
    title: string;
    instructions: string;
    projectId?: string;
    visibility?: "user" | "workspace";
    whenToUse?: string;
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  const skill = required(
    (
      await c.tx
        .insert(skills)
        .values({
          title: input.title,
          instructions: input.instructions,
          projectId: input.projectId,
          whenToUse: input.whenToUse,
          visibility: input.visibility ?? "user",
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return projectSkill(skill);
}
export async function getSkill(c: Context, id: string, write = false) {
  const skill = required(
    (
      await c.tx
        .select()
        .from(skills)
        .where(and(eq(skills.id, id), eq(skills.workspaceId, c.workspaceId)))
    )[0],
  );
  if (skill.projectId) await getProject(c, skill.projectId, write);
  await requireMember(c, skill.createdBy);
  if (skill.visibility === "user" && skill.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  if (c.actor.agentId) {
    const agent = await getAgent(c, c.actor.agentId);
    if (
      !agent.skillIds.includes(skill.id) ||
      (skill.visibility === "user" && agent.createdBy !== skill.createdBy)
    )
      throw new DomainError("forbidden");
  }
  if (write) {
    requireHuman(c);
    requireWriter(c);
    if (skill.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  }
  return projectSkill(skill);
}
export async function updateSkill(
  c: Context,
  id: string,
  input: {
    title?: string;
    instructions?: string;
    whenToUse?: string;
    visibility?: "user" | "workspace";
    editToken: number;
  },
) {
  const skill = await getSkill(c, id, true);
  if (skill.editToken !== input.editToken)
    throw new DomainError("conflict", "Skill changed");
  if (
    input.title === undefined &&
    input.instructions === undefined &&
    input.whenToUse === undefined &&
    input.visibility === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  if (
    input.whenToUse !== undefined &&
    (input.whenToUse.length > 100000 ||
      Buffer.byteLength(input.whenToUse) > 100000)
  )
    throw new DomainError("invalid");
  const updated = required(
    (
      await c.tx
        .update(skills)
        .set({
          title: input.title,
          instructions: input.instructions,
          whenToUse: input.whenToUse,
          visibility: input.visibility,
          editToken: skill.editToken + 1,
        })
        .where(eq(skills.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return projectSkill(updated);
}
/** Current skill source permission, independent of whether it remains selectable for new Runs. */
export async function validateSkillAccess(
  c: Context,
  id: string,
  audience: { humans: string[]; agents: string[] },
) {
  const skill = await getSkill(c, id);
  const available = await skillAudience(c, skill);
  if (audience.humans.some((userId) => !available.includes(userId)))
    throw new DomainError("forbidden", "Skill audience mismatch");
  for (const agentId of audience.agents) {
    const agent = await getAgent(c, agentId);
    if (skill.visibility === "user" && agent.createdBy !== skill.createdBy)
      throw new DomainError("forbidden", "User-scoped skill dependency");
  }
  return projectSkill(skill);
}
export async function snapshotSkills(
  c: Context,
  ids: string[],
  audience: { humans: string[]; agents: string[] },
) {
  const snapshots = [];
  for (const id of ids) {
    const skill = await validateSkillAccess(c, id, audience);
    if (skill.archived) throw new DomainError("invalid", "Not a skill");
    // Preserve the private accepted Run/Session identity key across the domain split.
    snapshots.push({
      documentId: skill.id,
      title: skill.title,
      instructions: skill.instructions,
      whenToUse: skill.whenToUse,
      editToken: skill.editToken,
      supportingFiles: skill.supportingFiles.map((file) => ({
        path: file.path,
        artifactId: file.fileId,
        sha256: file.sha256,
        byteLength: file.byteLength,
      })),
    });
  }
  return snapshots;
}
const skillSorts = {
  title: textKey(skills.title),
  createdAt: timeKey(skills.createdAt),
  updatedAt: timeKey(skills.updatedAt),
};
export const SKILL_SORTS = sortNames(skillSorts);
export async function getSkills(
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
    operation: "getSkills",
    scope: c,
    filter: f,
    keys: skillSorts,
    id: skills.id,
  });
  if (f.projectId) await getProject(c, f.projectId);
  // An Agent actor sees only its selected Skills (`getSkill`); an Agent it cannot read denies every Skill.
  let selection: { skillIds: string[]; createdBy: string } | undefined;
  if (c.actor.agentId) {
    try {
      const agent = await getAgent(c, c.actor.agentId);
      selection = { skillIds: agent.skillIds, createdBy: agent.createdBy };
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
    if (!selection?.skillIds.length) return { items: [], next: null };
  }
  const rows = await c.tx
    .select({ id: skills.id, position: plan.position })
    .from(skills)
    .where(
      and(
        eq(skills.workspaceId, c.workspaceId),
        eq(skills.archived, f.archived),
        f.projectId ? eq(skills.projectId, f.projectId) : undefined,
        f.visibility ? eq(skills.visibility, f.visibility) : undefined,
        f.createdBy ? eq(skills.createdBy, f.createdBy) : undefined,
        // Narrowing only: another person's private Skills are never scanned; getSkill stays the authority.
        or(
          eq(skills.visibility, "workspace"),
          eq(skills.createdBy, c.actor.userId),
        ),
        projectReadable(c, skills.projectId),
        creatorIsMember(c, skills.createdBy),
        selection ? inArray(skills.id, selection.skillIds) : undefined,
        selection
          ? or(
              eq(skills.visibility, "workspace"),
              eq(skills.createdBy, selection.createdBy),
            )
          : undefined,
        f.query
          ? matchesText(
              sql`${skills.title} || ' ' || ${skills.instructions}`,
              f.query,
            )
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => {
      const skill = await getSkill(c, row.id);
      return {
        id: skill.id,
        title: skill.title,
        projectId: skill.projectId,
        archived: skill.archived,
        editToken: skill.editToken,
      };
    },
    plan,
  );
}
export async function archiveSkill(
  c: Context,
  id: string,
  archived: boolean,
  editToken: number,
) {
  const skill = await getSkill(c, id, true);
  if (skill.editToken !== editToken) throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(skills)
        .set({ archived, editToken: skill.editToken + 1 })
        .where(eq(skills.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return projectSkill(updated);
}
/** Trusted composition resolves immutable File references before calling this in the same workspace transaction. */
export async function setSkillFiles(
  c: Context,
  id: string,
  files: SkillFileReference[],
  editToken: number,
) {
  const skill = await getSkill(c, id, true);
  if (skill.editToken !== editToken) throw new DomainError("conflict");
  if (
    files.length > 30 ||
    new Set(files.map((f) => f.path)).size !== files.length ||
    files.some(
      (f) =>
        !/^(scripts|references|assets)\/[a-zA-Z0-9._/-]+$/.test(f.path) ||
        f.path.length > 240 ||
        f.path.split("/").some((p) => p === ".." || p === "." || p === ""),
    ) ||
    files.reduce((sum, f) => sum + f.byteLength, 0) > 8 * 1024 * 1024
  )
    throw new DomainError("invalid", "Invalid supporting files");
  const updated = required(
    (
      await c.tx
        .update(skills)
        .set({ supportingFiles: files, editToken: skill.editToken + 1 })
        .where(eq(skills.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return projectSkill(updated);
}

export type { AcceptedSkillFileReference, SkillFileReference } from "./schema";

/** Old stored Skill references project to the current API without rewriting accepted evidence. */
function projectSkill(skill: typeof skills.$inferSelect) {
  return {
    ...skill,
    supportingFiles: skill.supportingFiles.map((file) => {
      // Exactly one persisted identity form is accepted; dual identities are ambiguous.
      const ids = [
        "fileId" in file ? file.fileId : undefined,
        "resourceId" in file ? file.resourceId : undefined,
        "artifactId" in file ? file.artifactId : undefined,
      ].filter((id) => id !== undefined);
      if (ids.length !== 1)
        throw new DomainError("conflict", "Ambiguous supporting file identity");
      return {
        path: file.path,
        fileId: ids[0] as string,
        sha256: file.sha256,
        byteLength: file.byteLength,
      };
    }),
  };
}

export async function getSkillAudience(c: Context, id: string) {
  return skillAudience(c, await getSkill(c, id));
}
async function skillAudience(c: Context, skill: typeof skills.$inferSelect) {
  const members = skill.projectId
    ? await getProjectAudience(c, skill.projectId)
    : await getWorkspaceAudience(c);
  return skill.visibility === "user"
    ? members.filter((id) => id === skill.createdBy)
    : members;
}
export async function importSkill(
  c: Context,
  input: {
    skillMd: string;
    projectId?: string;
    visibility?: "user" | "workspace";
  },
) {
  const parsed = parseSkillFile(input.skillMd);
  const skill = await createSkill(c, {
    title: parsed.title,
    instructions: parsed.instructions,
    whenToUse: parsed.whenToUse,
    projectId: input.projectId,
    visibility: input.visibility,
  });
  return projectSkill(
    required(
      (
        await c.tx
          .update(skills)
          .set({ metadata: parsed.metadata })
          .where(eq(skills.id, skill.id))
          .returning()
      )[0],
    ),
  );
}
export async function exportSkill(c: Context, id: string) {
  const skill = await getSkill(c, id);
  return { skillMd: formatSkillFile(skill), files: skill.supportingFiles };
}

/** Proposed content has no effect until an authorized human applies it to the unchanged source. */
export async function proposeSkillChange(
  c: Context,
  id: string,
  input: { title: string; instructions: string; editToken: number },
) {
  requireWriter(c);
  const skill = await getSkill(c, id);
  if (skill.editToken !== input.editToken) throw new DomainError("conflict");
  if (
    !input.title.trim() ||
    input.title.length > 200 ||
    new TextEncoder().encode(input.instructions).length > 100000
  )
    throw new DomainError("invalid");
  if (c.actor.agentId) {
    const agent = await getAgent(c, c.actor.agentId);
    if (agent.projectId && agent.projectId !== skill.projectId)
      throw new DomainError("forbidden");
  }
  const current = await c.tx
    .select({ id: skillProposals.id })
    .from(skillProposals)
    .where(eq(skillProposals.skillId, id))
    .limit(100);
  if (current.length >= 100)
    throw new DomainError("conflict", "Proposal limit");
  const proposal = required(
    (
      await c.tx
        .insert(skillProposals)
        .values({
          ...input,
          skillId: id,
          proposerId: c.actor.userId,
          agentId: c.actor.agentId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return proposal;
}
const skillProposalSorts = { title: textKey(skillProposals.title) };
export const SKILL_PROPOSAL_SORTS = sortNames(skillProposalSorts);
export async function getSkillProposals(
  c: Context,
  id: string,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    proposerId?: string;
    agentId?: string;
    query?: string;
  } = {},
) {
  await getSkill(c, id);
  const plan = sortPlan({
    operation: `getSkillProposals:${id}`,
    scope: c,
    filter,
    keys: skillProposalSorts,
    id: skillProposals.id,
  });
  const rows = await c.tx
    .select({
      id: skillProposals.id,
      skillId: skillProposals.skillId,
      proposerId: skillProposals.proposerId,
      agentId: skillProposals.agentId,
      title: skillProposals.title,
      instructions: skillProposals.instructions,
      editToken: skillProposals.editToken,
      position: plan.position,
    })
    .from(skillProposals)
    .where(
      and(
        eq(skillProposals.skillId, id),
        filter.proposerId
          ? eq(skillProposals.proposerId, filter.proposerId)
          : undefined,
        filter.agentId ? eq(skillProposals.agentId, filter.agentId) : undefined,
        filter.query
          ? matchesText(skillProposals.title, filter.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
}
export async function resolveSkillProposal(
  c: Context,
  id: string,
  proposalId: string,
  accept: boolean,
) {
  requireHuman(c);
  await getSkill(c, id, true);
  const proposal = required(
    (
      await c.tx
        .select()
        .from(skillProposals)
        .where(
          and(
            eq(skillProposals.id, proposalId),
            eq(skillProposals.skillId, id),
          ),
        )
    )[0],
  );
  if (accept)
    await updateSkill(c, id, {
      title: proposal.title,
      instructions: proposal.instructions,
      editToken: proposal.editToken,
    });
  await c.tx.delete(skillProposals).where(eq(skillProposals.id, proposalId));
  await advanceCursor(c);
}
