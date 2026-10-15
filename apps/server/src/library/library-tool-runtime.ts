import * as NodeCrypto from "node:crypto";

import {
  type BotId,
  CommandId,
  canEditLibraryItem,
  canSeeLibraryItem,
  isSkillFile,
  LIBRARY_SKILLS_FOLDER_ID,
  type LibraryFile,
  type LibraryFolder,
  type LibraryVisibilityContext,
  LibraryRequestError,
  libraryChatFolder,
  libraryDocumentTitle,
  libraryFolderPath,
  normalizeLibraryTitle,
  type OttoToolInputSchemas,
  parseSkillFrontMatter,
  type ThreadId,
  type WorkParticipant,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveAttachmentPath } from "../attachment-store.ts";
import * as ServerConfig from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { ProjectionThreadMessageRepositoryLive } from "../persistence/layers/projection-thread-messages.ts";
import { ProjectionBotRepository } from "../persistence/services/projection-bots.ts";
import { ProjectionGroupRepository } from "../persistence/services/projection-groups.ts";
import { ProjectionLibraryRepository } from "../persistence/services/projection-library.ts";
import { ProjectionThreadMessageRepository } from "../persistence/services/projection-thread-messages.ts";
import {
  loadLibraryState,
  type LibraryState,
  readLibraryBytes,
  readLibraryDocument,
  saveLibraryDocument,
  storeLibraryFile,
} from "./library-store.ts";

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

/** What a skill's references and scripts are usually written in; all read as plain text. */
const SKILL_TEXT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  "py",
  "sh",
  "js",
  "mjs",
  "ts",
  "rb",
  "sql",
  "toml",
  "ini",
  "css",
]);

const SKILLS_MAX = 100;

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

/**
 * The skills a bot uses, each with its files and their paths inside the skill: workspace
 * skills plus its owner's personal ones, the way it uses its owner's personal connections,
 * minus the ones switched off for it. People chatting with the bot use them through it
 * without seeing them.
 */
export const botSkills = (
  state: {
    readonly folders: ReadonlyArray<LibraryFolder>;
    readonly files: ReadonlyArray<LibraryFile>;
  },
  bot: {
    readonly botId: BotId;
    readonly owner: WorkParticipant | null;
    readonly disabledSkillIds?: ReadonlyArray<string> | undefined;
  },
) => {
  const serves = (node: LibraryFolder | LibraryFile) =>
    node.visibility === "organization" ||
    (node.createdBy.kind === "person"
      ? bot.owner?.kind === "person" && node.createdBy.personId === bot.owner.personId
      : node.createdBy.botId === bot.botId);

  return state.folders
    .filter(
      (folder) =>
        folder.parentId === LIBRARY_SKILLS_FOLDER_ID &&
        serves(folder) &&
        !bot.disabledSkillIds?.includes(folder.id),
    )
    .toSorted((left, right) => left.title.localeCompare(right.title))
    .slice(0, SKILLS_MAX)
    .map((skill) => {
      const paths = new Map<string, string>([[skill.id, ""]]);
      const pending: string[] = [skill.id];

      for (const parentId of pending) {
        for (const folder of state.folders) {
          if (folder.parentId !== parentId || !serves(folder)) continue;
          paths.set(folder.id, `${paths.get(parentId)}${folder.title}/`);
          pending.push(folder.id);
        }
      }

      const files = state.files.flatMap((file) => {
        const prefix = file.folderId === null ? undefined : paths.get(file.folderId);

        if (prefix === undefined || !serves(file)) return [];
        const name = file.extension === "" ? file.title : `${file.title}.${file.extension}`;

        return [{ path: `${prefix}${name}`, file }];
      });

      return { skill, files };
    });
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
  | ProjectionBotRepository
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
        visibility: "organization",
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

  const skillState = (caller: LibraryToolCaller) =>
    Effect.gen(function* () {
      const state = yield* loadLibraryState;

      const bot = yield* (yield* ProjectionBotRepository).getById({ botId: caller.botId }).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      );

      return botSkills(state, {
        botId: caller.botId,
        owner: bot?.owner ?? null,
        disabledSkillIds: bot?.disabledSkillIds,
      });
    });

  const listSkills = (caller: LibraryToolCaller) =>
    Effect.gen(function* () {
      const skills = yield* skillState(caller);

      return {
        skills: yield* Effect.forEach(skills, ({ skill, files }) =>
          Effect.gen(function* () {
            const main = files.find(
              (entry) => !entry.path.includes("/") && isSkillFile(entry.file),
            );

            const frontMatter = main
              ? parseSkillFrontMatter(
                  yield* readLibraryDocument(main.file).pipe(Effect.orElseSucceed(() => "")),
                )
              : {};

            return {
              skillId: skill.id,
              name: frontMatter.name ?? skill.title,
              description: frontMatter.description ?? null,
              personal: skill.visibility === "user",
              files: files.map((entry) => entry.path),
            };
          }),
        ),
      };
    });

  const readSkillFile = (caller: LibraryToolCaller, input: Input<"ReadSkillFile">) =>
    Effect.gen(function* () {
      const found = (yield* skillState(caller)).find(({ skill }) => skill.id === input.skillId);

      if (found === undefined) return yield* fail("That skill doesn't exist.");
      const { skill, files } = found;
      const path = (input.path ?? "SKILL.md").replace(/^\.?\//, "");

      const entry =
        files.find((candidate) => candidate.path === path) ??
        (path.toUpperCase() === "SKILL.MD"
          ? files.find((candidate) => !candidate.path.includes("/") && isSkillFile(candidate.file))
          : undefined);

      if (entry === undefined) {
        return yield* fail(
          `This skill has no file '${path}'. It has: ${files.map((candidate) => candidate.path).join(", ")}.`,
        );
      }

      const details = { skillId: skill.id, path: entry.path, sizeBytes: entry.file.sizeBytes };

      if (entry.file.type === "document") {
        return { ...details, content: yield* readLibraryDocument(entry.file) };
      }

      if (
        !SKILL_TEXT_EXTENSIONS.has(entry.file.extension) ||
        entry.file.sizeBytes > TEXT_READ_MAX_BYTES
      ) {
        return { ...details, content: null, note: "Only text files up to 1 MB can be read." };
      }

      const bytes = yield* readLibraryBytes(entry.file);

      return { ...details, content: new TextDecoder().decode(bytes) };
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
    listSkills: (caller: LibraryToolCaller) => run(listSkills(caller)),
    /** The skills this bot can use, as system prompt text; empty when it has none or the read fails. */
    skillsContext: (caller: LibraryToolCaller) =>
      listSkills(caller).pipe(
        Effect.map(({ skills }) =>
          skills.length === 0
            ? ""
            : [
                "Saved skills you can use. When a request matches a skill's description, read its SKILL.md with ReadSkillFile before you answer, then follow it.",
                ...skills
                  .slice(0, 100)
                  .map(
                    (skill) =>
                      `- ${skill.name} (skillId: ${skill.skillId})${skill.description ? `: ${skill.description}` : ""}`,
                  ),
              ].join("\n"),
        ),
        Effect.orElseSucceed(() => ""),
        Effect.provide(context),
      ),
    readSkillFile: (caller: LibraryToolCaller, input: Input<"ReadSkillFile">) =>
      run(readSkillFile(caller, input)),
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
        visibility: "organization",
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
