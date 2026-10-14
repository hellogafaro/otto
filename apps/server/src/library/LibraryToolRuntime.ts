import * as NodeCrypto from "node:crypto";

import {
  type BotId,
  CommandId,
  canEditLibraryItem,
  canSeeLibraryItem,
  type LibraryFile,
  type LibraryFolder,
  type LibraryVisibilityContext,
  LibraryRequestError,
  libraryChatFolder,
  libraryDocumentTitle,
  libraryFolderPath,
  normalizeLibraryTitle,
  type OttoToolInputSchemas,
  type ThreadId,
  type WorkParticipant,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionThreadMessageRepositoryLive } from "../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionGroupRepository } from "../persistence/Services/ProjectionGroups.ts";
import { ProjectionLibraryRepository } from "../persistence/Services/ProjectionLibrary.ts";
import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import {
  loadLibraryState,
  type LibraryState,
  readLibraryBytes,
  readLibraryDocument,
  saveLibraryDocument,
  storeLibraryFile,
} from "./LibraryStore.ts";

type Input<Name extends keyof typeof OttoToolInputSchemas> =
  (typeof OttoToolInputSchemas)[Name]["Type"];

/** Who a bot tool acts as, and the chat it runs in. */
export interface LibraryToolCaller {
  readonly threadId: ThreadId;
  readonly botId: BotId;
}

const TEXT_EXTENSIONS = new Set([
  "md",
  "txt",
  "csv",
  "tsv",
  "json",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
]);

const TEXT_READ_MAX_BYTES = 1_000_000;

const LIST_DEFAULT_LIMIT = 50;

const fail = (detail: string) => Effect.fail(new LibraryRequestError({ detail }));

/**
 * What a bot may see from one chat: the Library items it can see that sit outside every chat
 * folder, and this chat's own folder. Another chat's files never leak into this one, even if
 * the bot is in both.
 */
export const inLibraryToolScope = (
  state: {
    readonly folders: ReadonlyArray<LibraryFolder>;
    readonly context: LibraryVisibilityContext;
  },
  caller: LibraryToolCaller,
  item: LibraryFolder | LibraryFile,
) => {
  if (!canSeeLibraryItem(item, state.context, { kind: "bot", botId: caller.botId })) return false;
  const chatFolder = libraryChatFolder(state.folders, item);

  return chatFolder === undefined || chatFolder.threadId === caller.threadId;
};

const describeFile = (state: LibraryState, file: LibraryFile) => ({
  fileId: file.id,
  title: file.title,
  type: file.type,
  extension: file.extension,
  sizeBytes: file.sizeBytes,
  folderId: file.folderId,
  folderPath: libraryFolderPath(state.folders, file.folderId)
    .toReversed()
    .map((folder) => folder.title)
    .join(" / "),
  visibility: file.visibility,
  createdBy: participantLabel(file.createdBy),
  updatedBy: participantLabel(file.updatedBy),
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const participantLabel = (participant: WorkParticipant) =>
  participant.kind === "person" ? participant.displayName : `bot ${participant.botId}`;

type LibraryToolServices =
  | ProjectionLibraryRepository
  | ProjectionGroupRepository
  | ProjectionSnapshotQuery
  | ProjectionThreadMessageRepository
  | OrchestrationEngineService
  | ServerConfig.ServerConfig
  | FileSystem.FileSystem
  | Path.Path;

const makeLibraryToolRuntime = Effect.gen(function* () {
  const context = yield* Effect.context<LibraryToolServices>();

  const scopedState = (caller: LibraryToolCaller) =>
    loadLibraryState.pipe(
      Effect.map((state) => ({
        state,
        folders: state.folders.filter((folder) => inLibraryToolScope(state, caller, folder)),
        files: state.files.filter((file) => inLibraryToolScope(state, caller, file)),
      })),
    );

  const requireFile = (caller: LibraryToolCaller, fileId: string) =>
    Effect.gen(function* () {
      const scoped = yield* scopedState(caller);
      const file = scoped.files.find((candidate) => candidate.id === fileId);

      if (file === undefined) return yield* fail("That Library file doesn't exist.");

      return { ...scoped, file };
    });

  const by = (caller: LibraryToolCaller): WorkParticipant => ({ kind: "bot", botId: caller.botId });

  const save = (caller: LibraryToolCaller, input: Input<"SaveToLibrary">) =>
    Effect.gen(function* () {
      const scoped = yield* scopedState(caller);

      if (
        input.folderId !== undefined &&
        !scoped.folders.some((folder) => folder.id === input.folderId)
      ) {
        return yield* fail("That folder doesn't exist.");
      }

      const destination =
        input.folderId === undefined
          ? { folderId: null, threadId: caller.threadId }
          : { folderId: input.folderId };

      const source =
        input.content !== undefined
          ? {
              bytes: new TextEncoder().encode(input.content),
              fileName: input.fileName ?? "document.md",
              title:
                input.title ??
                (input.fileName === undefined || input.fileName.toLowerCase().endsWith(".md")
                  ? libraryDocumentTitle(input.content)
                  : undefined),
            }
          : yield* attachmentSource(caller, input.attachmentId ?? "", input.title);

      const fileId = yield* storeLibraryFile({
        ...source,
        ...destination,
        visibility: "workspace",
        by: by(caller),
      });

      const saved = yield* loadLibraryState;
      const file = saved.files.find((candidate) => candidate.id === fileId);

      return file ? { saved: true, ...describeFile(saved, file) } : { saved: true, fileId };
    });

  const attachmentSource = (
    caller: LibraryToolCaller,
    attachmentId: string,
    title: string | undefined,
  ) =>
    Effect.gen(function* () {
      const messages = yield* ProjectionThreadMessageRepository;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const threadMessages = yield* messages
        .listByThreadId({ threadId: caller.threadId })
        .pipe(
          Effect.mapError(() => new LibraryRequestError({ detail: "Could not read this chat." })),
        );

      const attachment = threadMessages
        .flatMap((message) => message.attachments ?? [])
        .find((candidate) => candidate.id === attachmentId);

      if (attachment === undefined) return yield* fail("That attachment isn't in this chat.");
      const path = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment });

      if (path === null) return yield* fail("That attachment is no longer available.");

      const bytes = yield* fileSystem
        .readFile(path)
        .pipe(
          Effect.mapError(
            () => new LibraryRequestError({ detail: "That attachment is no longer available." }),
          ),
        );

      return { bytes, fileName: attachment.name, title };
    });

  const list = (caller: LibraryToolCaller, input: Input<"ListLibrary">) =>
    Effect.gen(function* () {
      const { state, folders, files } = yield* scopedState(caller);
      const query = input.query?.toLowerCase();

      const matches = files
        .filter(
          (file) =>
            (input.folderId === undefined || file.folderId === input.folderId) &&
            (input.type === undefined || file.type === input.type) &&
            (query === undefined || file.title.toLowerCase().includes(query)),
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      const limit = input.limit ?? LIST_DEFAULT_LIMIT;

      return {
        folders: folders
          .filter((folder) => input.folderId === undefined || folder.parentId === input.folderId)
          .map((folder) => ({
            folderId: folder.id,
            title: folder.title,
            parentId: folder.parentId,
            isChatFolder: folder.threadId !== undefined,
            isThisChat: folder.threadId === caller.threadId,
          })),
        files: matches.slice(0, limit).map((file) => describeFile(state, file)),
        truncated: matches.length > limit,
      };
    });

  const read = (caller: LibraryToolCaller, input: Input<"ReadLibraryFile">) =>
    Effect.gen(function* () {
      const { state, file } = yield* requireFile(caller, input.fileId);
      const details = describeFile(state, file);

      if (file.type === "document")
        return { ...details, content: yield* readLibraryDocument(file) };

      if (!TEXT_EXTENSIONS.has(file.extension) || file.sizeBytes > TEXT_READ_MAX_BYTES) {
        return {
          ...details,
          content: null,
          note: "Only documents and text files up to 1 MB can be read as text.",
        };
      }

      const bytes = yield* readLibraryBytes(file);

      return { ...details, content: new TextDecoder().decode(bytes) };
    });

  const updateDocument = (caller: LibraryToolCaller, input: Input<"UpdateLibraryDocument">) =>
    Effect.gen(function* () {
      const { state, file } = yield* requireFile(caller, input.fileId);

      if (file.type !== "document") return yield* fail("Only documents can be edited.");

      if (!canEditLibraryItem(file, state.folders, { kind: "bot", botId: caller.botId })) {
        return yield* fail("Only the document's creator can edit it.");
      }

      yield* saveLibraryDocument({
        fileId: file.id,
        content: input.content,
        expectedUpdatedAt: input.updatedAt,
        by: by(caller),
      });

      if (input.title !== undefined && normalizeLibraryTitle(input.title) !== file.title) {
        const engine = yield* OrchestrationEngineService;

        yield* engine
          .dispatch({
            type: "library.file.update",
            commandId: CommandId.make(`library:${NodeCrypto.randomUUID()}`),
            fileId: file.id,
            title: normalizeLibraryTitle(input.title),
            by: by(caller),
          })
          .pipe(
            Effect.mapError(
              () => new LibraryRequestError({ detail: "The new title wasn't saved." }),
            ),
          );
      }

      const next = yield* loadLibraryState;
      const updated = next.files.find((candidate) => candidate.id === file.id) ?? file;

      return { saved: true, ...describeFile(next, updated) };
    });

  const run = <A>(effect: Effect.Effect<A, LibraryRequestError, LibraryToolServices>) =>
    effect.pipe(
      Effect.catchTag("LibraryRequestError", (error) => Effect.succeed({ error: error.detail })),
      Effect.provide(context),
    );

  return {
    save: (caller: LibraryToolCaller, input: Input<"SaveToLibrary">) => run(save(caller, input)),
    list: (caller: LibraryToolCaller, input: Input<"ListLibrary">) => run(list(caller, input)),
    read: (caller: LibraryToolCaller, input: Input<"ReadLibraryFile">) => run(read(caller, input)),
    updateDocument: (caller: LibraryToolCaller, input: Input<"UpdateLibraryDocument">) =>
      run(updateDocument(caller, input)),
    /** Files a generated image in the chat's Library folder; a failure only logs. */
    saveGeneratedImage: (
      caller: LibraryToolCaller,
      image: { readonly bytes: Uint8Array; readonly fileName: string; readonly title: string },
    ) =>
      storeLibraryFile({
        bytes: image.bytes,
        fileName: image.fileName,
        title: image.title,
        folderId: null,
        threadId: caller.threadId,
        visibility: "workspace",
        by: by(caller),
      }).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.logWarning("Could not save a generated image to the Library.", {
            threadId: caller.threadId,
            detail: error.detail,
          }),
        ),
        Effect.provide(context),
      ),
  };
});

export type LibraryToolRuntimeShape = Effect.Success<typeof makeLibraryToolRuntime>;

let activeLibraryToolRuntime: LibraryToolRuntimeShape | undefined;

/** The running Library tool runtime, published for tool handlers the way image generation is. */
export const activeLibraryTools = () => activeLibraryToolRuntime;

export const layer = Layer.effectDiscard(
  makeLibraryToolRuntime.pipe(
    Effect.flatMap((runtime) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          activeLibraryToolRuntime = runtime;
        }),
        () =>
          Effect.sync(() => {
            if (activeLibraryToolRuntime === runtime) activeLibraryToolRuntime = undefined;
          }),
      ),
    ),
  ),
).pipe(Layer.provide(ProjectionThreadMessageRepositoryLive));
