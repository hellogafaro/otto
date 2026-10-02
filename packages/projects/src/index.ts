import { DomainError, required } from "@otto/db";
import {
  advanceRevision,
  type Context,
  requireAdmin,
  requireHuman,
  requireMember,
} from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
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
    (write &&
      (membership.role === "viewer" || c.role === "viewer" || project.archived))
  )
    throw new DomainError("forbidden");
  return project;
}
export async function createProject(
  c: Context,
  input: { name: string; repositoryUrl?: string },
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
  await advanceRevision(c);
  return project;
}
export async function getProjects(c: Context) {
  return c.tx
    .select({
      id: projects.id,
      name: projects.name,
      archived: projects.archived,
      repositoryUrl: projects.repositoryUrl,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projects.workspaceId, c.workspaceId),
        eq(projectMembers.userId, c.actor.userId),
      ),
    )
    .limit(100);
}
export async function addProjectMember(
  c: Context,
  projectId: string,
  userId: string,
  role: "viewer" | "contributor",
) {
  requireAdmin(c);
  await getProject(c, projectId, true);
  await requireMember(c, userId);
  await c.tx
    .insert(projectMembers)
    .values({ projectId, userId, role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    });
  await advanceRevision(c);
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
  requireHuman(c);
  requireAdmin(c);
  await getProject(c, id);
  await c.tx.update(projects).set({ archived }).where(eq(projects.id, id));
  await advanceRevision(c);
}
