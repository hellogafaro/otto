import { cursorContext, parseSortInput } from "@otto/db";
import { DomainError, parsePageOptions, required } from "@otto/shared";
import type { Context } from "@otto/workspaces";
import type { LibraryCategory } from "./categories";
import { getCollection, getDocuments } from "./documents";
import { getFiles } from "./files";
import { FOLDER_SORTS, getFolder, getFolders } from "./folders";

const KINDS = ["folder", "file", "document"] as const;
type Kind = (typeof KINDS)[number];

// Keep the transport projection inferred from each domain, including its discriminator.
function folderItem(
  row: Awaited<ReturnType<typeof getFolders>>["items"][number],
) {
  return {
    type: "folder" as const,
    id: row.id,
    title: row.title,
    folderId: row.parentId,
    projectId: row.projectId,
    visibility: row.visibility,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerId: row.createdBy,
  };
}
function fileItem(row: Awaited<ReturnType<typeof getFiles>>["items"][number]) {
  return {
    type: "file" as const,
    id: row.id,
    title: row.title,
    folderId: row.folderId,
    projectId: row.projectId,
    visibility: row.visibility,
    archived: row.archived,
    labels: row.labels,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerId: row.ownerId,
    fileType: row.type,
    mediaType: row.mediaType,
    byteLength: row.byteLength,
  };
}
function documentItem(
  row: Awaited<ReturnType<typeof getDocuments>>["items"][number],
) {
  return {
    type: "document" as const,
    id: row.id,
    title: row.title,
    folderId: row.folderId,
    projectId: row.projectId,
    visibility: row.visibility,
    archived: row.archived,
    labels: row.labels,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownerId: row.createdBy,
    editToken: row.editToken,
    collectionId: row.collectionId,
  };
}
type LibraryItem =
  | ReturnType<typeof folderItem>
  | ReturnType<typeof fileItem>
  | ReturnType<typeof documentItem>;

/**
 * One bounded browse page over folders, then Files, then Documents. The cursor is `<kind>:<sealed continuation>`;
 * every continuation binds the category, filters and caller around its child keyset position.
 * `sort` orders within each kind, so the page stays grouped folders-first and is not a global "recent" list.
 * A `label` can only match Files and Documents, so it leaves Folders out.
 */
export async function getLibrary(
  c: Context,
  filter: {
    folderId?: string;
    projectId?: string;
    archived?: boolean;
    after?: string;
    limit?: number;
    sort?: string;
    order?: string;
    query?: string;
    label?: string;
    category?: LibraryCategory;
    createdBy?: string;
    visibility?: "user" | "workspace";
    collectionId?: string;
  },
) {
  const { limit } = parsePageOptions({ limit: filter.limit });
  parseSortInput(filter, FOLDER_SORTS);
  const category = filter.category ?? "all";
  const kinds: readonly Kind[] = KINDS.filter((phase) => {
    if (filter.collectionId)
      return (
        phase === "document" && (category === "all" || category === "documents")
      );
    if (phase === "folder") return !filter.label;
    return (
      phase !== "document" || category === "all" || category === "documents"
    );
  });
  const folder = filter.folderId ? await getFolder(c, filter.folderId) : null;
  if (folder && filter.projectId && filter.projectId !== folder.projectId)
    throw new DomainError("invalid", "Folder belongs to another Project");
  const projectId = folder ? folder.projectId : filter.projectId;
  const parent = filter.folderId ?? null;
  const archived = filter.archived ?? false;
  if (filter.collectionId) await getCollection(c, filter.collectionId);
  const scope = cursorContext(
    "getLibrary",
    c,
    {
      sort: filter.sort ?? "id",
      order: filter.order === "desc" ? "desc" : "asc",
    },
    {
      ...filter,
      category,
      folderId: parent,
      projectId,
      archived,
    },
  );
  let first = kinds[0];
  let last = "";
  if (filter.after) {
    const parts = filter.after.split(":");
    if (parts.length !== 2 || !parts[1])
      throw new DomainError("invalid", "Invalid page position");
    first = parts[0] as Kind;
    const [position, ...rest] = required(c.cursors, "unavailable").open(
      parts[1],
      `${scope}:${first}`,
    );
    if (typeof position !== "string" || rest.length)
      throw new DomainError("invalid", "Invalid page position");
    last = position;
  }
  if (!kinds.length) {
    if (filter.after) throw new DomainError("invalid", "Invalid page position");
    return { folder, items: [] as LibraryItem[], next: null };
  }
  const start = kinds.indexOf(first as Kind);
  if (start < 0) throw new DomainError("invalid", "Invalid page position");
  const continueAt = (phase: Kind, position: string) =>
    `${phase}:${required(c.cursors, "unavailable").seal([position], `${scope}:${phase}`)}`;
  const items: LibraryItem[] = [];
  let next: string | null = null;
  for (let index = start; index < kinds.length; index++) {
    const phase = kinds[index] as Kind;
    const page = {
      after: index === start && last ? last : undefined,
      limit: limit - items.length,
      archived,
      sort: filter.sort,
      order: filter.order,
      query: filter.query,
    };
    const result =
      phase === "folder"
        ? await getFolders(c, {
            ...page,
            parentId: parent,
            projectId,
            visibility: filter.visibility,
            createdBy: filter.createdBy,
          }).then((result) => ({
            ...result,
            items: result.items.map(folderItem),
          }))
        : phase === "file"
          ? await getFiles(c, {
              ...page,
              folderId: parent,
              projectId,
              category,
              ownerId: filter.createdBy,
              label: filter.label,
              visibility: filter.visibility,
            }).then((result) => ({
              ...result,
              items: result.items.map(fileItem),
            }))
          : await getDocuments(c, {
              ...page,
              folderId: parent,
              projectId,
              label: filter.label,
              visibility: filter.visibility,
              createdBy: filter.createdBy,
              collectionId: filter.collectionId,
            }).then((result) => ({
              ...result,
              items: result.items.map(documentItem),
            }));
    items.push(...result.items);
    if (result.next) {
      next = continueAt(phase, result.next);
      break;
    }
    // Capacity exhausted exactly at a kind boundary: continue with the next kind on the following page.
    if (items.length >= limit && index + 1 < kinds.length) {
      next = continueAt(kinds[index + 1] as Kind, "");
      break;
    }
  }
  return { folder, items, next };
}
