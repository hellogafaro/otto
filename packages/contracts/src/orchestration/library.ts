import * as Schema from "effect/Schema";

import {
  type AuthSessionId,
  Visibility,
  type BotId,
  CommandId,
  type GroupId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../base-schemas.ts";
import type { GroupMembership } from "./roster.ts";
import { WorkParticipant, workParticipantKey } from "./work.ts";

export const LibraryFolderId = TrimmedNonEmptyString.check(Schema.isMaxLength(100)).pipe(
  Schema.brand("LibraryFolderId"),
);

export type LibraryFolderId = typeof LibraryFolderId.Type;

export const LibraryFileId = TrimmedNonEmptyString.check(Schema.isMaxLength(100)).pipe(
  Schema.brand("LibraryFileId"),
);

export type LibraryFileId = typeof LibraryFileId.Type;

/** `user` is private to the creator; `organization` is everyone who can see its folder. */
export const LibraryVisibility = Visibility;

export type LibraryVisibility = typeof LibraryVisibility.Type;

/** Only `.md` files are documents; images and PDFs preview; everything else downloads. */
export const LibraryFileType = Schema.Literals(["document", "image", "pdf", "file"]);

export type LibraryFileType = typeof LibraryFileType.Type;

export const LibraryTitle = TrimmedNonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[^\n\r]*$/),
);

/** Lowercase, no dot; empty when the file had none. Never changes after creation. */
export const LibraryExtension = Schema.String.check(Schema.isPattern(/^[a-z0-9]{0,16}$/));

export const LIBRARY_FILE_MAX_BYTES = 100_000_000;

export const LIBRARY_DOCUMENT_MAX_BYTES = 5_000_000;

export const LIBRARY_MAX_FOLDER_DEPTH = 8;

/** The top-level folder holding one folder per chat. */
export const LIBRARY_CHATS_FOLDER_ID = LibraryFolderId.make("library-chats");

export const LIBRARY_CHATS_FOLDER_TITLE = "Chats";

/** The top-level folder holding one folder per project; a project's chats get theirs inside it. */
export const LIBRARY_PROJECTS_FOLDER_ID = LibraryFolderId.make("library-projects");

export const LIBRARY_PROJECTS_FOLDER_TITLE = "Projects";

/**
 * The top-level folder holding one folder per skill. A skill folder holds its `SKILL.md`
 * and any references, scripts or assets; scripts are read, never run.
 */
export const LIBRARY_SKILLS_FOLDER_ID = LibraryFolderId.make("library-skills");

/**
 * Skills every bot has, shipped with Otto, in the order bots see them. Their files live in
 * apps/server/src/skills/system; no Library skill can take one of these names.
 */
export const SYSTEM_SKILL_NAMES = [
  "research",
  "investigate",
  "implement",
  "git",
  "verify",
  "visualize",
  "write",
  "handoff",
  "summarize",
  "close",
  "computer",
] as const;

/** Built-in skills that need the bot's computer. */
export const COMPUTER_SYSTEM_SKILLS: ReadonlyArray<string> = ["git", "computer"];

export const LIBRARY_SKILLS_FOLDER_TITLE = "Skills";

/** The top-level folders Otto makes; they can't be renamed, moved or deleted. */
export const LIBRARY_SYSTEM_FOLDER_IDS: ReadonlySet<LibraryFolderId> = new Set([
  LIBRARY_CHATS_FOLDER_ID,
  LIBRARY_PROJECTS_FOLDER_ID,
  LIBRARY_SKILLS_FOLDER_ID,
]);

export const LibrarySizeBytes = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(LIBRARY_FILE_MAX_BYTES),
);

export const LibraryFolder = Schema.Struct({
  id: LibraryFolderId,
  parentId: Schema.NullOr(LibraryFolderId),
  /** Set only on a chat's own folder. */
  threadId: Schema.optional(ThreadId),
  /** Set only on a project's own folder. */
  projectId: Schema.optional(ProjectId),
  title: LibraryTitle,
  visibility: LibraryVisibility,
  createdBy: WorkParticipant,
  createdAt: IsoDateTime,
  updatedBy: WorkParticipant,
  updatedAt: IsoDateTime,
});

export type LibraryFolder = typeof LibraryFolder.Type;

export const LibraryFile = Schema.Struct({
  id: LibraryFileId,
  folderId: Schema.NullOr(LibraryFolderId),
  type: LibraryFileType,
  title: LibraryTitle,
  extension: LibraryExtension,
  sizeBytes: LibrarySizeBytes,
  visibility: LibraryVisibility,
  createdBy: WorkParticipant,
  createdAt: IsoDateTime,
  updatedBy: WorkParticipant,
  updatedAt: IsoDateTime,
});

export type LibraryFile = typeof LibraryFile.Type;

/** `by` is filled in by the server from the signed-in person; clients leave it out. */
export const LibraryFolderCreateCommand = Schema.Struct({
  type: Schema.Literal("library.folder.create"),
  commandId: CommandId,
  folderId: LibraryFolderId,
  parentId: Schema.NullOr(LibraryFolderId),
  threadId: Schema.optional(ThreadId),
  projectId: Schema.optional(ProjectId),
  title: LibraryTitle,
  visibility: Schema.optional(LibraryVisibility),
  by: Schema.optional(WorkParticipant),
  createdAt: IsoDateTime,
});

export const LibraryFolderUpdateCommand = Schema.Struct({
  type: Schema.Literal("library.folder.update"),
  commandId: CommandId,
  folderId: LibraryFolderId,
  parentId: Schema.optional(Schema.NullOr(LibraryFolderId)),
  title: Schema.optional(LibraryTitle),
  visibility: Schema.optional(LibraryVisibility),
  by: Schema.optional(WorkParticipant),
});

/** Only an empty folder can be deleted. */
export const LibraryFolderDeleteCommand = Schema.Struct({
  type: Schema.Literal("library.folder.delete"),
  commandId: CommandId,
  folderId: LibraryFolderId,
  by: Schema.optional(WorkParticipant),
});

/** Sent by the server once the bytes are stored, never by clients. */
export const LibraryFileCreateCommand = Schema.Struct({
  type: Schema.Literal("library.file.create"),
  commandId: CommandId,
  fileId: LibraryFileId,
  folderId: Schema.NullOr(LibraryFolderId),
  fileType: LibraryFileType,
  title: LibraryTitle,
  extension: LibraryExtension,
  sizeBytes: LibrarySizeBytes,
  visibility: LibraryVisibility,
  by: WorkParticipant,
  createdAt: IsoDateTime,
});

/**
 * Renames, moves or changes visibility. `sizeBytes` marks new document contents and is only
 * honored from the server, which checks `expectedUpdatedAt` against the file it saved over.
 */
export const LibraryFileUpdateCommand = Schema.Struct({
  type: Schema.Literal("library.file.update"),
  commandId: CommandId,
  fileId: LibraryFileId,
  folderId: Schema.optional(Schema.NullOr(LibraryFolderId)),
  title: Schema.optional(LibraryTitle),
  visibility: Schema.optional(LibraryVisibility),
  sizeBytes: Schema.optional(LibrarySizeBytes),
  expectedUpdatedAt: Schema.optional(IsoDateTime),
  by: Schema.optional(WorkParticipant),
});

export const LibraryFileDeleteCommand = Schema.Struct({
  type: Schema.Literal("library.file.delete"),
  commandId: CommandId,
  fileId: LibraryFileId,
  by: Schema.optional(WorkParticipant),
});

export const LibraryFolderPayload = Schema.Struct({ folder: LibraryFolder });

export const LibraryFolderDeletedPayload = Schema.Struct({ folderId: LibraryFolderId });

export const LibraryFilePayload = Schema.Struct({ file: LibraryFile });

export const LibraryFileDeletedPayload = Schema.Struct({ fileId: LibraryFileId });

/** A title is one trimmed line of at most 200 characters; nothing left becomes "Untitled". */
export function normalizeLibraryTitle(raw: string): string {
  const title = Array.from(
    raw
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 200)
    .join("")
    .trim();

  return title === "" ? "Untitled" : title;
}

/** Splits an upload's file name into its title and lowercase extension. */
export function splitLibraryFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";

  if (!/^[a-z0-9]{1,16}$/.test(extension)) {
    return { title: normalizeLibraryTitle(base), extension: "" };
  }

  return { title: normalizeLibraryTitle(base.slice(0, dot)), extension };
}

/** A new document is titled after its first `# heading`. */
export function libraryDocumentTitle(markdown: string): string {
  const heading = /^#[ \t]+(.+)$/m.exec(markdown);

  return normalizeLibraryTitle(heading?.[1]?.replace(/#+\s*$/, "") ?? "");
}

/** The name a download saves as; only here are characters a file system rejects replaced. */
export function libraryDownloadName(file: Pick<LibraryFile, "title" | "extension">): string {
  const base = file.title.replace(/[/\\:*?"<>|\p{Cc}]/gu, "-");

  if (file.extension === "" || base.toLowerCase().endsWith(`.${file.extension}`)) return base;

  return `${base}.${file.extension}`;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

const startsWith = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const SIGNATURES: ReadonlyArray<{
  readonly type: "image" | "pdf";
  readonly extensions: ReadonlyArray<string>;
  readonly matches: (head: Uint8Array) => boolean;
}> = [
  { type: "pdf", extensions: ["pdf"], matches: (head) => startsWith(head, ascii("%PDF-")) },
  {
    type: "image",
    extensions: ["png"],
    matches: (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    type: "image",
    extensions: ["jpg", "jpeg"],
    matches: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  },
  {
    type: "image",
    extensions: ["gif"],
    matches: (head) => startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a")),
  },
  {
    type: "image",
    extensions: ["webp"],
    matches: (head) => startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8),
  },
  {
    type: "image",
    extensions: ["avif"],
    matches: (head) => startsWith(head, ascii("ftypavif"), 4),
  },
];

/**
 * A file's type and extension, both fixed when it is created. Known image and PDF bytes win
 * and correct an extension that disagrees with them; otherwise the extension decides, only
 * `.md` is a document, and anything unknown is a plain file.
 */
export function libraryFileKind(input: { readonly extension: string; readonly head: Uint8Array }) {
  const signature = SIGNATURES.find((candidate) => candidate.matches(input.head));

  if (signature) {
    return {
      type: signature.type,
      extension: signature.extensions.includes(input.extension)
        ? input.extension
        : (signature.extensions[0] ?? input.extension),
    };
  }

  if (input.extension === "md") return { type: "document" as const, extension: "md" };

  if (input.extension === "pdf") return { type: "pdf" as const, extension: "pdf" };

  return {
    type: IMAGE_EXTENSIONS.has(input.extension) ? ("image" as const) : ("file" as const),
    extension: input.extension,
  };
}

const CONTENT_TYPES = new Map([
  ["md", "text/markdown; charset=utf-8"],
  ["txt", "text/plain; charset=utf-8"],
  ["csv", "text/csv; charset=utf-8"],
  ["json", "application/json"],
  ["html", "text/html; charset=utf-8"],
  ["htm", "text/html; charset=utf-8"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["zip", "application/zip"],
  ["mp3", "audio/mpeg"],
  ["mp4", "video/mp4"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

/** The content type served for a file, from a fixed extension list. */
export function libraryContentType(file: Pick<LibraryFile, "type" | "extension">): string {
  if (file.type === "pdf") return "application/pdf";

  return CONTENT_TYPES.get(file.extension) ?? "application/octet-stream";
}

/** Only images and PDFs display in the browser; everything else downloads. */
export function libraryFileDisplaysInline(file: Pick<LibraryFile, "type">): boolean {
  return file.type === "image" || file.type === "pdf";
}

type LibraryNode = Pick<LibraryFolder, "visibility" | "createdBy"> & {
  readonly threadId?: ThreadId | undefined;
};

export interface LibraryVisibilityContext {
  readonly folders: ReadonlyArray<LibraryFolder>;
  readonly threads: ReadonlyArray<
    DirectChatAccess & {
      readonly id: ThreadId;
      readonly groupId?: GroupId | null | undefined;
      readonly deletedAt?: string | null | undefined;
    }
  >;
  readonly groups: ReadonlyArray<{
    readonly id: GroupId;
    readonly members: ReadonlyArray<GroupMembership>;
  }>;
}

/** What decides who sees a chat that is not a group chat. */
export interface DirectChatAccess {
  readonly botId?: BotId | null | undefined;
  readonly createdBy?: AuthSessionId | null | undefined;
  readonly visibility?: Visibility | undefined;
}

/**
 * Otto: A DM is the organization's unless its creator made it `user`: then only they, and
 * its own bot, see it. A chat with no recorded creator stays the organization's.
 */
export function canSeeDirectChat(chat: DirectChatAccess, viewer: LibraryViewer): boolean {
  if (chat.visibility !== "user" || chat.createdBy == null) return true;

  return viewer.kind === "person"
    ? viewer.personId === chat.createdBy
    : viewer.botId === chat.botId;
}

export type LibraryViewer =
  | { readonly kind: "person"; readonly personId: AuthSessionId }
  | { readonly kind: "bot"; readonly botId: BotId };

const isViewer = (participant: WorkParticipant, viewer: LibraryViewer) =>
  participant.kind === "person"
    ? viewer.kind === "person" && participant.personId === viewer.personId
    : viewer.kind === "bot" && participant.botId === viewer.botId;

/**
 * A chat's folder follows the chat: the people who can see the chat, and bots in it. Once the
 * chat is gone only the folder's creator, the chat's creator, still sees it.
 */
function canSeeChatFolder(
  folder: LibraryNode & { readonly threadId: ThreadId },
  context: LibraryVisibilityContext,
  viewer: LibraryViewer,
): boolean {
  const thread = context.threads.find((candidate) => candidate.id === folder.threadId);

  if (thread === undefined || thread.deletedAt != null) return isViewer(folder.createdBy, viewer);

  if (thread.groupId == null) return canSeeDirectChat(thread, viewer);
  const group = context.groups.find((candidate) => candidate.id === thread.groupId);

  if (group === undefined) return isViewer(folder.createdBy, viewer);

  if (viewer.kind === "bot") {
    return group.members.some((member) => member.kind === "bot" && member.botId === viewer.botId);
  }

  const people = group.members.filter((member) => member.kind === "person");

  return people.length === 0 || people.some((person) => person.personId === viewer.personId);
}

function canSeeNode(node: LibraryNode, context: LibraryVisibilityContext, viewer: LibraryViewer) {
  if (node.visibility === "user" && !isViewer(node.createdBy, viewer)) return false;

  return node.threadId === undefined
    ? true
    : canSeeChatFolder({ ...node, threadId: node.threadId }, context, viewer);
}

/** The folders from `folderId` up to the top, nearest first. */
export function libraryFolderPath(
  folders: ReadonlyArray<LibraryFolder>,
  folderId: LibraryFolderId | null,
): ReadonlyArray<LibraryFolder> {
  const path: LibraryFolder[] = [];
  let current = folderId;

  while (current !== null && path.length <= LIBRARY_MAX_FOLDER_DEPTH) {
    const folder = folders.find((candidate) => candidate.id === current);

    if (folder === undefined) break;
    path.push(folder);
    current = folder.parentId;
  }

  return path;
}

/** An item is private if it or any folder above it is private to someone else. */
export function canSeeLibraryItem(
  item: LibraryFolder | LibraryFile,
  context: LibraryVisibilityContext,
  viewer: LibraryViewer,
): boolean {
  if (!canSeeNode(item, context, viewer)) return false;
  const parentId = "parentId" in item ? item.parentId : item.folderId;

  return libraryFolderPath(context.folders, parentId).every((folder) =>
    canSeeNode(folder, context, viewer),
  );
}

/** The chat folder an item sits in, if any. */
export function libraryChatFolder(
  folders: ReadonlyArray<LibraryFolder>,
  item: LibraryFolder | LibraryFile,
): LibraryFolder | undefined {
  if ("parentId" in item && item.threadId !== undefined) return item;
  const parentId = "parentId" in item ? item.parentId : item.folderId;

  return libraryFolderPath(folders, parentId).find((folder) => folder.threadId !== undefined);
}

/** The creator edits, moves and deletes; a bot's item in a chat is also the chat creator's. */
export function canEditLibraryItem(
  item: LibraryFolder | LibraryFile,
  folders: ReadonlyArray<LibraryFolder>,
  viewer: LibraryViewer,
): boolean {
  if (isViewer(item.createdBy, viewer)) return true;

  if (item.createdBy.kind !== "bot") return false;
  const chatFolder = libraryChatFolder(folders, item);

  return chatFolder !== undefined && isViewer(chatFolder.createdBy, viewer);
}

export const libraryViewerOf = (participant: WorkParticipant): LibraryViewer =>
  participant.kind === "person"
    ? { kind: "person", personId: participant.personId }
    : { kind: "bot", botId: participant.botId };

export const sameLibraryParticipant = (left: WorkParticipant, right: WorkParticipant) =>
  workParticipantKey(left) === workParticipantKey(right);

export const LIBRARY_UPLOAD_URL_TTL_MS = 10 * 60_000;

/** Where a new file goes: a folder (or the top), a chat's own folder, or a project's. */
const LibraryDestination = {
  folderId: Schema.NullOr(LibraryFolderId),
  threadId: Schema.optional(ThreadId),
  projectId: Schema.optional(ProjectId),
  visibility: Schema.optional(LibraryVisibility),
};

export const LibraryCreateUploadUrlInput = Schema.Struct({
  ...LibraryDestination,
  fileName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  sizeBytes: LibrarySizeBytes,
});

export type LibraryCreateUploadUrlInput = typeof LibraryCreateUploadUrlInput.Type;

export const LibraryCreateUploadUrlResult = Schema.Struct({
  fileId: LibraryFileId,
  relativeUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  expiresAt: Schema.Number,
});

export const LibraryCreateDocumentInput = Schema.Struct({
  ...LibraryDestination,
  title: Schema.optional(LibraryTitle),
});

export const LibraryCreateDocumentResult = Schema.Struct({ fileId: LibraryFileId });

export const SkillName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[^\n\r]*$/),
);

export const SkillDescription = TrimmedNonEmptyString.check(Schema.isMaxLength(1024));

/** A new skill folder in Skills with its `SKILL.md`: the given text, or a starter one. */
export const LibraryCreateSkillInput = Schema.Struct({
  name: SkillName,
  description: SkillDescription,
  visibility: LibraryVisibility,
  content: Schema.optional(Schema.String.check(Schema.isMaxLength(LIBRARY_DOCUMENT_MAX_BYTES))),
});

export type LibraryCreateSkillInput = typeof LibraryCreateSkillInput.Type;

export const LibraryCreateSkillResult = Schema.Struct({
  folderId: LibraryFolderId,
  fileId: LibraryFileId,
});

/** A skill's `SKILL.md` sits directly in its folder. */
export const isSkillFile = (file: Pick<LibraryFile, "title" | "extension">) =>
  file.extension === "md" && file.title.toUpperCase() === "SKILL";

export interface SkillFrontMatter {
  readonly name?: string;
  readonly description?: string;
}

/** A Markdown document's leading YAML front matter, without its `---` fences, and the rest. */
export function splitFrontMatter(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);

  if (!match) return { frontMatter: null, body: markdown };

  return {
    frontMatter: match[1] ?? "",
    body: markdown.slice(match[0].length).replace(/^\s*\n/, ""),
  };
}

/** `name` and `description` from a `SKILL.md`'s YAML front matter, when it has them. */
export function parseSkillFrontMatter(markdown: string): SkillFrontMatter {
  const block = splitFrontMatter(markdown).frontMatter;

  if (block === null) return {};

  const field = (key: string) => {
    const value = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(block)?.[1]?.trim();

    return value?.replace(/^(["'])(.*)\1$/, "$2").trim() || undefined;
  };

  const name = field("name");
  const description = field("description");

  return { ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

/** Where a bot proposed a skill: written into its SKILL.md metadata when a person approves it. */
export interface SkillProposal {
  readonly botId: string;
  readonly threadId: string;
}

/** A proposed skill's SKILL.md: Otto's own front matter, then the bot's instructions. */
export function proposedSkillMarkdown(input: {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly proposal: SkillProposal;
}) {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description.replace(/\s+/g, " ")}`,
    "metadata:",
    `  proposed-by: ${input.proposal.botId}`,
    `  proposed-in: ${input.proposal.threadId}`,
    "---",
    "",
    splitFrontMatter(input.instructions).body.trim(),
    "",
  ].join("\n");
}

/** The bot and chat that proposed a skill, from its SKILL.md metadata. */
export function skillProposal(markdown: string): SkillProposal | null {
  const block = splitFrontMatter(markdown).frontMatter ?? "";
  const botId = /^\s+proposed-by:[ \t]*(\S+)\s*$/m.exec(block)?.[1];
  const threadId = /^\s+proposed-in:[ \t]*(\S+)\s*$/m.exec(block)?.[1];

  return botId && threadId ? { botId, threadId } : null;
}

/** A starter `SKILL.md` for a new skill. */
export function skillTemplate(input: { readonly name: string; readonly description: string }) {
  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description.replace(/\s+/g, " ")}`,
    "---",
    "",
    `# ${input.name}`,
    "",
    "Write the steps a bot should follow when this skill applies.",
    "",
    "Put longer material in a `references` folder next to this file and mention it here, so the bot reads it only when needed.",
    "",
  ].join("\n");
}

export const LibraryFileInput = Schema.Struct({ fileId: LibraryFileId });

export const LibraryReadDocumentResult = Schema.Struct({
  content: Schema.String,
  updatedAt: IsoDateTime,
});

export const LibrarySaveDocumentInput = Schema.Struct({
  fileId: LibraryFileId,
  content: Schema.String.check(Schema.isMaxLength(LIBRARY_DOCUMENT_MAX_BYTES)),
  /** The `updatedAt` the editor opened; a newer save in between rejects this one. */
  expectedUpdatedAt: IsoDateTime,
});

export const LibrarySaveDocumentResult = Schema.Struct({ updatedAt: IsoDateTime });

export const LibraryCreateFileUrlInput = Schema.Struct({
  fileId: LibraryFileId,
  download: Schema.optional(Schema.Boolean),
});

export const LibraryCreateFileUrlResult = Schema.Struct({
  relativeUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  expiresAt: Schema.Number,
});

export class LibraryRequestError extends Schema.TaggedErrorClass<LibraryRequestError>()(
  "LibraryRequestError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
