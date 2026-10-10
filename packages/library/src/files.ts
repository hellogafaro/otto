import { isDeepStrictEqual } from "node:util";
import { getChat, isAttachedToReadableChat } from "@otto/chats";
import {
  authorizedPage,
  type Database,
  intKey,
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
  requireProjectMember,
} from "@otto/projects";
import { getRun, getRunAudience, runAudienceHas } from "@otto/runs";
import { DomainError, type PageOptions, required } from "@otto/shared";

import {
  type Actor,
  advanceCursor,
  type Context,
  getWorkspaceAudience,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { LibraryCategory } from "./categories";
import { files } from "./file-schema";
import { requireFolderPlacement } from "./folders";
import { MAX_FILE_BYTES, SMALL_FILE_BYTES } from "./limits";
import type { FileSource, FileStorage } from "./storage";

export type { DocumentFolderUse, Folder } from "./folders";
export {
  archiveFolder,
  createFolder,
  FOLDER_SORTS,
  getFolder,
  getFolders,
  requireFolderPlacement,
  updateFolder,
} from "./folders";
export { MAX_FILE_BYTES, SMALL_FILE_BYTES } from "./limits";
export type { FileSource, FileStorage } from "./storage";
/** Complete bytes already verified by the trusted receiver: memory for small inputs, a private spool file otherwise. */
export type FileBody = Uint8Array | (FileSource & { sha256: string });
export type File = Awaited<ReturnType<typeof getFile>>;
export async function getFile(c: Context, id: string) {
  const row = required(
    (
      await c.tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, id),
            eq(files.workspaceId, c.workspaceId),
            eq(files.state, "saved"),
          ),
        )
    )[0],
  );
  if (row.projectId) await getProject(c, row.projectId);
  if (
    row.visibility === "user" &&
    (c.actor.agentId !== undefined || row.ownerId !== c.actor.userId) &&
    !(await isAttachedToReadableChat(c, row.id))
  )
    throw new DomainError("forbidden");
  if (row.sourceRunId) {
    const audience = await getRunAudience(c, row.sourceRunId);
    if (
      !audience.humans.includes(c.actor.userId) ||
      (c.actor.agentId !== undefined &&
        !audience.agents.includes(c.actor.agentId))
    )
      throw new DomainError(
        "forbidden",
        "Outside the saved source Run audience",
      );
  }
  return {
    id: row.id,
    projectId: row.projectId,
    folderId: row.folderId,
    creatorAgentId: row.creatorAgentId,
    ownerId: row.ownerId,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    title: row.title,
    type: row.type,
    labels: row.labels,
    mediaType: row.mediaType,
    byteLength: row.byteLength,
    sha256: row.sha256,
    archived: row.archived,
    sourceRunId: row.sourceRunId,
  };
}
export interface FileCreation {
  requestId: string;
  title: string;
  type: string;
  labels?: string[];
  projectId?: string;
  visibility?: "user" | "workspace";
  mediaType: string;
  sourceRunId?: string;
  /** First placement only: not part of the immutable upload identity, ignored on every retry. */
  folderId?: string;
}
type Authorize = (c: Context, sourceRunId: string) => Promise<void>;
/** The stored upload identity. Its bytes are part of the accepted request; never add organization fields. */
const requestOf = (input: FileCreation) => ({
  title: input.title,
  type: input.type,
  labels: input.labels ?? [],
  projectId: input.projectId ?? null,
  visibility: input.visibility ?? "user",
  mediaType: input.mediaType,
  sourceRunId: input.sourceRunId ?? null,
});
async function authorizeCreation(
  c: Context,
  input: FileCreation,
  authorizeRun?: Authorize,
) {
  requireWriter(c);
  if (input.projectId) await getProject(c, input.projectId, true);
  if (c.actor.agentId) {
    if (!input.sourceRunId || !authorizeRun || input.folderId)
      throw new DomainError("forbidden");
    const run = await getRun(c, input.sourceRunId);
    if (run.agentId !== c.actor.agentId || run.state !== "running")
      throw new DomainError("forbidden");
    await getChat(c, run.chatId, true);
    await authorizeRun(c, input.sourceRunId);
  }
  await requireSourceAudience(c, input);
}
async function findRequest(c: Context, input: FileCreation) {
  return (
    await c.tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.workspaceId, c.workspaceId),
          eq(files.ownerId, c.actor.userId),
          eq(files.requestId, input.requestId),
        ),
      )
  )[0];
}
function sameRequest(
  existing: typeof files.$inferSelect,
  input: FileCreation,
  actor: Actor,
) {
  return (
    existing.creatorAgentId === (actor.agentId ?? null) &&
    isDeepStrictEqual(existing.request, requestOf(input)) &&
    existing.mediaType === input.mediaType &&
    existing.sourceRunId === (input.sourceRunId ?? null) &&
    existing.projectId === (input.projectId ?? null)
  );
}
/**
 * Everything decidable before any body bytes are read: authority, placement and the request identity.
 * A saved retry reports its size so a mismatching body is refused before it is transferred.
 */
export async function checkFileCreation(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: FileCreation,
  declaredBytes?: number,
) {
  return inWorkspace(
    db,
    workspaceId,
    actor,
    async (c) => {
      await authorizeCreation(c, input);
      const existing = await findRequest(c, input);
      if (existing) {
        if (
          !sameRequest(existing, input, actor) ||
          (declaredBytes !== undefined && declaredBytes !== existing.byteLength)
        )
          throw new DomainError("conflict");
        return { state: existing.state, sha256: existing.sha256 };
      }
      await requireFolderPlacement(c, input.folderId, {
        projectId: input.projectId ?? null,
        visibility: input.visibility ?? "user",
        ownerId: actor.userId,
      });
      return null;
    },
    false,
  );
}
/** The saved File for an exactly verified retry; the caller has proven the digest matches. */
export async function getFileByRequest(
  db: Database,
  workspaceId: string,
  actor: Actor,
  input: FileCreation,
) {
  return inWorkspace(
    db,
    workspaceId,
    actor,
    async (c) => {
      const existing = required(await findRequest(c, input), "conflict");
      if (existing.state !== "saved" || !sameRequest(existing, input, actor))
        throw new DomainError("conflict");
      return getFile(c, existing.id);
    },
    false,
  );
}
/** Persist intent before I/O. Agent publication requires a trusted sponsor/attempt/launch/environment check in both transactions. */
export async function createFile(
  db: Database,
  storage: FileStorage,
  workspaceId: string,
  actor: Actor,
  input: FileCreation,
  body: FileBody,
  authorizeRun?: Authorize,
) {
  const bytes = body instanceof Uint8Array ? body : null;
  const source = body instanceof Uint8Array ? null : body;
  const byteLength = bytes ? bytes.length : (source?.byteLength ?? 0);
  if (byteLength > MAX_FILE_BYTES || (bytes && bytes.length > SMALL_FILE_BYTES))
    throw new DomainError("invalid", "File too large");
  const sha256 = bytes
    ? new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
    : (source?.sha256 ?? "");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new DomainError("invalid");
  const intent = await inWorkspace(db, workspaceId, actor, async (c) => {
    await authorizeCreation(c, input, authorizeRun);
    const existing = await findRequest(c, input);
    if (existing) {
      // The first placement wins: a retry never moves the File or resets later organization.
      if (
        existing.sha256 !== sha256 ||
        existing.byteLength !== byteLength ||
        !sameRequest(existing, input, actor)
      )
        throw new DomainError("conflict");
      return existing;
    }
    await requireFolderPlacement(c, input.folderId, {
      projectId: input.projectId ?? null,
      visibility: input.visibility ?? "user",
      ownerId: actor.userId,
    });
    return required(
      (
        await c.tx
          .insert(files)
          .values({
            ...input,
            visibility: input.visibility ?? "user",
            workspaceId,
            ownerId: actor.userId,
            creatorAgentId: actor.agentId,
            request: requestOf(input),
            objectKey: `${workspaceId}/${crypto.randomUUID()}/${sha256}`,
            sha256,
            byteLength,
          })
          .returning()
      )[0],
    );
  });
  if (intent.state !== "saved")
    await storage.put(
      intent.objectKey,
      bytes ?? { path: source?.path ?? "", byteLength },
      sha256,
    );
  return inWorkspace(db, workspaceId, actor, async (c) => {
    await authorizeCreation(c, input, authorizeRun);
    if (intent.state !== "saved")
      await c.tx
        .update(files)
        .set({ state: "saved" })
        .where(eq(files.id, intent.id));
    await advanceCursor(c);
    // Receipt uses immutable intent/input only: retries must not reveal later private metadata edits.
    if (actor.agentId)
      return {
        id: intent.id,
        ownerId: intent.ownerId,
        creatorAgentId: intent.creatorAgentId,
        sourceRunId: intent.sourceRunId,
        title: input.title,
        type: input.type,
        labels: input.labels ?? [],
        mediaType: intent.mediaType,
        byteLength: intent.byteLength,
        sha256: intent.sha256,
      };
    return getFile(c, intent.id);
  });
}
/** Current authority plus the stored object identity; callers verify bytes against it before disclosure. */
export async function locateFile(
  db: Database,
  workspaceId: string,
  actor: Actor,
  id: string,
) {
  return inWorkspace(
    db,
    workspaceId,
    actor,
    async (c) => {
      await getFile(c, id);
      const row = required(
        (
          await c.tx
            .select({
              objectKey: files.objectKey,
              sha256: files.sha256,
              byteLength: files.byteLength,
            })
            .from(files)
            .where(eq(files.id, id))
        )[0],
      );
      return row;
    },
    false,
  );
}
/** Bounded in-memory read for small consumers; downloads stream through the server's verified spool. */
export async function readFile(
  db: Database,
  storage: FileStorage,
  workspaceId: string,
  actor: Actor,
  id: string,
) {
  const located = await locateFile(db, workspaceId, actor, id);
  if (located.byteLength > SMALL_FILE_BYTES)
    throw new DomainError("invalid", "File too large for in-memory use");
  const bytes = await storage.get(located.objectKey);
  const file = await inWorkspace(
    db,
    workspaceId,
    actor,
    (c) => getFile(c, id),
    false,
  );
  if (
    bytes.length !== file.byteLength ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new DomainError(
      "conflict",
      "Stored bytes do not match the saved file",
    );
  return bytes;
}

async function requireSourceAudience(
  c: Context,
  input: {
    sourceRunId?: string;
    visibility?: "user" | "workspace";
    projectId?: string;
  },
) {
  if (!input.sourceRunId) return;
  const source = await getRunAudience(c, input.sourceRunId);
  if (c.actor.agentId && !source.agents.includes(c.actor.agentId))
    throw new DomainError("forbidden", "Outside the saved source Run audience");
  const destination =
    (input.visibility ?? "user") === "user"
      ? [c.actor.userId]
      : input.projectId
        ? await getProjectAudience(c, input.projectId)
        : await getWorkspaceAudience(c);
  if (destination.some((userId) => !source.humans.includes(userId)))
    throw new DomainError("forbidden", "File audience exceeds its source Run");
}
export async function archiveFile(c: Context, id: string, archived: boolean) {
  requireHuman(c);
  requireWriter(c);
  const row = await getFile(c, id);
  if (row.projectId) await getProject(c, row.projectId, true);
  if (row.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  await c.tx.update(files).set({ archived }).where(eq(files.id, id));
  await advanceCursor(c);
}

const fileSorts = {
  title: textKey(files.title),
  createdAt: timeKey(files.createdAt),
  updatedAt: timeKey(files.updatedAt),
  byteLength: intKey(files.byteLength),
};
export const FILE_SORTS = sortNames(fileSorts);
const DOCUMENT_MEDIA_TYPES = [
  "application/pdf",
  "application/msword",
  "application/rtf",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/yaml",
  "application/x-yaml",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
];
/** Access-filtered keyset pagination for the workspace library or one authorized Project. */
export async function getFiles(
  c: Context,
  filter: PageOptions & {
    sort?: string;
    order?: string;
    /** `null` selects Files without a Project; undefined does not filter. */
    projectId?: string | null;
    /** `null` selects top-level Files; undefined does not filter. */
    folderId?: string | null;
    type?: string;
    query?: string;
    ownerId?: string;
    visibility?: "user" | "workspace";
    label?: string;
    archived?: boolean;
    category?: LibraryCategory;
  },
) {
  const f = { ...filter, archived: filter.archived ?? false };
  const plan = sortPlan({
    operation: "getFiles",
    scope: c,
    filter: f,
    keys: fileSorts,
    id: files.id,
  });
  if (f.projectId) await getProject(c, f.projectId);
  const mediaType = sql`lower(trim(split_part(${files.mediaType}, ';', 1)))`;
  const documentType = sql`(${mediaType} like 'text/%' or ${mediaType} in (${sql.join(
    DOCUMENT_MEDIA_TYPES.map((type) => sql`${type}`),
    sql`, `,
  )}))`;
  const category =
    !f.category || f.category === "all"
      ? undefined
      : f.category === "documents"
        ? documentType
        : f.category === "other"
          ? sql`not (${documentType} or ${mediaType} like 'image/%' or ${mediaType} like 'video/%' or ${mediaType} like 'audio/%')`
          : sql`${mediaType} like ${f.category === "images" ? "image/%" : f.category === "video" ? "video/%" : "audio/%"}`;
  const rows = await c.tx
    .select({
      id: files.id,
      projectId: files.projectId,
      folderId: files.folderId,
      visibility: files.visibility,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      ownerId: files.ownerId,
      creatorAgentId: files.creatorAgentId,
      title: files.title,
      type: files.type,
      labels: files.labels,
      archived: files.archived,
      byteLength: files.byteLength,
      mediaType: files.mediaType,
      position: plan.position,
    })
    .from(files)
    .where(
      and(
        eq(files.workspaceId, c.workspaceId),
        eq(files.state, "saved"),
        eq(files.archived, f.archived),
        category,
        f.projectId === undefined
          ? undefined
          : f.projectId === null
            ? isNull(files.projectId)
            : eq(files.projectId, f.projectId),
        f.folderId === undefined
          ? undefined
          : f.folderId === null
            ? isNull(files.folderId)
            : eq(files.folderId, f.folderId),
        or(
          eq(files.visibility, "workspace"),
          c.actor.agentId === undefined
            ? eq(files.ownerId, c.actor.userId)
            : undefined,
        ),
        projectReadable(c, files.projectId),
        or(isNull(files.sourceRunId), runAudienceHas(c, files.sourceRunId)),
        f.visibility ? eq(files.visibility, f.visibility) : undefined,
        f.type ? eq(files.type, f.type) : undefined,
        f.ownerId ? eq(files.ownerId, f.ownerId) : undefined,
        f.query ? matchesText(files.title, f.query) : undefined,
        f.label
          ? sql`${files.labels} @> ${JSON.stringify([f.label])}::jsonb`
          : undefined,
        plan.where,
      ),
    )
    .orderBy(...plan.orderBy)
    .limit(plan.limit + 1);
  return authorizedPage(
    pageOf(rows, plan, (row) => row.id),
    async (row) => {
      await getFile(c, row.id);
      return row;
    },
    plan,
  );
}

/** A skill may refer only to immutable bytes readable by its entire effective audience. */
export async function getSkillFileReference(
  c: Context,
  id: string,
  projectId: string | null,
  humans: string[],
) {
  const file = await requireFileAudience(c, id, humans);
  if (file.projectId !== projectId || file.sourceRunId || file.archived)
    throw new DomainError("forbidden", "Skill file scope mismatch");
  return {
    fileId: id,
    sha256: file.sha256,
    byteLength: file.byteLength,
  };
}
export async function updateFile(
  c: Context,
  id: string,
  input: {
    title?: string;
    labels?: string[];
    visibility?: "user" | "workspace";
    /** Organization: a destination folder or `null` for the top level. */
    folderId?: string | null;
  },
) {
  requireHuman(c);
  requireWriter(c);
  const file = await getFile(c, id);
  if (file.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  if (file.projectId) await getProject(c, file.projectId, true);
  if (
    input.title === undefined &&
    input.labels === undefined &&
    input.visibility === undefined &&
    input.folderId === undefined
  )
    throw new DomainError("invalid", "No editable fields");
  const folderId =
    input.folderId === undefined ? file.folderId : input.folderId;
  const visibility = input.visibility ?? file.visibility;
  // Moving or widening must keep the folder's rules; placement never changes bytes, keys or source audience.
  if (folderId !== file.folderId || visibility !== file.visibility)
    await requireFolderPlacement(c, folderId, {
      projectId: file.projectId,
      visibility,
      ownerId: file.ownerId,
    });
  if (input.visibility !== undefined)
    await requireSourceAudience(c, {
      visibility: input.visibility,
      projectId: file.projectId ?? undefined,
      sourceRunId: file.sourceRunId ?? undefined,
    });
  await c.tx
    .update(files)
    .set({
      title: input.title,
      labels: input.labels,
      visibility: input.visibility,
      folderId,
    })
    .where(eq(files.id, id));
  await advanceCursor(c);
  return getFile(c, id);
}
/** Intentional public selection requires the human owner to pass current and saved source-Run access. */
export async function previewFile(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const metadata = await getFile(c, id);
  if (metadata.projectId)
    await requireProjectMember(c, metadata.projectId, c.actor.userId, true);
  if (metadata.ownerId !== c.actor.userId) throw new DomainError("forbidden");
  return {
    title: metadata.title,
    type: metadata.type,
    labels: metadata.labels,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
  };
}

/**
 * Everyone in `humans` may read the File. `inChat` is a Message attachment: the custodian's private File is
 * readable through the Chat, so only the Project and source-Run audiences still cap who can be in it.
 */
export async function requireFileAudience(
  c: Context,
  id: string,
  humans: string[],
  inChat = false,
) {
  const file = await getFile(c, id);
  const members = file.projectId
    ? await getProjectAudience(c, file.projectId)
    : await getWorkspaceAudience(c);
  const audience =
    file.visibility === "user" && !inChat
      ? members.filter((id) => id === file.ownerId)
      : members;
  if (humans.some((id) => !audience.includes(id)))
    throw new DomainError("forbidden", "Attachment audience mismatch");
  if (file.sourceRunId) {
    const source = await getRunAudience(c, file.sourceRunId);
    if (humans.some((id) => !source.humans.includes(id)))
      throw new DomainError("forbidden");
  }
  return file;
}
