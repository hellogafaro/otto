import {
  archiveArtifact,
  createArtifact,
  getArtifact,
  getArtifacts,
  readArtifact,
  requireArtifactAudience,
  updateArtifact,
} from "@otto/artifacts";
import {
  archiveCollection,
  archiveDocument,
  createCollection,
  createDocument,
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
import { DomainError } from "@otto/shared";
import { Hono } from "hono";
import { z } from "zod";
import {
  getShare,
  getShares,
  publishShare,
  readShareFile,
  revokeShare,
  upsertShare,
} from "./content-shares";
import { type ApiEnv, recordId, transact } from "./http";
import { body, editToken, id, pageQuery, title, validate } from "./validation";

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
const query = pageQuery.extend({
  projectId: id.optional(),
  archived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  query: z.string().max(200).optional(),
});
const selection = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("document"),
    targetId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("conversation"),
    targetId: id,
    messageIds: z.array(id).min(1).max(50),
  }),
  z.object({
    type: z.literal("artifact"),
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
          projectId: id.optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createDocument(ctx, c.req.valid("json"))),
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
          visibility: z.enum(["user", "workspace"]).optional(),
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const doc = await updateDocument(
            ctx,
            recordId(c),
            c.req.valid("json"),
          );
          if (c.req.valid("json").visibility !== undefined) {
            const audience = await getDocumentAudience(ctx, doc.id);
            for (const artifactId of doc.artifactIds)
              await requireArtifactAudience(ctx, artifactId, audience);
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
  .get("/workspaces/:workspaceId/artifacts/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getArtifact(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .post(
    "/workspaces/:workspaceId/artifacts",
    validate(
      "json",
      z.object({
        requestId: id,
        title,
        type: title,
        labels: z.array(title).max(20).optional(),
        projectId: id.optional(),
        visibility: z.enum(["user", "workspace"]).optional(),
        mediaType: title,
        bytes: z.string().max(700000),
        sourceRunId: id.optional(),
      }),
    ),
    async (c) => {
      const options = c.get("options");
      if (!options.storage)
        throw new DomainError("unavailable", "Storage not configured");
      const { bytes, ...input } = c.req.valid("json");
      return c.json(
        await createArtifact(
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
  .get("/workspaces/:workspaceId/artifacts/:id/file", async (c) => {
    const options = c.get("options");
    if (!options.storage) throw new DomainError("unavailable");
    const bytes = await readArtifact(
      options.db,
      options.storage,
      id.parse(c.req.param("workspaceId")),
      { userId: c.get("userId") },
      id.parse(c.req.param("id")),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
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
    validate("query", pageQuery),
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
    validate("json", z.object({ artifactIds: z.array(id).max(30), editToken })),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const audience = await getDocumentAudience(ctx, recordId(c));
          for (const artifactId of c.req.valid("json").artifactIds)
            await requireArtifactAudience(ctx, artifactId, audience);
          return setDocumentAttachments(
            ctx,
            recordId(c),
            c.req.valid("json").artifactIds,
            c.req.valid("json").editToken,
          );
        }),
      ),
  )
  .get(
    "/workspaces/:workspaceId/documents",
    validate(
      "query",
      query.extend({
        collectionId: id.optional(),
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
    validate("query", query),
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
    "/workspaces/:workspaceId/artifacts",
    validate(
      "query",
      query.extend({
        type: title.optional(),
        label: title.optional(),
        ownerId: z.string().max(128).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getArtifacts(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/artifacts/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          labels: z.array(title).max(30).optional(),
          visibility: z.enum(["user", "workspace"]).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateArtifact(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/artifacts/:id/archive",
    validate("json", z.object({ archived: z.boolean() })),
    async (c) => {
      await transact(c, (ctx) =>
        archiveArtifact(ctx, recordId(c), c.req.valid("json").archived),
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
    validate("query", pageQuery),
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
    if (
      snapshot.type !== "artifact" ||
      snapshot.file?.mediaType !== "text/html"
    )
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
    if (!options.storage) throw new DomainError("unavailable");
    const bytes = await readShareFile(options.db, options.storage, recordId(c));
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", 'attachment; filename="shared-file"');
    c.header("Content-Security-Policy", "sandbox; default-src 'none'");
    return c.body(new Uint8Array(bytes));
  });
