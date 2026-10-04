import { MAX_CURSOR_LENGTH } from "@otto/db";
import { getDocumentFolderUse, getDocuments } from "@otto/documents";
import {
  archiveFolder,
  createFolder,
  FOLDER_SORTS,
  getFiles,
  getFolder,
  getFolders,
  updateFolder,
} from "@otto/files";
import { DomainError } from "@otto/shared";
import type { Context } from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import {
  flag,
  id,
  listQuery,
  pageQuery,
  title,
  validate,
  visibility,
} from "./validation";

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
  };
}
type LibraryItem =
  | ReturnType<typeof folderItem>
  | ReturnType<typeof fileItem>
  | ReturnType<typeof documentItem>;

/**
 * One bounded browse page over folders, then Files, then Documents. The cursor is `<kind>:<child cursor>`
 * (empty = start of that kind); each kind is a keyset page from its owning domain, never a merged sort.
 * `sort` orders within each kind, so the page stays grouped folders-first and is not a global "recent" list.
 * A `label` can only match Files and Documents, so it leaves Folders out.
 */
async function getLibrary(
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
  },
) {
  const limit = filter.limit ?? 100;
  const kinds: readonly Kind[] = filter.label
    ? KINDS.filter((phase) => phase !== "folder")
    : KINDS;
  const [first = kinds[0], last = ""] = (filter.after ?? `${kinds[0]}:`).split(
    ":",
  );
  const start = kinds.indexOf(first as Kind);
  if (start < 0) throw new DomainError("invalid", "Invalid page position");
  const folder = filter.folderId ? await getFolder(c, filter.folderId) : null;
  if (folder && filter.projectId && filter.projectId !== folder.projectId)
    throw new DomainError("invalid", "Folder belongs to another Project");
  const projectId = folder ? folder.projectId : (filter.projectId ?? null);
  const parent = filter.folderId ?? null;
  const archived = filter.archived ?? false;
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
        ? await getFolders(c, { ...page, parentId: parent, projectId }).then(
            (result) => ({ ...result, items: result.items.map(folderItem) }),
          )
        : phase === "file"
          ? await getFiles(c, {
              ...page,
              folderId: parent,
              projectId,
              label: filter.label,
            }).then((result) => ({
              ...result,
              items: result.items.map(fileItem),
            }))
          : await getDocuments(c, {
              ...page,
              folderId: parent,
              projectId,
              label: filter.label,
            }).then((result) => ({
              ...result,
              items: result.items.map(documentItem),
            }));
    items.push(...result.items);
    if (result.next) {
      next = `${phase}:${result.next}`;
      break;
    }
    // Capacity exhausted exactly at a kind boundary: continue with the next kind on the following page.
    if (items.length >= limit && index + 1 < kinds.length) {
      next = `${kinds[index + 1]}:`;
      break;
    }
  }
  return { folder, items, next };
}

export const foldersApi = new Hono<ApiEnv>()
  .post(
    "/workspaces/:workspaceId/folders",
    validate(
      "json",
      z
        .object({
          title,
          parentId: id.optional(),
          projectId: id.optional(),
          visibility,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createFolder(ctx, c.req.valid("json"))),
      ),
  )
  .get(
    "/workspaces/:workspaceId/folders",
    validate(
      "query",
      listQuery(FOLDER_SORTS, {
        parentId: id.optional(),
        projectId: id.optional(),
        archived: flag,
        query: z.string().max(200).optional(),
        root: flag,
        visibility: visibility.optional(),
        createdBy: z.string().min(1).max(128).optional(),
      }),
    ),
    async (c) => {
      const { root, ...filter } = c.req.valid("query");
      return c.json(
        await transact(
          c,
          (ctx) =>
            getFolders(ctx, {
              ...filter,
              ...(root ? { parentId: null } : {}),
            }),
          false,
        ),
      );
    },
  )
  .get("/workspaces/:workspaceId/folders/:id", async (c) =>
    c.json(await transact(c, (ctx) => getFolder(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/folders/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          parentId: id.nullable().optional(),
          visibility: visibility.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateFolder(
            ctx,
            recordId(c),
            c.req.valid("json"),
            getDocumentFolderUse,
          ),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/folders/:id/archive",
    validate("json", z.object({ archived: z.boolean() }).strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveFolder(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            getDocumentFolderUse,
          ),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/library",
    validate(
      "query",
      pageQuery
        .extend({
          after: z
            .string()
            .max(MAX_CURSOR_LENGTH + 9)
            .regex(/^(folder|file|document):[A-Za-z0-9_-]*$/)
            .optional(),
          sort: z.enum(FOLDER_SORTS).optional(),
          order: z.enum(["asc", "desc"]).optional(),
          folderId: id.optional(),
          projectId: id.optional(),
          archived: flag,
          query: z.string().max(200).optional(),
          label: title.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getLibrary(ctx, c.req.valid("query")),
          false,
        ),
      ),
  );
