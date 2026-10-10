import { MAX_CURSOR_LENGTH } from "@otto/db";
import {
  archiveFolder,
  createFolder,
  FOLDER_SORTS,
  getDocumentFolderUse,
  getFolder,
  getFolders,
  getLibrary,
  LIBRARY_CATEGORIES,
  updateFolder,
} from "@otto/library";
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
          category: z.enum(LIBRARY_CATEGORIES).optional(),
          createdBy: z.string().min(1).max(128).optional(),
          visibility: visibility.optional(),
          collectionId: id.optional(),
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
