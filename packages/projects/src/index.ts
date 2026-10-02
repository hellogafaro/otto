import {
  DomainError,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  requireAdmin,
  requireMember,
} from "@otto/workspaces";
import { and, eq, gt, sql } from "drizzle-orm";
import { projectMembers, projects } from "./schema";
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

export async function getProjects(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    archived?: boolean;
    query?: string;
  } = {},
) {
  const { limit } = parsePageOptions(filter);
  const items = await c.tx
    .select({
      id: projects.id,
      title: projects.title,
      archived: projects.archived,
      repositoryUrl: projects.repositoryUrl,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, c.workspaceId),
        eq(projectMembers.userId, c.actor.userId),
        eq(projects.archived, filter.archived ?? false),
        filter.after ? gt(projects.id, filter.after) : undefined,
        filter.query
          ? sql`to_tsvector('simple', ${projects.title}) @@ plainto_tsquery('simple', ${filter.query})`
          : undefined,
      ),
    )
    .orderBy(projects.id)
    .limit(limit + 1);
  return getPage(items, (row) => row.id, limit);
}

export async function getProjectMembers(
  c: Context,
  id: string,
  options: PageOptions = {},
) {
  await getProject(c, id);
  const { after, limit } = parsePageOptions(options, "text");
  const rows = await c.tx
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, id),
        after ? gt(projectMembers.userId, after) : undefined,
      ),
    )
    .orderBy(projectMembers.userId)
    .limit(limit + 1);
  return getPage(rows, (row) => row.userId, limit);
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
