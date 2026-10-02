import { getAgent } from "@otto/agents";
import { DomainError, required } from "@otto/db";
import { getProject, getProjectAudience } from "@otto/projects";
import {
  advanceRevision,
  type Context,
  getWorkspaceAudience,
  requireHuman,
  requireMember,
  requireWriter,
} from "@otto/workspaces";
import { and, eq } from "drizzle-orm";
import { type CollectionField, collections, documents } from "./schema";
export async function createDocument(
  c: Context,
  input: {
    title: string;
    body: string;
    projectId?: string;
    access: "inherited" | "restricted";
    readerIds?: string[];
    skill?: boolean;
    whenToUse?: string;
  },
) {
  requireHuman(c);
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  for (const id of input.readerIds ?? []) await requireMember(c, id);
  const doc = required(
    (
      await c.tx
        .insert(documents)
        .values({
          ...input,
          workspaceId: c.workspaceId,
          ownerId: c.actor.userId,
        })
        .returning()
    )[0],
  );
  await advanceRevision(c);
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
  if (
    doc.access === "restricted" &&
    (c.actor.agentId !== undefined ||
      (doc.ownerId !== c.actor.userId &&
        !doc.readerIds.includes(c.actor.userId)))
  )
    throw new DomainError("forbidden");
  if (write) {
    requireHuman(c);
    requireWriter(c);
    if (doc.access === "restricted" && doc.ownerId !== c.actor.userId)
      throw new DomainError("forbidden");
  }
  return doc;
}
export async function saveDocument(
  c: Context,
  id: string,
  input: { title: string; body: string; editToken: number },
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== input.editToken)
    throw new DomainError("conflict", "Document changed");
  const updated = required(
    (
      await c.tx
        .update(documents)
        .set({ ...input, editToken: doc.editToken + 1 })
        .where(eq(documents.id, id))
        .returning()
    )[0],
  );
  await advanceRevision(c);
  return updated;
}
export async function snapshotSkills(
  c: Context,
  ids: string[],
  audience: { humans: string[]; agents: string[] },
) {
  const snapshots = [];
  for (const id of ids) {
    const doc = await getDocument(c, id);
    if (!doc.skill) throw new DomainError("invalid", "Not a skill");
    const available =
      doc.access === "restricted"
        ? [doc.ownerId, ...doc.readerIds]
        : doc.projectId
          ? await getProjectAudience(c, doc.projectId)
          : await getWorkspaceAudience(c);
    if (audience.humans.some((userId) => !available.includes(userId)))
      throw new DomainError("forbidden", "Skill audience mismatch");
    // Restricted skill material cannot be released to additional agents without explicit grants.
    if (doc.access === "restricted" && audience.agents.length > 1)
      throw new DomainError(
        "forbidden",
        "Restricted skill cannot enter a multi-agent audience",
      );
    snapshots.push({
      documentId: doc.id,
      title: doc.title,
      instructions: doc.body,
      whenToUse: doc.whenToUse,
      editToken: doc.editToken,
    });
  }
  return snapshots;
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
  await advanceRevision(c);
  return collection;
}
export async function putDocumentInCollection(
  c: Context,
  id: string,
  collectionId: string,
  properties: Record<string, string | number | boolean | null>,
  editToken: number,
) {
  const doc = await getDocument(c, id, true);
  if (doc.editToken !== editToken) throw new DomainError("conflict");
  const collection = required(
    (
      await c.tx
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.id, collectionId),
            eq(collections.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
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
  await advanceRevision(c);
  return updated;
}
