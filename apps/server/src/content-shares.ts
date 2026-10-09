import { isDeepStrictEqual } from "node:util";
import { getChat, previewChat } from "@otto/chats";
import type { Database } from "@otto/db";
import { getDocument } from "@otto/documents";
import {
  type FileStorage,
  locateFile,
  previewFile,
  readFile,
} from "@otto/files";
import { requireProjectMember } from "@otto/projects";
import type { NativeSessionStorage } from "@otto/sessions/native";
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
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  contentShares,
  type ShareSelection,
  type ShareSnapshot,
  type StoredShareSelection,
  type StoredShareSnapshot,
} from "./content-schema";

async function selectContent(
  c: Context,
  selection: ShareSelection,
  native: NativeSessionStorage,
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
  if (selection.type === "chat")
    return {
      type: "chat",
      ...(await previewChat(
        c,
        selection.targetId,
        selection.messageIds,
        native,
      )),
    };
  const saved = await previewFile(c, selection.targetId);
  return {
    type: "file",
    title: saved.title,
    fileType: saved.type,
    labels: saved.labels,
    file: selection.includeFile
      ? {
          mediaType: saved.mediaType,
          byteLength: saved.byteLength,
          sha256: saved.sha256,
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
  return projectShare(row);
}
export async function upsertShare(
  c: Context,
  selection: ShareSelection,
  existing?: { id: string; editToken: number },
  native?: NativeSessionStorage,
) {
  const preview = await selectContent(
    c,
    selection,
    required(native, "unavailable"),
  );
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
    return {
      id: saved.id,
      preview: projectSnapshot(saved.preview),
      editToken: saved.editToken,
    };
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
  return {
    id: saved.id,
    preview: projectSnapshot(saved.preview),
    editToken: saved.editToken,
  };
}
export async function publishShare(
  c: Context,
  id: string,
  editToken: number,
  native: NativeSessionStorage,
) {
  const row = await getOwnedShare(c, id);
  if (row.publisherId !== c.actor.userId) throw new DomainError("forbidden");
  if (row.editToken !== editToken) throw new DomainError("conflict");
  // Current permissions and exact preview must still agree at the explicit publication action.
  const current = await selectContent(c, row.selection, native);
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
/** Stored selections written before the Chat and File renames keep their old discriminators. */
const SHARE_TYPES = {
  document: ["document"],
  chat: ["chat", "conversation"],
  file: ["file", "resource", "artifact"],
};
/** Publisher-only list of frozen selections: no title or time column exists, so it filters but keeps id order. */
export async function getShares(
  c: Context,
  options: PageOptions & {
    published?: boolean;
    type?: "document" | "chat" | "file";
  } = {},
) {
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
        options.published === undefined
          ? undefined
          : options.published
            ? isNotNull(contentShares.snapshot)
            : isNull(contentShares.snapshot),
        options.type
          ? inArray(
              sql`${contentShares.selection}->>'type'`,
              SHARE_TYPES[options.type],
            )
          : undefined,
        after ? gt(contentShares.id, after) : undefined,
      ),
    )
    .orderBy(contentShares.id)
    .limit(limit + 1);
  return getPage(
    items.map((row) => ({
      ...row,
      selection: projectSelection(row.selection),
    })),
    (row) => row.id,
    limit,
  );
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
      const selection = projectSelection(share.selection);
      if (selection.type === "document") {
        const doc = await getDocument(c, selection.targetId);
        if (doc.projectId)
          await requireProjectMember(c, doc.projectId, c.actor.userId, true);
      } else if (selection.type === "chat") {
        const chat = await getChat(c, selection.targetId, true);
        if (chat.projectId)
          await requireProjectMember(c, chat.projectId, c.actor.userId, true);
      } else await previewFile(c, selection.targetId);
      return projectShare(share);
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
/** Not-found for every closed or revoked gate, so a public caller learns nothing about the source. */
export async function publicFile<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["forbidden", "not_found"].includes(error.code)
    )
      throw new DomainError("not_found");
    throw error;
  }
}
/** Bounded in-memory read for the sandboxed HTML preview. */
export async function readShareFile(
  db: Database,
  storage: FileStorage,
  id: string,
) {
  return publicFile(async () => {
    const share = await publicShare(db, id);
    if (
      share.selection.type !== "file" ||
      share.snapshot?.type !== "file" ||
      !share.snapshot.file
    )
      throw new DomainError("not_found");
    const bytes = await readFile(
      db,
      storage,
      share.workspaceId,
      { userId: share.publisherId },
      share.selection.targetId,
    );
    const current = await publicShare(db, id);
    if (
      current.editToken !== share.editToken ||
      current.snapshot?.type !== "file" ||
      !current.snapshot.file
    )
      throw new DomainError("not_found");
    return bytes;
  });
}
/** Current publication and source authority for a streamed public download; called repeatedly. */
export async function locateShareFile(db: Database, id: string) {
  return publicFile(async () => {
    const share = await publicShare(db, id);
    if (
      share.selection.type !== "file" ||
      share.snapshot?.type !== "file" ||
      !share.snapshot.file
    )
      throw new DomainError("not_found");
    const located = await locateFile(
      db,
      share.workspaceId,
      { userId: share.publisherId },
      share.selection.targetId,
    );
    return { ...located, shareEditToken: share.editToken };
  });
}

function projectSelection(selection: StoredShareSelection): ShareSelection {
  if (selection.type === "artifact" || selection.type === "resource")
    return { ...selection, type: "file" };
  return selection.type === "conversation"
    ? { ...selection, type: "chat" }
    : selection;
}
function projectSnapshot(snapshot: StoredShareSnapshot): ShareSnapshot {
  if (snapshot.type === "conversation") return { ...snapshot, type: "chat" };
  if (snapshot.type === "resource") {
    const { resourceType, ...content } = snapshot;
    return { ...content, type: "file", fileType: resourceType };
  }
  if (snapshot.type === "artifact") {
    const { artifactType, ...content } = snapshot;
    return { ...content, type: "file", fileType: artifactType };
  }
  return snapshot;
}
function projectShare(row: typeof contentShares.$inferSelect) {
  return {
    ...row,
    selection: projectSelection(row.selection),
    preview: projectSnapshot(row.preview),
    snapshot: row.snapshot ? projectSnapshot(row.snapshot) : null,
  };
}
