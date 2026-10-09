import {
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  requireAdmin,
  requireMember,
  userNameOf,
} from "@otto/workspaces";
import { type AnyColumn, and, eq, sql } from "drizzle-orm";
import { projectMembers, projects } from "./schema";
/**
 * SQL form of `getProject` read access: no Project, or a membership row for the actor (no role check on read).
 * Narrowing only, so a list never scans a row `getProject` would deny; `getProject` stays the authority.
 */
export const projectReadable = (c: Context, projectId: AnyColumn) =>
  sql`(${projectId} is null or exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projectId} and ${projectMembers.userId} = ${c.actor.userId}))`;
export async function getProject(c: Context, id: string, write = false) {
  const project = required(
    (
      await c.tx
        .select()
        .from(projects)
        .where(
          and(eq(projects.id, id), eq(projects.workspaceId, c.workspaceId)),
        )
    )[0],
  );
  const membership = (
    await c.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.userId, c.actor.userId),
        ),
      )
  )[0];
  if (
    !membership ||
    (write && (membership.role === "viewer" || c.role === "viewer"))
  )
    throw new DomainError("forbidden");
  return project;
}
export async function createProject(
  c: Context,
  input: { title: string; repositoryUrl?: string },
) {
  requireAdmin(c);
  const project = required(
    (
      await c.tx
        .insert(projects)
        .values({ ...input, workspaceId: c.workspaceId })
        .returning()
    )[0],
  );
  await c.tx.insert(projectMembers).values({
    projectId: project.id,
    userId: c.actor.userId,
    role: "contributor",
  });
  await advanceCursor(c);
  return project;
}
export async function upsertProjectMember(
  c: Context,
  projectId: string,
  userId: string,
  role: "viewer" | "contributor",
) {
  requireAdmin(c);
  await getProject(c, projectId, true);
  await requireMember(c, userId);
  const existing = (
    await c.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
  )[0];
  if (existing?.role === "contributor" && role === "viewer")
    throw new DomainError(
      "conflict",
      "Use member role change with task ownership checks",
    );
  await c.tx
    .insert(projectMembers)
    .values({ projectId, userId, role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    });
  await advanceCursor(c);
}
export async function requireProjectMember(
  c: Context,
  projectId: string,
  userId: string,
  write = false,
) {
  await requireMember(c, userId, write);
  const row = required(
    (
      await c.tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        )
    )[0],
    "forbidden",
  );
  if (write && row.role === "viewer") throw new DomainError("forbidden");
}
export async function archiveProject(
  c: Context,
  id: string,
  archived: boolean,
) {
  requireAdmin(c);
  await getProject(c, id, true);
  await c.tx.update(projects).set({ archived }).where(eq(projects.id, id));
  await advanceCursor(c);
}

export async function getProjectAudience(c: Context, projectId: string) {
  await getProject(c, projectId);
  const rows = await c.tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .limit(501);
  if (rows.length > 500)
    throw new DomainError("unavailable", "Audience exceeds initial limit");
  const active = await getWorkspaceAudience(c);
  return rows.map((r) => r.userId).filter((id) => active.includes(id));
}

export async function updateProject(
  c: Context,
  id: string,
  input: {
    title?: string;
    repositoryUrl?: string | null;
  },
) {
  requireAdmin(c);
  await getProject(c, id, true);
  if (input.title === undefined && input.repositoryUrl === undefined)
    throw new DomainError("invalid", "No editable fields");
  const updated = required(
    (
      await c.tx
        .update(projects)
        .set({
          title: input.title,
          repositoryUrl: input.repositoryUrl,
        })
        .where(eq(projects.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}

const projectSorts = {
  title: textKey(projects.title),
  createdAt: timeKey(projects.createdAt),
  updatedAt: timeKey(projects.updatedAt),
};
export const PROJECT_SORTS = sortNames(projectSorts);
export async function getProjects(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    archived?: boolean;
    query?: string;
  } = {},
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getProjects",
    scope: c,
    filter: f,
    keys: projectSorts,
    id: projects.id,
  });
  const items = await c.tx
    .select({
      id: projects.id,
      title: projects.title,
      archived: projects.archived,
      repositoryUrl: projects.repositoryUrl,
      position: plan.position,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, c.workspaceId),
        eq(projectMembers.userId, c.actor.userId),
        eq(projects.archived, f.archived),
        f.query ? matchesText(projects.title, f.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(items, plan, (row) => row.id);
}

const projectMemberSorts = {
  name: textKey(userNameOf(projectMembers.userId)),
};
export const PROJECT_MEMBER_SORTS = sortNames(projectMemberSorts);
export async function getProjectMembers(
  c: Context,
  id: string,
  options: PageOptions & {
    sort?: string;
    order?: string;
    role?: (typeof projectMembers.$inferSelect)["role"];
    query?: string;
  } = {},
) {
  await getProject(c, id);
  const plan = sortPlan({
    operation: `getProjectMembers:${id}`,
    scope: c,
    filter: options,
    keys: projectMemberSorts,
    id: projectMembers.userId,
    idKind: "text",
  });
  const rows = await c.tx
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      name: userNameOf(projectMembers.userId),
      position: plan.position,
    })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, id),
        options.role ? eq(projectMembers.role, options.role) : undefined,
        options.query
          ? matchesText(userNameOf(projectMembers.userId), options.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.userId);
}
/** Trusted server composition first checks open Task ownership before changing a member's eligibility. */
export async function updateProjectMember(
  c: Context,
  id: string,
  userId: string,
  role: "viewer" | "contributor",
) {
  requireAdmin(c);
  await getProject(c, id, true);
  await requireMember(c, userId);
  if (userId === c.actor.userId)
    throw new DomainError(
      "conflict",
      "Project administrator cannot remove their own access",
    );
  await c.tx
    .update(projectMembers)
    .set({ role })
    .where(
      and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)),
    );
  await advanceCursor(c);
}

export async function deleteProjectMember(
  c: Context,
  id: string,
  userId: string,
) {
  requireAdmin(c);
  await getProject(c, id, true);
  await requireMember(c, userId);
  if (userId === c.actor.userId)
    throw new DomainError(
      "conflict",
      "Project administrator cannot remove their own access",
    );
  await c.tx
    .delete(projectMembers)
    .where(
      and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)),
    );
  await advanceCursor(c);
}
