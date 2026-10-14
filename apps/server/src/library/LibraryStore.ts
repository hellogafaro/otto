import * as NodeCrypto from "node:crypto";

import {
  AuthSessionId,
  canEditLibraryItem,
  canSeeLibraryItem,
  CommandId,
  LIBRARY_CHATS_FOLDER_ID,
  LIBRARY_CHATS_FOLDER_TITLE,
  LIBRARY_DOCUMENT_MAX_BYTES,
  LIBRARY_FILE_MAX_BYTES,
  LIBRARY_PROJECTS_FOLDER_ID,
  LIBRARY_PROJECTS_FOLDER_TITLE,
  LIBRARY_SKILLS_FOLDER_ID,
  LIBRARY_SKILLS_FOLDER_TITLE,
  type LibraryCreateSkillInput,
  LIBRARY_UPLOAD_URL_TTL_MS,
  type LibraryCreateUploadUrlInput,
  type LibraryFile,
  LibraryFileId,
  libraryFileKind,
  type LibraryFolderId,
  LibraryFolderId as LibraryFolderIdSchema,
  LibraryRequestError,
  type LibraryViewer,
  type LibraryVisibility,
  normalizeLibraryTitle,
  type ProjectId,
  ProjectId as ProjectIdSchema,
  skillTemplate,
  splitLibraryFileName,
  type ThreadId,
  ThreadId as ThreadIdSchema,
  type WorkParticipant,
} from "@otto/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionGroupRepository } from "../persistence/Services/ProjectionGroups.ts";
import { ProjectionLibraryRepository } from "../persistence/Services/ProjectionLibrary.ts";
import { libraryDirectory, libraryFilePath } from "./libraryPaths.ts";

export const LIBRARY_UPLOAD_ROUTE_PREFIX = "/api/library/upload";

const SIGNING_SECRET_NAME = "asset-access-signing-key";

const fail = (detail: string) => Effect.fail(new LibraryRequestError({ detail }));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const newCommandId = () => CommandId.make(`library:${NodeCrypto.randomUUID()}`);

/** Everything a visibility check needs, read from the projections. */
export const loadLibraryState = Effect.gen(function* () {
  const library = yield* ProjectionLibraryRepository;
  const groups = yield* ProjectionGroupRepository;

  const [folders, files, chatThreads, groupRows] = yield* Effect.all([
    library.listFolders(),
    library.listFiles(),
    library.listChatThreads(),
    groups.listAll(),
  ]);

  return {
    folders,
    files,
    context: {
      folders,
      threads: chatThreads,
      groups: groupRows.map((group) => ({ id: group.groupId, members: group.members })),
    },
  };
}).pipe(Effect.mapError(() => new LibraryRequestError({ detail: "Could not read the Library." })));

export type LibraryState = Effect.Success<typeof loadLibraryState>;

export const viewerOf = (participant: WorkParticipant): LibraryViewer =>
  participant.kind === "person"
    ? { kind: "person", personId: participant.personId }
    : { kind: "bot", botId: participant.botId };

/** A file the viewer may see, or a not-found error that does not reveal private files. */
export const requireVisibleFile = Effect.fn("Library.requireVisibleFile")(function* (
  state: LibraryState,
  fileId: string,
  viewer: LibraryViewer,
) {
  const file = state.files.find((candidate) => candidate.id === fileId);

  if (file === undefined || !canSeeLibraryItem(file, state.context, viewer)) {
    return yield* fail("That Library file doesn't exist.");
  }

  return file;
});

const dispatchLibrary = (
  command: Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0],
) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;

    yield* engine.dispatch(command);
  }).pipe(
    Effect.mapError(
      (error) =>
        new LibraryRequestError({
          detail: Predicate.isTagged(error, "OrchestrationCommandInvariantError")
            ? error.detail
            : "The Library change wasn't saved.",
        }),
    ),
  );

/** Creates a top-level holder folder (Chats, Projects or Skills) unless it already exists. */
const ensureTopFolder = (
  folderId: LibraryFolderId,
  title: string,
  by: WorkParticipant,
  createdAt: string,
) =>
  Effect.gen(function* () {
    const folders = yield* (yield* ProjectionLibraryRepository)
      .listFolders()
      .pipe(Effect.orElseSucceed(() => []));

    if (folders.some((folder) => folder.id === folderId)) return;

    yield* dispatchLibrary({
      type: "library.folder.create",
      commandId: newCommandId(),
      folderId,
      parentId: null,
      title,
      by,
      createdAt,
    }).pipe(Effect.ignore);
  });

/**
 * A project's folder, made on first use under the top-level Projects folder and named after
 * the project. The workspace's own project, where chats go by default, has none.
 */
export const ensureProjectFolder = Effect.fn("Library.ensureProjectFolder")(function* (
  projectId: ProjectId,
  by: WorkParticipant,
) {
  const library = yield* ProjectionLibraryRepository;

  const findExisting = library.listFolders().pipe(
    Effect.map((folders) => folders.find((folder) => folder.projectId === projectId)),
    Effect.orElseSucceed(() => undefined),
  );

  const existing = yield* findExisting;

  if (existing !== undefined) return Option.some(existing.id);

  const snapshots = yield* ProjectionSnapshotQuery;
  const config = yield* ServerConfig.ServerConfig;

  const [project, home] = yield* Effect.all([
    snapshots.getProjectShellById(projectId),
    snapshots.getActiveProjectByWorkspaceRoot(config.cwd),
  ]).pipe(Effect.orElseSucceed(() => [Option.none(), Option.none()] as const));

  if (Option.isNone(project)) return yield* fail("That project doesn't exist.");

  if (Option.isSome(home) && home.value.id === projectId) return Option.none();

  const createdAt = yield* nowIso;
  yield* ensureTopFolder(LIBRARY_PROJECTS_FOLDER_ID, LIBRARY_PROJECTS_FOLDER_TITLE, by, createdAt);
  const folderId = LibraryFolderIdSchema.make(NodeCrypto.randomUUID());

  return yield* dispatchLibrary({
    type: "library.folder.create",
    commandId: newCommandId(),
    folderId,
    parentId: LIBRARY_PROJECTS_FOLDER_ID,
    projectId,
    title: normalizeLibraryTitle(project.value.title),
    by,
    createdAt,
  }).pipe(
    Effect.as(Option.some(folderId)),
    Effect.catch((error) =>
      findExisting.pipe(
        Effect.flatMap((raced) =>
          raced ? Effect.succeed(Option.some(raced.id)) : Effect.fail(error),
        ),
      ),
    ),
  );
});

/**
 * A chat's folder, made on first use and named after the chat: inside its project's folder,
 * or the top-level Chats folder for a chat in the workspace's own project. Its creator is the
 * chat's creator: a group's first person, or whoever saved first.
 */
export const ensureChatFolder = Effect.fn("Library.ensureChatFolder")(function* (
  threadId: ThreadId,
  by: WorkParticipant,
) {
  const library = yield* ProjectionLibraryRepository;

  const findExisting = library.listFolders().pipe(
    Effect.map((folders) => folders.find((folder) => folder.threadId === threadId)),
    Effect.orElseSucceed(() => undefined),
  );

  const existing = yield* findExisting;

  if (existing !== undefined) return existing.id;

  const snapshots = yield* ProjectionSnapshotQuery;

  const thread = yield* snapshots
    .getThreadShellById(threadId)
    .pipe(Effect.orElseSucceed(() => Option.none()));

  if (Option.isNone(thread)) return yield* fail("That chat doesn't exist.");

  const group =
    thread.value.groupId == null
      ? Option.none()
      : yield* (yield* ProjectionGroupRepository)
          .getById({ groupId: thread.value.groupId })
          .pipe(Effect.orElseSucceed(() => Option.none()));

  const groupCreator = Option.isSome(group)
    ? group.value.members.find((member) => member.kind === "person")
    : undefined;

  const creator: WorkParticipant =
    groupCreator?.kind === "person"
      ? { kind: "person", personId: groupCreator.personId, displayName: groupCreator.displayName }
      : by;

  const createdAt = yield* nowIso;
  const projectFolderId = yield* ensureProjectFolder(thread.value.projectId, creator);

  if (Option.isNone(projectFolderId)) {
    yield* ensureTopFolder(LIBRARY_CHATS_FOLDER_ID, LIBRARY_CHATS_FOLDER_TITLE, creator, createdAt);
  }

  const folderId = LibraryFolderIdSchema.make(NodeCrypto.randomUUID());

  const title = normalizeLibraryTitle(Option.isSome(group) ? group.value.name : thread.value.title);

  return yield* dispatchLibrary({
    type: "library.folder.create",
    commandId: newCommandId(),
    folderId,
    parentId: Option.getOrElse(projectFolderId, () => LIBRARY_CHATS_FOLDER_ID),
    threadId,
    title,
    by: creator,
    createdAt,
  }).pipe(
    Effect.as(folderId),
    Effect.catch((error) =>
      findExisting.pipe(
        Effect.flatMap((raced) => (raced ? Effect.succeed(raced.id) : Effect.fail(error))),
      ),
    ),
  );
});

/** A new skill: its folder in the top-level Skills folder, made on first use, and its SKILL.md. */
export const createSkill = Effect.fn("Library.createSkill")(function* (
  input: LibraryCreateSkillInput,
  by: WorkParticipant,
) {
  const createdAt = yield* nowIso;
  yield* ensureTopFolder(LIBRARY_SKILLS_FOLDER_ID, LIBRARY_SKILLS_FOLDER_TITLE, by, createdAt);
  const folderId = LibraryFolderIdSchema.make(NodeCrypto.randomUUID());

  yield* dispatchLibrary({
    type: "library.folder.create",
    commandId: newCommandId(),
    folderId,
    parentId: LIBRARY_SKILLS_FOLDER_ID,
    title: normalizeLibraryTitle(input.name),
    visibility: input.visibility,
    by,
    createdAt,
  });

  const fileId = yield* storeLibraryFile({
    bytes: new TextEncoder().encode(input.content ?? skillTemplate(input)),
    fileName: "SKILL.md",
    title: "SKILL",
    folderId,
    visibility: input.visibility,
    by,
  });

  return { folderId, fileId };
});

/** The folder a new file goes in: a chat's own folder, a project's, or the given folder. */
const resolveDestination = Effect.fn("Library.resolveDestination")(function* (
  input: {
    readonly folderId: LibraryFolderId | null;
    readonly threadId?: ThreadId | undefined;
    readonly projectId?: ProjectId | undefined;
  },
  by: WorkParticipant,
) {
  if (input.threadId !== undefined) return yield* ensureChatFolder(input.threadId, by);

  if (input.projectId === undefined) return input.folderId;

  return Option.getOrElse(yield* ensureProjectFolder(input.projectId, by), () => input.folderId);
});

/**
 * Stores new bytes and records the file. The bytes decide the type; the name gives the title
 * unless one is passed. Nothing is recorded if the bytes can't be written, and the bytes are
 * removed again if the Library refuses the file.
 */
export const storeLibraryFile = Effect.fn("Library.storeLibraryFile")(function* (input: {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly title?: string | undefined;
  readonly folderId: LibraryFolderId | null;
  readonly threadId?: ThreadId | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly visibility: LibraryVisibility;
  readonly by: WorkParticipant;
  readonly fileId?: LibraryFileId | undefined;
}) {
  const name = splitLibraryFileName(input.fileName);
  const nameTitle = name.title;

  const { type, extension } = libraryFileKind({
    extension: name.extension,
    head: input.bytes.subarray(0, 16),
  });

  if (input.bytes.byteLength > LIBRARY_FILE_MAX_BYTES) {
    return yield* fail("Files can be at most 100 MB.");
  }

  if (input.bytes.byteLength === 0 && type !== "document") {
    return yield* fail("That file is empty.");
  }

  const folderId = yield* resolveDestination(input, input.by);
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileId = input.fileId ?? LibraryFileId.make(NodeCrypto.randomUUID());
  const finalPath = libraryFilePath(path, config.attachmentsDir, fileId);

  if (finalPath === null) return yield* fail("That Library file id isn't valid.");

  const partPath = `${finalPath}.${NodeCrypto.randomUUID()}.part`;

  yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(libraryDirectory(path, config.attachmentsDir), {
      recursive: true,
    });
    yield* fileSystem.writeFile(partPath, input.bytes);
    yield* fileSystem.rename(partPath, finalPath);
  }).pipe(
    Effect.catch((cause) =>
      fileSystem
        .remove(partPath, { force: true })
        .pipe(
          Effect.ignore,
          Effect.andThen(Effect.logError("Failed to store a Library file.", { fileId, cause })),
          Effect.andThen(fail("The file couldn't be saved.")),
        ),
    ),
  );

  yield* dispatchLibrary({
    type: "library.file.create",
    commandId: newCommandId(),
    fileId,
    folderId,
    fileType: type,
    title: input.title === undefined ? nameTitle : normalizeLibraryTitle(input.title),
    extension,
    sizeBytes: input.bytes.byteLength,
    visibility: input.visibility,
    by: input.by,
    createdAt: yield* nowIso,
  }).pipe(Effect.tapError(() => fileSystem.remove(finalPath, { force: true }).pipe(Effect.ignore)));

  return fileId;
});

/** A document's text, at most the document size limit. */
export const readLibraryDocument = Effect.fn("Library.readLibraryDocument")(function* (
  file: LibraryFile,
) {
  if (file.type !== "document") return yield* fail("Only documents can be read as text.");

  if (file.sizeBytes > LIBRARY_DOCUMENT_MAX_BYTES) return yield* fail("That document is too big.");

  return yield* readLibraryBytes(file).pipe(Effect.map((bytes) => new TextDecoder().decode(bytes)));
});

/** A file's bytes; callers bound the size first. */
export const readLibraryBytes = Effect.fn("Library.readLibraryBytes")(function* (
  file: LibraryFile,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = libraryFilePath(path, config.attachmentsDir, file.id);

  if (filePath === null) return yield* fail("That Library file is missing.");

  return yield* fileSystem
    .readFile(filePath)
    .pipe(
      Effect.mapError(() => new LibraryRequestError({ detail: "That Library file is missing." })),
    );
});

/**
 * Saves new document text over the old. The save names the version it edited, so a save made
 * on top of someone else's newer one is rejected rather than overwriting it.
 */
export const saveLibraryDocument = Effect.fn("Library.saveLibraryDocument")(function* (input: {
  readonly fileId: string;
  readonly content: string;
  readonly expectedUpdatedAt: string;
  readonly by: WorkParticipant;
}) {
  const state = yield* loadLibraryState;
  const file = yield* requireVisibleFile(state, input.fileId, viewerOf(input.by));

  if (file.type !== "document") return yield* fail("Only documents can be edited.");

  if (!canEditLibraryItem(file, state.folders, viewerOf(input.by))) {
    return yield* fail("Only the document's creator can edit it.");
  }

  const bytes = new TextEncoder().encode(input.content);

  if (bytes.byteLength > LIBRARY_DOCUMENT_MAX_BYTES)
    return yield* fail("That document is too big.");

  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const finalPath = libraryFilePath(path, config.attachmentsDir, file.id);

  if (finalPath === null) return yield* fail("That Library file is missing.");

  const partPath = `${finalPath}.${NodeCrypto.randomUUID()}.part`;

  yield* fileSystem
    .writeFile(partPath, bytes)
    .pipe(
      Effect.mapError(() => new LibraryRequestError({ detail: "The document couldn't be saved." })),
    );

  yield* dispatchLibrary({
    type: "library.file.update",
    commandId: newCommandId(),
    fileId: file.id,
    sizeBytes: bytes.byteLength,
    expectedUpdatedAt: input.expectedUpdatedAt,
    by: input.by,
  }).pipe(Effect.tapError(() => fileSystem.remove(partPath, { force: true }).pipe(Effect.ignore)));

  yield* fileSystem
    .rename(partPath, finalPath)
    .pipe(
      Effect.mapError(() => new LibraryRequestError({ detail: "The document couldn't be saved." })),
    );

  const saved = yield* loadLibraryState.pipe(
    Effect.map((next) => next.files.find((candidate) => candidate.id === file.id)),
  );

  return { updatedAt: saved?.updatedAt ?? file.updatedAt };
});

const LibraryUploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("library-upload"),
  fileId: Schema.String,
  fileName: Schema.String,
  sizeBytes: Schema.Number,
  folderId: Schema.NullOr(Schema.String),
  threadId: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  visibility: Schema.Literals(["user", "workspace"]),
  personId: Schema.String,
  displayName: Schema.String,
  expiresAt: Schema.Number,
});

type LibraryUploadClaims = typeof LibraryUploadClaims.Type;

const LibraryUploadClaimsJson = Schema.fromJsonString(LibraryUploadClaims);

const encodeUploadClaims = Schema.encodeSync(LibraryUploadClaimsJson);

const decodeUploadClaims = Schema.decodeUnknownOption(LibraryUploadClaimsJson);

const loadSigningSecret = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore.ServerSecretStore;

  return yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
});

/**
 * A short-lived signed URL the browser posts the bytes to. The person, folder and size are
 * fixed in the token, so the upload itself needs no other credentials.
 */
export const issueLibraryUploadUrl = Effect.fn("Library.issueUploadUrl")(function* (
  input: LibraryCreateUploadUrlInput,
  person: { readonly personId: AuthSessionId; readonly displayName: string },
) {
  if (input.folderId !== null) {
    const state = yield* loadLibraryState;
    const folder = state.folders.find((candidate) => candidate.id === input.folderId);

    if (
      folder === undefined ||
      !canSeeLibraryItem(folder, state.context, { kind: "person", personId: person.personId })
    ) {
      return yield* fail("That folder doesn't exist.");
    }
  }

  const secret = yield* loadSigningSecret.pipe(
    Effect.mapError(() => new LibraryRequestError({ detail: "Uploads are unavailable." })),
  );

  const fileId = LibraryFileId.make(NodeCrypto.randomUUID());
  const expiresAt = (yield* Clock.currentTimeMillis) + LIBRARY_UPLOAD_URL_TTL_MS;

  const payload = base64UrlEncode(
    encodeUploadClaims({
      version: 1,
      kind: "library-upload",
      fileId,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      folderId: input.folderId,
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      visibility: input.visibility ?? "workspace",
      personId: person.personId,
      displayName: person.displayName,
      expiresAt,
    }),
  );

  return {
    fileId,
    relativeUrl: `${LIBRARY_UPLOAD_ROUTE_PREFIX}/${payload}.${signPayload(payload, secret)}`,
    expiresAt,
  };
});

export const validateLibraryUploadToken = Effect.fn("Library.validateUploadToken")(function* (
  token: string,
) {
  const [payload, signature, extra] = token.split(".");

  if (!payload || !signature || extra) return null;

  const secret = yield* loadSigningSecret.pipe(Effect.orElseSucceed(() => null));

  if (!secret || !timingSafeEqualBase64Url(signature, signPayload(payload, secret))) return null;

  const claims = yield* Effect.try(() => base64UrlDecodeUtf8(payload)).pipe(
    Effect.map((json) => Option.getOrNull(decodeUploadClaims(json))),
    Effect.orElseSucceed(() => null),
  );

  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;

  return claims;
});

/** Stores an upload's bytes as the person named in its token. */
export const storeLibraryUpload = (claims: LibraryUploadClaims, bytes: Uint8Array) =>
  bytes.byteLength === claims.sizeBytes
    ? storeLibraryFile({
        bytes,
        fileName: claims.fileName,
        folderId: claims.folderId === null ? null : LibraryFolderIdSchema.make(claims.folderId),
        threadId: claims.threadId === undefined ? undefined : ThreadIdSchema.make(claims.threadId),
        projectId:
          claims.projectId === undefined ? undefined : ProjectIdSchema.make(claims.projectId),
        visibility: claims.visibility,
        fileId: LibraryFileId.make(claims.fileId),
        by: {
          kind: "person",
          personId: AuthSessionId.make(claims.personId),
          displayName: claims.displayName,
        },
      })
    : fail(`The upload was ${bytes.byteLength} bytes, expected ${claims.sizeBytes}.`);
