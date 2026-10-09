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
import {
  advanceCursor,
  type Context,
  creatorIsMember,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { MAX_FOLDER_DEPTH } from "./limits";
import { folders } from "./schema";

/** Counts Documents placed in a folder; the Documents package cannot be imported here, so routes inject it. */
export type DocumentFolderUse = (
  c: Context,
  folderId: string,
  ownerId: string,
) => Promise<{ total: number; exposed: number }>;
/** Organization attributes of the item being placed. `exposed` means visible beyond its custodian. */
export interface Placement {
  projectId: string | null;
  visibility: "user" | "workspace";
  ownerId: string;
}
type FolderRow = typeof folders.$inferSelect;

function view(row: FolderRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    createdBy: row.createdBy,
    title: row.title,
    visibility: row.visibility,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type Folder = ReturnType<typeof view>;

/**
 * Folders are human organization. `place` means the actor may put their own authorized items there,
 * `manage` means the folder creator may rename, move, narrow or archive it.
 */
async function loadFolder(
  c: Context,
  id: string,
  mode: "read" | "place" | "manage",
) {
  requireHuman(c);
  const row = required(
    (
      await c.tx
        .select()
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.workspaceId, c.workspaceId)))
    )[0],
  );
  if (row.projectId) await getProject(c, row.projectId, mode !== "read");
  await requireMember(c, row.createdBy);
  if (row.visibility === "user" && row.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  if (mode !== "read") requireWriter(c);
  if (mode === "manage" && row.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  return row;
}
export async function getFolder(c: Context, id: string) {
  const row = await loadFolder(c, id, "read");
  return { ...view(row), path: await getFolderPath(c, row) };
}
/** Root-to-folder chain limited to ancestors the actor can read, so a private name never leaks. */
async function getFolderPath(c: Context, row: FolderRow) {
  const chain = await c.tx.execute<{ id: string }>(sql`
    with recursive up as (
      select id, "parentId", 1 as depth from folders
        where id = ${row.id} and "workspaceId" = ${c.workspaceId}
      union all
      select f.id, f."parentId", up.depth + 1 from folders f join up on f.id = up."parentId"
        where f."workspaceId" = ${c.workspaceId} and up.depth <= ${MAX_FOLDER_DEPTH}
    ) select id from up order by depth desc`);
  const path: { id: string; title: string }[] = [];
  for (const { id } of chain.rows) {
    try {
      const ancestor = await loadFolder(c, id, "read");
      path.push({ id: ancestor.id, title: ancestor.title });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "forbidden")
        throw error;
    }
  }
  return path;
}
/** Placement keeps Project fixed and never lets a user folder hold anything but its creator's private items. */
export async function requireFolderPlacement(
  c: Context,
  folderId: string | null | undefined,
  item: Placement,
) {
  if (!folderId) return null;
  const folder = await loadFolder(c, folderId, "place");
  if (folder.archived) throw new DomainError("conflict", "Folder archived");
  if (folder.projectId !== item.projectId)
    throw new DomainError("conflict", "Folder scope mismatch");
  if (
    folder.visibility === "user" &&
    (item.visibility !== "user" || item.ownerId !== folder.createdBy)
  )
    throw new DomainError("forbidden", "Folder cannot hold this item");
  return folder;
}
async function requireNoCycleAndDepth(
  c: Context,
  folderId: string | null,
  parentId: string,
) {
  const ancestors = await c.tx.execute<{ id: string }>(sql`
    with recursive up as (
      select id, "parentId", 1 as depth from folders
        where id = ${parentId} and "workspaceId" = ${c.workspaceId}
      union all
      select f.id, f."parentId", up.depth + 1 from folders f join up on f.id = up."parentId"
        where f."workspaceId" = ${c.workspaceId} and up.depth <= ${MAX_FOLDER_DEPTH}
    ) select id from up`);
  if (folderId && ancestors.rows.some((row) => row.id === folderId))
    throw new DomainError("conflict", "A folder cannot contain itself");
  let height = 1;
  if (folderId) {
    const below = await c.tx.execute<{ height: number }>(sql`
      with recursive down as (
        select id, 1 as height from folders
          where id = ${folderId} and "workspaceId" = ${c.workspaceId}
        union all
        select f.id, down.height + 1 from folders f join down on f."parentId" = down.id
          where f."workspaceId" = ${c.workspaceId} and down.height <= ${MAX_FOLDER_DEPTH}
      ) select max(height)::int as height from down`);
    height = below.rows[0]?.height ?? 1;
  }
  if (ancestors.rows.length + height > MAX_FOLDER_DEPTH)
    throw new DomainError("conflict", "Folder nesting too deep");
}
export async function createFolder(
  c: Context,
  input: {
    title: string;
    parentId?: string;
    projectId?: string;
    visibility: "user" | "workspace";
  },
) {
  requireHuman(c);
  requireWriter(c);
  const parent = input.parentId
    ? await loadFolder(c, input.parentId, "place")
    : null;
  const projectId = input.projectId ?? parent?.projectId ?? null;
  if (projectId) await getProject(c, projectId, true);
  await requireFolderPlacement(c, input.parentId, {
    projectId,
    visibility: input.visibility,
    ownerId: c.actor.userId,
  });
  if (input.parentId) await requireNoCycleAndDepth(c, null, input.parentId);
  const row = required(
    (
      await c.tx
        .insert(folders)
        .values({
          workspaceId: c.workspaceId,
          projectId,
          parentId: input.parentId ?? null,
          createdBy: c.actor.userId,
          title: input.title,
          visibility: input.visibility,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return view(row);
}
/** Direct children of every kind, archived or not and visible or not, counted by the database. */
async function childUse(
  c: Context,
  folder: FolderRow,
  documentUse: DocumentFolderUse,
) {
  const counted = await c.tx.execute<{ total: number; exposed: number }>(sql`
    select count(*)::int as total,
      count(*) filter (where visibility <> 'user' or owner <> ${folder.createdBy})::int as exposed
    from (
      select visibility, "createdBy" as owner from folders
        where "workspaceId" = ${c.workspaceId} and "parentId" = ${folder.id}
      union all
      select visibility, "ownerId" as owner from files
        where "workspaceId" = ${c.workspaceId} and "folderId" = ${folder.id}
    ) children`);
  const documents = await documentUse(c, folder.id, folder.createdBy);
  return {
    total: (counted.rows[0]?.total ?? 0) + documents.total,
    exposed: (counted.rows[0]?.exposed ?? 0) + documents.exposed,
  };
}
export async function updateFolder(
  c: Context,
  id: string,
  input: {
    title?: string;
    parentId?: string | null;
    visibility?: "user" | "workspace";
  },
  documentUse: DocumentFolderUse,
) {
  const folder = await loadFolder(c, id, "manage");
  if (
    input.title === undefined &&
    input.parentId === undefined &&
    input.visibility === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  const parentId =
    input.parentId === undefined ? folder.parentId : input.parentId;
  const visibility = input.visibility ?? folder.visibility;
  if (parentId !== folder.parentId || visibility !== folder.visibility) {
    await requireFolderPlacement(c, parentId, {
      projectId: folder.projectId,
      visibility,
      ownerId: folder.createdBy,
    });
    if (parentId !== folder.parentId && parentId)
      await requireNoCycleAndDepth(c, folder.id, parentId);
    // Narrowing must not strand anyone else's items inside a private folder.
    if (visibility === "user" && folder.visibility !== "user") {
      const use = await childUse(c, folder, documentUse);
      if (use.exposed > 0)
        throw new DomainError("conflict", "Folder holds shared items");
    }
  }
  const row = required(
    (
      await c.tx
        .update(folders)
        .set({ title: input.title, parentId, visibility })
        .where(eq(folders.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return view(row);
}
/** Archive only truly empty folders; restoring needs a live parent. Nothing is cascaded or orphaned. */
export async function archiveFolder(
  c: Context,
  id: string,
  archived: boolean,
  documentUse: DocumentFolderUse,
) {
  const folder = await loadFolder(c, id, "manage");
  if (archived && !folder.archived) {
    const use = await childUse(c, folder, documentUse);
    if (use.total > 0) throw new DomainError("conflict", "Folder not empty");
  }
  if (!archived && folder.archived && folder.parentId) {
    const parent = required(
      (
        await c.tx
          .select({ archived: folders.archived })
          .from(folders)
          .where(eq(folders.id, folder.parentId))
      )[0],
    );
    if (parent.archived)
      throw new DomainError("conflict", "Parent folder archived");
  }
  const row = required(
    (
      await c.tx
        .update(folders)
        .set({ archived })
        .where(eq(folders.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return view(row);
}
const folderSorts = {
  title: textKey(folders.title),
  createdAt: timeKey(folders.createdAt),
  updatedAt: timeKey(folders.updatedAt),
};
export const FOLDER_SORTS = sortNames(folderSorts);
/** `parentId`/`projectId` of `null` select the top level / no Project; undefined does not filter. */
export async function getFolders(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    parentId?: string | null;
    projectId?: string | null;
    visibility?: "user" | "workspace";
    createdBy?: string;
    archived?: boolean;
    query?: string;
  },
) {
  requireHuman(c);
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getFolders",
    scope: c,
    filter: f,
    keys: folderSorts,
    id: folders.id,
  });
  if (f.projectId) await getProject(c, f.projectId);
  if (f.parentId) await loadFolder(c, f.parentId, "read");
  const rows = await c.tx
    .select({ id: folders.id, position: plan.position })
    .from(folders)
    .where(
      and(
        eq(folders.workspaceId, c.workspaceId),
        eq(folders.archived, f.archived),
        f.parentId === undefined
          ? undefined
          : f.parentId === null
            ? isNull(folders.parentId)
            : eq(folders.parentId, f.parentId),
        f.projectId === undefined
          ? undefined
          : f.projectId === null
            ? isNull(folders.projectId)
            : eq(folders.projectId, f.projectId),
        or(
          eq(folders.visibility, "workspace"),
          eq(folders.createdBy, c.actor.userId),
        ),
        projectReadable(c, folders.projectId),
        creatorIsMember(c, folders.createdBy),
        f.visibility ? eq(folders.visibility, f.visibility) : undefined,
        f.createdBy ? eq(folders.createdBy, f.createdBy) : undefined,
        f.query ? matchesText(folders.title, f.query) : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => view(await loadFolder(c, row.id, "read")),
    plan,
  );
}
