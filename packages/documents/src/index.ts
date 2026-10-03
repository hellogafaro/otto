import { getAgent } from "@otto/agents";
import { getProject, getProjectAudience } from "@otto/projects";
import {
  DomainError,
  filterPage,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  type CollectionField,
  collections,
  documentProposals,
  documents,
} from "./schema";
export async function createDocument(
  c: Context,
  input: {
    title: string;
    body: string;
    projectId?: string;
    visibility?: "user" | "workspace";
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  const doc = required(
    (
      await c.tx
        .insert(documents)
        .values({
          title: input.title,
          body: input.body,
          projectId: input.projectId,
          visibility: input.visibility ?? "user",
          workspaceId: c.workspaceId,
          createdBy: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return doc;
}
export async function getDocument(c: Context, id: string, write = false) {
  const doc = required(
    (
      await c.tx
        .select()
        .from(documents)
        .where(
          and(eq(documents.id, id), eq(documents.workspaceId, c.workspaceId)),
        )
    )[0],
  );
  if (doc.projectId) await getProject(c, doc.projectId, write);
  await requireMember(c, doc.createdBy);
  if (doc.visibility === "user" && doc.createdBy !== c.actor.userId)
    throw new DomainError("forbidden");
  if (c.actor.agentId && doc.visibility === "user")
    throw new DomainError("forbidden");
  if (write) {
    requireHuman(c);
    requireWriter(c);
    if (doc.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  }
  return doc;
}
export async function updateDocument(
  c: Context,
  id: string,
  input: {
    title?: string;
    body?: string;
    visibility?: "user" | "workspace";
    editToken: number;
  },
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== input.editToken)
    throw new DomainError("conflict", "Document changed");
  if (
    input.title === undefined &&
    input.body === undefined &&
    input.visibility === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({
          title: input.title,
          body: input.body,
          visibility: input.visibility,
          editToken: doc.editToken + 1,
        })
        .where(eq(documents.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
/** Older JSON stores only the label under name; expose title without rewriting stored content. */
function collectionView(collection: typeof collections.$inferSelect) {
  return {
    ...collection,
    fields: collection.fields.map((field) => ({
      id: field.id,
      title: "title" in field ? field.title : field.name,
      type: field.type,
      ...(field.options ? { options: field.options } : {}),
    })),
  };
}
export async function createCollection(
  c: Context,
  input: { title: string; projectId?: string; fields: CollectionField[] },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  if (new Set(input.fields.map((f) => f.id)).size !== input.fields.length)
    throw new DomainError("invalid", "Field IDs must be unique");
  const collection = required(
    (
      await c.tx
        .insert(collections)
        .values({ ...input, workspaceId: c.workspaceId })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return collectionView(collection);
}
export async function updateDocumentCollection(
  c: Context,
  id: string,
  input: {
    collectionId: string;
    properties: Record<string, string | number | boolean | null>;
    editToken: number;
  },
) {
  const { collectionId, properties, editToken } = input;
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== editToken) throw new DomainError("conflict");
  const collection = await getCollection(c, collectionId);
  if (collection.archived)
    throw new DomainError("conflict", "Collection archived");
  if (collection.projectId !== doc.projectId)
    throw new DomainError("forbidden");
  for (const [id, value] of Object.entries(properties)) {
    const field = collection.fields.find((f) => f.id === id);
    if (!field) throw new DomainError("invalid");
    if (value === null) continue;
    if (
      (field.type === "number" && typeof value !== "number") ||
      (field.type === "checkbox" && typeof value !== "boolean") ||
      (["text", "date", "select", "human", "agent", "document"].includes(
        field.type,
      ) &&
        typeof value !== "string") ||
      (field.type === "select" && !field.options?.includes(String(value))) ||
      (field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
          !Number.isFinite(Date.parse(String(value))) ||
          new Date(String(value)).toISOString().slice(0, 10) !== value))
    )
      throw new DomainError("invalid", "Invalid field value");
    if (field.type === "human") await requireMember(c, String(value));
    if (field.type === "agent") await getAgent(c, String(value));
    if (field.type === "document") await getDocument(c, String(value));
  }
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({ collectionId, properties, editToken: doc.editToken + 1 })
        .where(eq(documents.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}

export async function getDocuments(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    projectId?: string;
    collectionId?: string;
    archived?: boolean;
    query?: string;
  },
) {
  const { limit } = parsePageOptions(filter);
  if (filter.projectId) await getProject(c, filter.projectId);
  if (filter.collectionId) await getCollection(c, filter.collectionId);
  const rows = await c.tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, c.workspaceId),
        eq(documents.archived, filter.archived ?? false),
        filter.projectId
          ? eq(documents.projectId, filter.projectId)
          : undefined,
        filter.collectionId
          ? eq(documents.collectionId, filter.collectionId)
          : undefined,
        filter.after ? gt(documents.id, filter.after) : undefined,
        filter.query
          ? sql`to_tsvector('simple', ${documents.title} || ' ' || ${documents.body}) @@ plainto_tsquery('simple', ${filter.query})`
          : undefined,
      ),
    )
    .orderBy(documents.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    async (row) => {
      const doc = await getDocument(c, row.id);
      return {
        id: doc.id,
        title: doc.title,
        projectId: doc.projectId,
        collectionId: doc.collectionId,
        archived: doc.archived,
        editToken: doc.editToken,
      };
    },
  );
}
export async function archiveDocument(
  c: Context,
  id: string,
  archived: boolean,
  editToken: number,
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== editToken) throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({ archived, editToken: doc.editToken + 1 })
        .where(eq(documents.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
export async function getCollection(c: Context, id: string, write = false) {
  const collection = required(
    (
      await c.tx
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.id, id),
            eq(collections.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  if (collection.projectId) await getProject(c, collection.projectId, write);
  if (write) {
    requireHuman(c);
    requireWriter(c);
  }
  return collectionView(collection);
}
export async function getCollections(
  c: Context,
  filter: {
    after?: string;
    limit?: number;
    projectId?: string;
    archived?: boolean;
  },
) {
  const { limit } = parsePageOptions(filter);
  const rows = await c.tx
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(
        eq(collections.workspaceId, c.workspaceId),
        eq(collections.archived, filter.archived ?? false),
        filter.projectId
          ? eq(collections.projectId, filter.projectId)
          : undefined,
        filter.after ? gt(collections.id, filter.after) : undefined,
      ),
    )
    .orderBy(collections.id)
    .limit(limit + 1);
  return filterPage(
    getPage(rows, (row) => row.id, limit),
    async (row) => {
      return getCollection(c, row.id);
    },
  );
}
/** Field IDs and types remain stable; changing a type would reinterpret current Document values. */
export async function updateCollection(
  c: Context,
  id: string,
  input: {
    title?: string;
    fields?: CollectionField[];
    view?: "table" | "list";
    editToken: number;
  },
) {
  const current = await getCollection(c, id, true);
  if (current.editToken !== input.editToken) throw new DomainError("conflict");
  if (
    input.title === undefined &&
    input.fields === undefined &&
    input.view === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  const fields = input.fields ?? current.fields;
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new DomainError("invalid");
  for (const field of current.fields) {
    const next = fields.find((f) => f.id === field.id);
    if (
      !next ||
      next.type !== field.type ||
      field.options?.some((option) => !next.options?.includes(option))
    )
      throw new DomainError(
        "conflict",
        "Existing fields and choices must remain compatible",
      );
  }
  const updated = required(
    (
      await c.tx
        .update(collections)
        .set({
          title: input.title,
          fields: input.fields,
          view: input.view,
          editToken: current.editToken + 1,
        })
        .where(eq(collections.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return collectionView(updated);
}
export async function archiveCollection(
  c: Context,
  id: string,
  archived: boolean,
  editToken: number,
) {
  const current = await getCollection(c, id, true);
  if (current.editToken !== editToken) throw new DomainError("conflict");
  const updated = required(
    (
      await c.tx
        .update(collections)
        .set({ archived, editToken: current.editToken + 1 })
        .where(eq(collections.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return collectionView(updated);
}
export async function setDocumentAttachments(
  c: Context,
  id: string,
  artifactIds: string[],
  editToken: number,
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== editToken) throw new DomainError("conflict");
  if (
    artifactIds.length > 30 ||
    new Set(artifactIds).size !== artifactIds.length
  )
    throw new DomainError("invalid");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({ artifactIds, editToken: doc.editToken + 1 })
        .where(eq(documents.id, id))
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return updated;
}
export async function getDocumentAudience(c: Context, id: string) {
  return documentAudience(c, await getDocument(c, id));
}
async function documentAudience(
  c: Context,
  doc: typeof documents.$inferSelect,
) {
  const members = doc.projectId
    ? await getProjectAudience(c, doc.projectId)
    : await getWorkspaceAudience(c);
  return doc.visibility === "user"
    ? members.filter((id) => id === doc.createdBy)
    : members;
}
/** Proposed content has no effect until an authorized human applies it to the unchanged source. */
export async function proposeDocumentChange(
  c: Context,
  id: string,
  input: { title: string; body: string; editToken: number },
) {
  requireWriter(c);
  const doc = await getDocument(c, id);
  if (doc.editToken !== input.editToken) throw new DomainError("conflict");
  if (
    !input.title.trim() ||
    input.title.length > 200 ||
    new TextEncoder().encode(input.body).length > 100000
  )
    throw new DomainError("invalid");
  if (c.actor.agentId) {
    const agent = await getAgent(c, c.actor.agentId);
    if (agent.projectId && agent.projectId !== doc.projectId)
      throw new DomainError("forbidden");
  }
  const current = await c.tx
    .select({ id: documentProposals.id })
    .from(documentProposals)
    .where(eq(documentProposals.documentId, id))
    .limit(100);
  if (current.length >= 100)
    throw new DomainError("conflict", "Proposal limit");
  const proposal = required(
    (
      await c.tx
        .insert(documentProposals)
        .values({
          ...input,
          documentId: id,
          proposerId: c.actor.userId,
          agentId: c.actor.agentId,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return proposal;
}
export async function getDocumentProposals(
  c: Context,
  id: string,
  options: PageOptions = {},
) {
  await getDocument(c, id);
  const { after, limit } = parsePageOptions(options);
  const rows = await c.tx
    .select()
    .from(documentProposals)
    .where(
      and(
        eq(documentProposals.documentId, id),
        after ? gt(documentProposals.id, after) : undefined,
      ),
    )
    .orderBy(documentProposals.id)
    .limit(limit + 1);
  return getPage(rows, (row) => row.id, limit);
}
export async function resolveDocumentProposal(
  c: Context,
  id: string,
  proposalId: string,
  accept: boolean,
) {
  requireHuman(c);
  await getDocument(c, id, true);
  const proposal = required(
    (
      await c.tx
        .select()
        .from(documentProposals)
        .where(
          and(
            eq(documentProposals.id, proposalId),
            eq(documentProposals.documentId, id),
          ),
        )
    )[0],
  );
  if (accept)
    await updateDocument(c, id, {
      title: proposal.title,
      body: proposal.body,
      editToken: proposal.editToken,
    });
  await c.tx
    .delete(documentProposals)
    .where(eq(documentProposals.id, proposalId));
  await advanceCursor(c);
}
