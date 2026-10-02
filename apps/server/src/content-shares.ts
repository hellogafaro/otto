import { isDeepStrictEqual } from "node:util";
import {
  type ArtifactStorage,
  previewArtifact,
  readArtifact,
} from "@otto/artifacts";
import { getConversation, previewConversation } from "@otto/conversations";
import type { Database } from "@otto/db";
import { getDocument } from "@otto/documents";
import { requireProjectMember } from "@otto/projects";
import {
  DomainError,
  getPage,
  type PageOptions,
  parsePageOptions,
  required,
} from "@otto/shared";

import {
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  contentShares,
  type ShareSelection,
  type ShareSnapshot,
} from "./content-schema";

async function selectContent(
  c: Context,
  selection: ShareSelection,
): Promise<ShareSnapshot> {
  requireHuman(c);
  requireWriter(c);
  if (selection.type === "document") {
    const doc = await getDocument(c, selection.targetId, true);
    if (
      selection.start < 0 ||
      selection.end <= selection.start ||
      selection.end > doc.body.length
    )
      throw new DomainError("invalid");
    return {
      type: "document",
      title: doc.title,
      body: doc.body.slice(selection.start, selection.end),
    };
  }
  if (selection.type === "conversation")
    return {
      type: "conversation",
      ...(await previewConversation(
        c,
        selection.targetId,
        selection.messageIds,
      )),
    };
  const artifact = await previewArtifact(c, selection.targetId);
  return {
    type: "artifact",
    title: artifact.title,
    artifactType: artifact.type,
    labels: artifact.labels,
    file: selection.includeFile
      ? {
          mediaType: artifact.mediaType,
          byteLength: artifact.byteLength,
          sha256: artifact.sha256,
        }
      : null,
  };
}
async function getOwnedShare(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const row = required(
    (
      await c.tx
        .select()
        .from(contentShares)
        .where(
          and(
            eq(contentShares.id, id),
            eq(contentShares.workspaceId, c.workspaceId),
          ),
        )
    )[0],
  );
  if (
    row.publisherId !== c.actor.userId &&
    c.role !== "owner" &&
    c.role !== "admin"
  )
    throw new DomainError("forbidden");
  return row;
}
export async function upsertShare(
  c: Context,
  selection: ShareSelection,
  existing?: { id: string; editToken: number },
) {
  const preview = await selectContent(c, selection);
  if (existing) {
    const row = await getOwnedShare(c, existing.id);
    if (row.publisherId !== c.actor.userId) throw new DomainError("forbidden");
    if (row.editToken !== existing.editToken) throw new DomainError("conflict");
    // Replacing the source record of a link is not a share update.
    if (
      row.selection.type !== selection.type ||
      row.selection.targetId !== selection.targetId
    )
      throw new DomainError("invalid");
    const saved = required(
      (
        await c.tx
          .update(contentShares)
          .set({ selection, preview, editToken: row.editToken + 1 })
          .where(eq(contentShares.id, row.id))
          .returning()
      )[0],
    );
    await advanceCursor(c);
    return { id: saved.id, preview: saved.preview, editToken: saved.editToken };
  }
  const saved = required(
    (
      await c.tx
        .insert(contentShares)
        .values({
          workspaceId: c.workspaceId,
          publisherId: c.actor.userId,
          selection,
          preview,
        })
        .returning()
    )[0],
  );
  await advanceCursor(c);
  return { id: saved.id, preview: saved.preview, editToken: saved.editToken };
}
export async function publishShare(c: Context, id: string, editToken: number) {
  const row = await getOwnedShare(c, id);
  if (row.publisherId !== c.actor.userId) throw new DomainError("forbidden");
  if (row.editToken !== editToken) throw new DomainError("conflict");
  // Current permissions and exact preview must still agree at the explicit publication action.
  const current = await selectContent(c, row.selection);
  if (!isDeepStrictEqual(current, row.preview))
    throw new DomainError("conflict", "Source changed since preview");
  await c.tx
    .update(contentShares)
    .set({
      snapshot: row.preview,
      editToken: row.editToken + 1,
    })
    .where(eq(contentShares.id, id));
  await advanceCursor(c);
  return { id, editToken: row.editToken + 1 };
}
export async function revokeShare(c: Context, id: string) {
  const row = await getOwnedShare(c, id);
  await c.tx
    .update(contentShares)
    .set({ snapshot: null, editToken: row.editToken + 1 })
    .where(eq(contentShares.id, id));
  await advanceCursor(c);
}
export async function getShares(c: Context, options: PageOptions = {}) {
  requireHuman(c);
  const { after, limit } = parsePageOptions(options);
  const items = await c.tx
    .select({
      id: contentShares.id,
      selection: contentShares.selection,
      published: sql<boolean>`${contentShares.snapshot} is not null`,
      editToken: contentShares.editToken,
    })
    .from(contentShares)
    .where(
      and(
        eq(contentShares.workspaceId, c.workspaceId),
        eq(contentShares.publisherId, c.actor.userId),
        after ? gt(contentShares.id, after) : undefined,
      ),
    )
    .orderBy(contentShares.id)
    .limit(limit + 1);
  return getPage(items, (row) => row.id, limit);
}
async function publicShare(db: Database, id: string) {
  const initial = required(
    (
      await db
        .select({
          workspaceId: contentShares.workspaceId,
          publisherId: contentShares.publisherId,
        })
        .from(contentShares)
        .where(eq(contentShares.id, id))
    )[0],
  );
  return inWorkspace(
    db,
    initial.workspaceId,
    { userId: initial.publisherId },
    async (c) => {
      const share = required(
        (
          await c.tx
            .select()
            .from(contentShares)
            .where(
              and(eq(contentShares.id, id), isNotNull(contentShares.snapshot)),
            )
        )[0],
      );
      requireWriter(c);
      // Source changes do not change frozen bytes; loss of the publisher's source access closes the gate.
      if (share.selection.type === "document") {
        const doc = await getDocument(c, share.selection.targetId);
        if (doc.projectId)
          await requireProjectMember(c, doc.projectId, c.actor.userId, true);
      } else if (share.selection.type === "conversation") {
        const conversation = await getConversation(
          c,
          share.selection.targetId,
          true,
        );
        if (conversation.projectId)
          await requireProjectMember(
            c,
            conversation.projectId,
            c.actor.userId,
            true,
          );
      } else await previewArtifact(c, share.selection.targetId);
      return share;
    },
    false,
  );
}
export async function getShare(db: Database, id: string) {
  try {
    return required((await publicShare(db, id)).snapshot ?? undefined);
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["forbidden", "not_found"].includes(error.code)
    )
      throw new DomainError("not_found");
    throw error;
  }
}
export async function readShareFile(
  db: Database,
  storage: ArtifactStorage,
  id: string,
) {
  try {
    const share = await publicShare(db, id);
    if (
      share.selection.type !== "artifact" ||
      share.snapshot?.type !== "artifact" ||
      !share.snapshot.file
    )
      throw new DomainError("not_found");
    const bytes = await readArtifact(
      db,
      storage,
      share.workspaceId,
      { userId: share.publisherId },
      share.selection.targetId,
    );
    const current = await publicShare(db, id);
    if (
      current.editToken !== share.editToken ||
      current.snapshot?.type !== "artifact" ||
      !current.snapshot.file
    )
      throw new DomainError("not_found");
    return bytes;
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["forbidden", "not_found"].includes(error.code)
    )
      throw new DomainError("not_found");
    throw error;
  }
}
