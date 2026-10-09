import {
  archiveCollection,
  archiveDocument,
  COLLECTION_SORTS,
  createCollection,
  createDocument,
  DOCUMENT_PROPOSAL_SORTS,
  DOCUMENT_SORTS,
  getCollection,
  getCollections,
  getDocument,
  getDocumentAudience,
  getDocumentProposals,
  getDocuments,
  proposeDocumentChange,
  resolveDocumentProposal,
  setDocumentAttachments,
  updateCollection,
  updateDocument,
  updateDocumentCollection,
} from "@otto/documents";
import {
  archiveFile,
  checkFileCreation,
  createFile,
  FILE_SORTS,
  type FileCreation,
  getFile,
  getFiles,
  locateFile,
  MAX_FILE_BYTES,
  requireFileAudience,
  requireFolderPlacement,
  updateFile,
} from "@otto/files";
import { DomainError } from "@otto/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  getShare,
  getShares,
  locateShareFile,
  publicFile,
  publishShare,
  readShareFile,
  revokeShare,
  upsertShare,
} from "./content-shares";
import { deliverFile } from "./file-delivery";
import { type ApiEnv, recordId, transact, workspaceId } from "./http";
import {
  admitTransfer,
  DEFAULT_TRANSFER,
  deadlineMs,
  idleMs,
  PayloadTooLarge,
  receiveToFile,
} from "./spool";
import {
  body,
  editToken,
  flag,
  id,
  labels,
  listQuery,
  pageQuery,
  title,
  validate,
  visibility,
} from "./validation";

const uploadQuery = z.object({
  requestId: id,
  title,
  type: title,
  mediaType: title,
  visibility: z.enum(["user", "workspace"]).optional(),
  projectId: id.optional(),
  folderId: id.optional(),
  labels: labels.optional(),
});
const field = z.object({
  id,
  title,
  type: z.enum([
    "text",
    "number",
    "date",
    "checkbox",
    "select",
    "human",
    "agent",
    "document",
  ]),
  options: z.array(title).max(100).optional(),
});
const archive = z.object({ archived: z.boolean(), editToken });
const search = z.string().max(200).optional();
const selection = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("document"),
    targetId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("chat"),
    targetId: id,
    messageIds: z.array(id).min(1).max(50),
  }),
  z.object({
    type: z.literal("file"),
    targetId: id,
    includeFile: z.boolean(),
  }),
]);

export const contentApi = new Hono<ApiEnv>()
  .post(
    "/workspaces/:workspaceId/documents",
    validate(
      "json",
      z
        .object({
          title,
          body,
          labels: labels.optional(),
          projectId: id.optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
          folderId: id.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const input = c.req.valid("json");
          await requireFolderPlacement(ctx, input.folderId, {
            projectId: input.projectId ?? null,
            visibility: input.visibility ?? "user",
            ownerId: ctx.actor.userId,
          });
          return createDocument(ctx, input);
        }),
      ),
  )
  .get("/workspaces/:workspaceId/documents/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getDocument(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .patch(
    "/workspaces/:workspaceId/documents/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          body: body.optional(),
          labels: labels.optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
          folderId: id.nullable().optional(),
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const input = c.req.valid("json");
          if (input.folderId !== undefined || input.visibility !== undefined) {
            // A move or widening must keep the destination folder's rules; the edit token still fences content.
            const current = await getDocument(ctx, recordId(c), true);
            const folderId =
              input.folderId === undefined ? current.folderId : input.folderId;
            const visibility = input.visibility ?? current.visibility;
            if (
              folderId !== current.folderId ||
              visibility !== current.visibility
            )
              await requireFolderPlacement(ctx, folderId, {
                projectId: current.projectId,
                visibility,
                ownerId: current.createdBy,
              });
          }
          const doc = await updateDocument(ctx, recordId(c), input);
          if (c.req.valid("json").visibility !== undefined) {
            const audience = await getDocumentAudience(ctx, doc.id);
            for (const fileId of doc.fileIds)
              await requireFileAudience(ctx, fileId, audience);
          }
          return doc;
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/collections",
    validate(
      "json",
      z.object({
        title,
        projectId: id.optional(),
        fields: z.array(field).max(50),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createCollection(ctx, c.req.valid("json"))),
      ),
  )
  .post(
    "/workspaces/:workspaceId/documents/:id/collection",
    validate(
      "json",
      z.object({
        collectionId: id,
        editToken,
        properties: z.record(
          z.string().max(128),
          z.union([
            z.string().max(5000),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
        ),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => {
          const input = c.req.valid("json");
          return updateDocumentCollection(
            ctx,
            id.parse(c.req.param("id")),
            input,
          );
        }),
      ),
  )
  .get("/workspaces/:workspaceId/files/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getFile(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .post(
    "/workspaces/:workspaceId/files",
    validate(
      "json",
      z.object({
        requestId: id,
        title,
        type: title,
        labels: labels.optional(),
        projectId: id.optional(),
        visibility: z.enum(["user", "workspace"]).optional(),
        mediaType: title,
        bytes: z.string().max(700000),
        sourceRunId: id.optional(),
        folderId: id.optional(),
      }),
    ),
    async (c) => {
      const options = c.get("options");
      if (!options.storage)
        throw new DomainError("unavailable", "Storage not configured");
      const { bytes, ...input } = c.req.valid("json");
      return c.json(
        await createFile(
          options.db,
          options.storage,
          id.parse(c.req.param("workspaceId")),
          { userId: c.get("userId") },
          input,
          Buffer.from(bytes, "base64"),
        ),
      );
    },
  )
  .put("/workspaces/:workspaceId/files/:requestId/content", async (c) => {
    try {
      const options = c.get("options");
      if (!options.storage || !options.spool)
        throw new DomainError("unavailable", "Storage not configured");
      const query = uploadQuery.parse({
        requestId: c.req.param("requestId"),
        title: c.req.query("title"),
        type: c.req.query("type"),
        mediaType: c.req.query("mediaType"),
        visibility: c.req.query("visibility"),
        projectId: c.req.query("projectId"),
        folderId: c.req.query("folderId"),
        labels: c.req.queries("label"),
      });
      const input: FileCreation = {
        requestId: query.requestId,
        title: query.title,
        type: query.type,
        mediaType: query.mediaType,
        ...(query.visibility ? { visibility: query.visibility } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.folderId ? { folderId: query.folderId } : {}),
        ...(query.labels?.length ? { labels: query.labels } : {}),
      };
      const header = c.req.header("content-length");
      const declared = header === undefined ? undefined : Number(header);
      if (
        declared !== undefined &&
        (!Number.isSafeInteger(declared) || declared < 0)
      )
        throw new DomainError("invalid");
      if (declared !== undefined && declared > MAX_FILE_BYTES)
        throw new HTTPException(413, {
          res: new Response(null, {
            status: 413,
            headers: { Connection: "close" },
          }),
        });
      const asserted = c.req.header("x-content-sha256")?.toLowerCase();
      if (asserted !== undefined && !/^[0-9a-f]{64}$/.test(asserted))
        throw new DomainError("invalid");
      const workspace = workspaceId(c);
      const actor = { userId: c.get("userId") };
      const transfer = options.transfer ?? DEFAULT_TRANSFER;
      // Authority, placement and the request identity are decided before any body byte is read or any disk is reserved.
      await checkFileCreation(options.db, workspace, actor, input, declared);
      const lease = options.spool.lease(declared ?? MAX_FILE_BYTES);
      // Only an admitted transfer may outlive Bun's idle timeout, and its connection is closed afterwards.
      admitTransfer(c);
      try {
        const path = lease.path();
        const received = await receiveToFile(c.req.raw.body, path, {
          maxBytes: MAX_FILE_BYTES,
          declaredBytes: declared,
          idleMs: idleMs(transfer),
          signal: AbortSignal.any([
            c.req.raw.signal,
            AbortSignal.timeout(
              deadlineMs(transfer, declared ?? MAX_FILE_BYTES),
            ),
          ]),
        }).catch((error: unknown) => {
          // Receiving ended early (size, deadline, stall, abort): the rest of the body is unread, so close the connection.
          c.header("Connection", "close");
          if (error instanceof PayloadTooLarge)
            throw new HTTPException(413, {
              res: new Response(null, {
                status: 413,
                headers: { Connection: "close" },
              }),
            });
          throw error;
        });
        if (asserted !== undefined && asserted !== received.sha256)
          throw new DomainError("invalid", "Content digest mismatch");
        return c.json(
          await createFile(
            options.db,
            options.storage,
            workspace,
            actor,
            input,
            {
              path,
              byteLength: received.byteLength,
              sha256: received.sha256,
            },
          ),
        );
      } finally {
        await lease.release();
      }
    } catch (error) {
      // Any failure may leave body bytes unread: do not keep the connection.
      c.header("Connection", "close");
      throw error;
    }
  })
  .get("/workspaces/:workspaceId/files/:id/file", async (c) => {
    const options = c.get("options");
    if (!options.storage || !options.spool)
      throw new DomainError("unavailable");
    const workspace = workspaceId(c);
    const actor = { userId: c.get("userId") };
    const fileId = recordId(c);
    const locate = () => locateFile(options.db, workspace, actor, fileId);
    const headers = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    };
    // HEAD is authorized metadata only: no storage read, spool or lease.
    if (c.req.method === "HEAD") {
      const located = await locate();
      return new Response(null, {
        headers: { ...headers, "X-File-Size": String(located.byteLength) },
      });
    }
    const delivery = await deliverFile({
      spool: options.spool,
      storage: options.storage,
      locate,
      signal: c.req.raw.signal,
      transfer: options.transfer ?? DEFAULT_TRANSFER,
      // Only an admitted delivery lifts the idle timeout, and its connection is closed afterwards.
      onAdmitted: () => admitTransfer(c),
    });
    return new Response(delivery.body, {
      headers: { ...headers, Connection: "close" },
    });
  })
  .post(
    "/workspaces/:workspaceId/documents/:id/proposals",
    validate("json", z.object({ title, body, editToken })),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          proposeDocumentChange(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/documents/:id/proposals",
    validate(
      "query",
      listQuery(DOCUMENT_PROPOSAL_SORTS, {
        proposerId: z.string().min(1).max(128).optional(),
        agentId: id.optional(),
        query: search,
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getDocumentProposals(ctx, recordId(c), c.req.valid("query")),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/documents/:id/proposals/:proposalId/resolve",
    validate("json", z.object({ accept: z.boolean() })),
    async (c) => {
      await transact(c, (ctx) =>
        resolveDocumentProposal(
          ctx,
          recordId(c),
          id.parse(c.req.param("proposalId")),
          c.req.valid("json").accept,
        ),
      );
      return c.json({ ok: true });
    },
  )
  .put(
    "/workspaces/:workspaceId/documents/:id/attachments",
    validate("json", z.object({ fileIds: z.array(id).max(30), editToken })),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const audience = await getDocumentAudience(ctx, recordId(c));
          for (const fileId of c.req.valid("json").fileIds)
            await requireFileAudience(ctx, fileId, audience);
          return setDocumentAttachments(
            ctx,
            recordId(c),
            c.req.valid("json").fileIds,
            c.req.valid("json").editToken,
          );
        }),
      ),
  )
  .get(
    "/workspaces/:workspaceId/documents",
    validate(
      "query",
      listQuery(DOCUMENT_SORTS, {
        projectId: id.optional(),
        archived: flag,
        query: search,
        collectionId: id.optional(),
        visibility: visibility.optional(),
        createdBy: z.string().min(1).max(128).optional(),
        label: title.optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getDocuments(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/documents/:id/archive",
    validate("json", archive),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveDocument(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            c.req.valid("json").editToken,
          ),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/collections",
    validate(
      "query",
      listQuery(COLLECTION_SORTS, {
        projectId: id.optional(),
        archived: flag,
        query: search,
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getCollections(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/collections/:id", async (c) =>
    c.json(await transact(c, (ctx) => getCollection(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/collections/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          fields: z.array(field).max(50).optional(),
          view: z.enum(["table", "list"]).optional(),
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateCollection(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/collections/:id/archive",
    validate("json", archive),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveCollection(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            c.req.valid("json").editToken,
          ),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/files",
    validate(
      "query",
      listQuery(FILE_SORTS, {
        projectId: id.optional(),
        archived: flag,
        query: search,
        type: title.optional(),
        label: title.optional(),
        ownerId: z.string().max(128).optional(),
        visibility: visibility.optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getFiles(ctx, c.req.valid("query")), false),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/files/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          labels: labels.optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
          folderId: id.nullable().optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateFile(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/files/:id/archive",
    validate("json", z.object({ archived: z.boolean() })),
    async (c) => {
      await transact(c, (ctx) =>
        archiveFile(ctx, recordId(c), c.req.valid("json").archived),
      );
      return c.json({ ok: true });
    },
  )
  .post(
    "/workspaces/:workspaceId/shares/preview",
    validate(
      "json",
      z.object({
        selection,
        existing: z.object({ id, editToken }).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          upsertShare(
            ctx,
            c.req.valid("json").selection,
            c.req.valid("json").existing,
          ),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/shares/:id/publish",
    validate("json", z.object({ editToken })),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          publishShare(ctx, recordId(c), c.req.valid("json").editToken),
        ),
      ),
  )
  .post("/workspaces/:workspaceId/shares/:id/revoke", async (c) => {
    await transact(c, (ctx) => revokeShare(ctx, recordId(c)));
    return c.json({ ok: true });
  })
  .get(
    "/workspaces/:workspaceId/shares",
    validate(
      "query",
      pageQuery
        .extend({
          published: flag,
          type: z.enum(["document", "chat", "file"]).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getShares(ctx, c.req.valid("query")), false),
      ),
  );

export const publicSharesApi = new Hono<ApiEnv>()
  .get("/shares/:id", async (c) => {
    const options = c.get("options");
    return c.json(await getShare(options.db, recordId(c)));
  })
  .get("/shares/:id/preview", async (c) => {
    const options = c.get("options");
    if (!options.storage) throw new DomainError("unavailable");
    const snapshot = await getShare(options.db, recordId(c));
    if (snapshot.type !== "file" || snapshot.file?.mediaType !== "text/html")
      throw new DomainError("not_found");
    const bytes = await readShareFile(options.db, options.storage, recordId(c));
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header(
      "Content-Security-Policy",
      "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    );
    return c.body(new Uint8Array(bytes));
  })
  .get("/shares/:id/file", async (c) => {
    const options = c.get("options");
    if (!options.storage || !options.spool)
      throw new DomainError("unavailable");
    const shareId = recordId(c);
    const locate = () => locateShareFile(options.db, shareId);
    const headers = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="shared-file"',
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    };
    // HEAD is authorized metadata only: no storage read, spool or lease.
    if (c.req.method === "HEAD") {
      const located = await locate();
      return new Response(null, {
        headers: { ...headers, "X-File-Size": String(located.byteLength) },
      });
    }
    const { spool, storage } = options;
    // A closed gate at any point (including a republished or revoked share during delivery setup) is a plain 404.
    const delivery = await publicFile(() =>
      deliverFile({
        spool,
        storage,
        locate,
        signal: c.req.raw.signal,
        transfer: options.transfer ?? DEFAULT_TRANSFER,
        onAdmitted: () => admitTransfer(c),
        // Anonymous readers may hold at most half of the shared disk budget, but never less than one maximum-size
        // File, so a share stays downloadable when the budget is configured at its minimum.
        ceiling: Math.max(Math.floor(spool.budgetBytes / 2), MAX_FILE_BYTES),
      }),
    );
    return new Response(delivery.body, {
      headers: { ...headers, Connection: "close" },
    });
  });
