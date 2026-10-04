import { getAgent } from "@otto/agents";
import {
  authorizedPage,
  matchesText,
  pageOf,
  sortNames,
  sortPlan,
  textKey,
  timeKey,
} from "@otto/db";
import {
  getProject,
  getProjectAudience,
  projectReadable,
} from "@otto/projects";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  advanceCursor,
  type Context,
  creatorIsMember,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, isNull, or, sql } from "drizzle-orm";
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
    labels?: string[];
    projectId?: string;
    visibility?: "user" | "workspace";
    /** Organization only; the route validates placement with the Files folder rules before calling. */
    folderId?: string;
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
          labels: input.labels,
          projectId: input.projectId,
          folderId: input.folderId,
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
    labels?: string[];
    visibility?: "user" | "workspace";
    /** Organization: a destination folder or `null` for the top level. */
    folderId?: string | null;
    editToken: number;
  },
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== input.editToken)
    throw new DomainError("conflict", "Document changed");
  if (
    input.title === undefined &&
    input.body === undefined &&
    input.labels === undefined &&
    input.visibility === undefined &&
    input.folderId === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({
          title: input.title,
          body: input.body,
          labels: input.labels,
          visibility: input.visibility,
          folderId: input.folderId,
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

const documentSorts = {
  title: textKey(documents.title),
  createdAt: timeKey(documents.createdAt),
  updatedAt: timeKey(documents.updatedAt),
};
export const DOCUMENT_SORTS = sortNames(documentSorts);
export async function getDocuments(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    /** `null` selects Documents without a Project; undefined does not filter. */
    projectId?: string | null;
    /** `null` selects top-level Documents; undefined does not filter. */
    folderId?: string | null;
    collectionId?: string;
    visibility?: "user" | "workspace";
    createdBy?: string;
    label?: string;
    archived?: boolean;
    query?: string;
  },
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getDocuments",
    scope: c,
    filter: f,
    keys: documentSorts,
    id: documents.id,
  });
  if (f.projectId) await getProject(c, f.projectId);
  if (f.collectionId) await getCollection(c, f.collectionId);
  const rows = await c.tx
    .select({ id: documents.id, position: plan.position })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, c.workspaceId),
        eq(documents.archived, f.archived),
        f.projectId === undefined
          ? undefined
          : f.projectId === null
            ? isNull(documents.projectId)
            : eq(documents.projectId, f.projectId),
        f.folderId === undefined
          ? undefined
          : f.folderId === null
            ? isNull(documents.folderId)
            : eq(documents.folderId, f.folderId),
        f.collectionId ? eq(documents.collectionId, f.collectionId) : undefined,
        f.visibility ? eq(documents.visibility, f.visibility) : undefined,
        f.createdBy ? eq(documents.createdBy, f.createdBy) : undefined,
        // Narrowing only: a row getDocument would deny is never scanned; getDocument stays the authority.
        or(
          eq(documents.visibility, "workspace"),
          c.actor.agentId === undefined
            ? eq(documents.createdBy, c.actor.userId)
            : undefined,
        ),
        projectReadable(c, documents.projectId),
        creatorIsMember(c, documents.createdBy),
        f.label
          ? sql`${documents.labels} @> ${JSON.stringify([f.label])}::jsonb`
          : undefined,
        f.query
          ? matchesText(
              sql`${documents.title} || ' ' || ${documents.body}`,
              f.query,
            )
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => {
      const doc = await getDocument(c, row.id);
      return {
        id: doc.id,
        title: doc.title,
        projectId: doc.projectId,
        folderId: doc.folderId,
        visibility: doc.visibility,
        labels: doc.labels,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        collectionId: doc.collectionId,
        archived: doc.archived,
        editToken: doc.editToken,
      };
    },
    plan,
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
const collectionSorts = {
  title: textKey(collections.title),
  createdAt: timeKey(collections.createdAt),
  updatedAt: timeKey(collections.updatedAt),
};
export const COLLECTION_SORTS = sortNames(collectionSorts);
export async function getCollections(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    projectId?: string;
    archived?: boolean;
    query?: string;
  },
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getCollections",
    scope: c,
    filter: f,
    keys: collectionSorts,
    id: collections.id,
  });
  const rows = await c.tx
    .select({ id: collections.id, position: plan.position })
    .from(collections)
    .where(
      and(
        eq(collections.workspaceId, c.workspaceId),
        eq(collections.archived, f.archived),
        f.projectId ? eq(collections.projectId, f.projectId) : undefined,
        f.query ? matchesText(collections.title, f.query) : undefined,
        projectReadable(c, collections.projectId),
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => {
      return getCollection(c, row.id);
    },
    plan,
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
  fileIds: string[],
  editToken: number,
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== editToken) throw new DomainError("conflict");
  if (fileIds.length > 30 || new Set(fileIds).size !== fileIds.length)
    throw new DomainError("invalid");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({ fileIds, editToken: doc.editToken + 1 })
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
const proposalSorts = { title: textKey(documentProposals.title) };
export const DOCUMENT_PROPOSAL_SORTS = sortNames(proposalSorts);
export async function getDocumentProposals(
  c: Context,
  id: string,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    proposerId?: string;
    agentId?: string;
    query?: string;
  } = {},
) {
  await getDocument(c, id);
  const plan = sortPlan({
    operation: `getDocumentProposals:${id}`,
    scope: c,
    filter,
    keys: proposalSorts,
    id: documentProposals.id,
  });
  const rows = await c.tx
    .select({
      id: documentProposals.id,
      documentId: documentProposals.documentId,
      proposerId: documentProposals.proposerId,
      agentId: documentProposals.agentId,
      title: documentProposals.title,
      body: documentProposals.body,
      editToken: documentProposals.editToken,
      position: plan.position,
    })
    .from(documentProposals)
    .where(
      and(
        eq(documentProposals.documentId, id),
        filter.proposerId
          ? eq(documentProposals.proposerId, filter.proposerId)
          : undefined,
        filter.agentId
          ? eq(documentProposals.agentId, filter.agentId)
          : undefined,
        filter.query
          ? matchesText(documentProposals.title, filter.query)
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return pageOf(rows, plan, (row) => row.id);
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
/** Counts Documents placed in a folder (any state, any visibility) for the folder emptiness and narrowing rules. */
export async function getDocumentFolderUse(
  c: Context,
  folderId: string,
  ownerId: string,
) {
  const rows = await c.tx
    .select({
      total: sql<number>`count(*)::int`,
      exposed: sql<number>`count(*) filter (where ${documents.visibility} <> 'user' or ${documents.createdBy} <> ${ownerId})::int`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, c.workspaceId),
        eq(documents.folderId, folderId),
      ),
    );
  return { total: rows[0]?.total ?? 0, exposed: rows[0]?.exposed ?? 0 };
}
