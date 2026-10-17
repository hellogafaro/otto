import * as NodeCrypto from "node:crypto";

import { findSystemSkill, systemSkills } from "../skills/system-skills.ts";
import {
  type AuthSessionId,
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
  proposedSkillMarkdown,
  splitFrontMatter,
  type ApprovalResponder,
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
  createSkill,
  loadLibraryState,
  saveSkillReferences,
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

const SEARCH_TEXT_FILES = 200;

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
 * The <available_skills> lines: built-in skills first in a fixed order (those that need a
 * computer only when the bot has one), then Library skills. A Library skill named like a
 * built-in one is left out.
 */
export const skillCatalog = (
  library: ReadonlyArray<{
    readonly name: string;
    readonly skillId: string;
    readonly description: string | null;
  }>,
  options: { readonly computer: boolean },
) =>
  [
    ...systemSkills
      .filter((skill) => options.computer || !skill.needsComputer)
      .map((skill) => `- ${skill.name}: ${skill.description}`),
    ...library
      .filter((skill) => !findSystemSkill(skill.name))
      .slice(0, 100)
      .map(
        (skill) =>
          `- ${skill.name} (skillId: ${skill.skillId})${skill.description ? `: ${skill.description}` : ""}`,
      ),
  ].join("\n");

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

export const makeLibraryToolRuntime = Effect.gen(function* () {
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

  const save = (caller: LibraryToolCaller, input: Input<"library_create">) =>
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

  /** The text of a document, or of a text file up to 1 MB; null for anything else. */
  const fileText = (file: LibraryFile) =>
    file.type === "document"
      ? readLibraryDocument(file)
      : !TEXT_EXTENSIONS.has(file.extension) || file.sizeBytes > TEXT_READ_MAX_BYTES
        ? Effect.succeed(null)
        : readLibraryBytes(file).pipe(Effect.map((bytes) => new TextDecoder().decode(bytes)));

  /**
   * Files the bot and every reader may see, in a folder when given, newest first, whose
   * title, folder or text holds any of the words. Text is read from the newest 200 documents
   * and text files only.
   */
  const search = (
    caller: LibraryToolCaller,
    readers: ReadonlyArray<AuthSessionId>,
    input: { readonly terms: ReadonlyArray<string>; readonly folderId?: string | undefined },
  ) =>
    Effect.gen(function* () {
      const { state, files } = yield* scopedState(caller);

      const visible = files
        .filter(
          (file) =>
            (input.folderId === undefined || file.folderId === input.folderId) &&
            readers.every((personId) =>
              canSeeLibraryItem(file, state.context, { kind: "person", personId }),
            ),
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      const textIds = new Set(
        input.terms.length === 0
          ? []
          : visible
              .filter(
                (file) =>
                  file.type === "document" ||
                  (TEXT_EXTENSIONS.has(file.extension) && file.sizeBytes <= TEXT_READ_MAX_BYTES),
              )
              .slice(0, SEARCH_TEXT_FILES)
              .map((file) => file.id),
      );

      const found = yield* Effect.forEach(
        visible,
        (file) =>
          Effect.gen(function* () {
            const details = describeFile(state, file);

            const content = textIds.has(file.id)
              ? yield* fileText(file).pipe(Effect.orElseSucceed(() => null))
              : null;

            const text = [details.title, details.folderPath, content ?? ""]
              .join("\n")
              .toLowerCase();

            return input.terms.length === 0 || input.terms.some((term) => text.includes(term))
              ? [{ ...details, content: content ?? "" }]
              : [];
          }),
        { concurrency: 8 },
      );

      return found.flat();
    });

  const read = (caller: LibraryToolCaller, input: Input<"library_read">) =>
    Effect.gen(function* () {
      const { state, file } = yield* requireFile(caller, input.fileId);
      const details = describeFile(state, file);

      const content = yield* fileText(file);

      return content === null
        ? {
            ...details,
            content,
            note: "Only documents and text files up to 1 MB can be read as text.",
          }
        : { ...details, content };
    });

  const updateDocument = (caller: LibraryToolCaller, input: Input<"library_update">) =>
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

  const readSkillFile = (caller: LibraryToolCaller, input: Input<"skill_read">) =>
    Effect.gen(function* () {
      const path = (input.path ?? "SKILL.md").replace(/^\.?\//, "");
      const builtIn = findSystemSkill(input.skillId);

      if (builtIn) {
        const content = builtIn.files.get(path);

        if (content === undefined) {
          return yield* fail(
            `This skill has no file '${path}'. It has: ${[...builtIn.files.keys()].join(", ")}.`,
          );
        }

        return { skillId: builtIn.name, path, content };
      }

      const found = (yield* skillState(caller)).find(({ skill }) => skill.id === input.skillId);

      if (found === undefined) return yield* fail("That skill doesn't exist.");
      const { skill, files } = found;

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

      const details = {
        skillId: skill.id,
        path: entry.path,
        sizeBytes: entry.file.sizeBytes,
        updatedAt: entry.file.updatedAt,
      };

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

  const callerBot = (caller: LibraryToolCaller) =>
    Effect.gen(function* () {
      return yield* (yield* ProjectionBotRepository).getById({ botId: caller.botId }).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      );
    });

  /** The person a skill proposal is saved as: whoever approved it, if they may. */
  const approverOf = (responder: ApprovalResponder | undefined) =>
    responder
      ? Effect.succeed({
          kind: "person" as const,
          personId: responder.personId,
          displayName: responder.displayName,
        })
      : fail("A person has to approve a skill proposal in the chat.");

  const proposeSkill = (
    caller: LibraryToolCaller,
    input: Input<"skill_create">,
    responder: ApprovalResponder | undefined,
  ) =>
    Effect.gen(function* () {
      const approver = yield* approverOf(responder);

      if (input.visibility === "user") {
        const owner = (yield* callerBot(caller))?.owner;

        if (owner?.kind !== "person" || owner.personId !== responder?.personId) {
          return yield* fail("Only this bot's owner can approve a skill for this bot alone.");
        }
      } else if (!responder?.canWrite) {
        return yield* fail(
          "Only a workspace member who can make changes can approve a Team skill.",
        );
      }

      const { folderId } = yield* createSkill(
        {
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          content: proposedSkillMarkdown({
            ...input,
            proposal: { botId: caller.botId, threadId: caller.threadId },
          }),
        },
        approver,
        input.files ?? [],
      );

      return { saved: true, skillId: folderId, approvedBy: approver.displayName };
    });

  const updateSkill = (
    caller: LibraryToolCaller,
    input: Input<"skill_update">,
    responder: ApprovalResponder | undefined,
  ) =>
    Effect.gen(function* () {
      if (findSystemSkill(input.skillId)) return yield* fail("Built-in skills can't be changed.");
      const approver = yield* approverOf(responder);
      const found = (yield* skillState(caller)).find(({ skill }) => skill.id === input.skillId);

      if (found === undefined) return yield* fail("That skill doesn't exist.");
      const state = yield* loadLibraryState;

      if (
        !canEditLibraryItem(found.skill, state.folders, {
          kind: "person",
          personId: approver.personId,
        })
      ) {
        return yield* fail("Only someone who can edit this skill can approve a change to it.");
      }

      const main = found.files.find(
        (entry) => !entry.path.includes("/") && isSkillFile(entry.file),
      )?.file;

      if (main === undefined) return yield* fail("This skill has no SKILL.md to change.");
      const current = yield* readLibraryDocument(main);
      const frontMatter = parseSkillFrontMatter(current);

      if (input.description !== undefined || input.instructions !== undefined) {
        yield* saveLibraryDocument({
          fileId: main.id,
          content: proposedSkillMarkdown({
            name: frontMatter.name ?? found.skill.title,
            description: input.description ?? frontMatter.description ?? "",
            instructions: input.instructions ?? splitFrontMatter(current).body,
            proposal: { botId: caller.botId, threadId: caller.threadId },
          }),
          expectedUpdatedAt: input.updatedAt,
          by: approver,
        });
      } else if (main.updatedAt !== input.updatedAt) {
        return yield* fail(
          "Someone changed this skill since you read it. Read it again and merge.",
        );
      }

      yield* saveSkillReferences(found.skill.id, input.files ?? [], approver);

      return { saved: true, skillId: found.skill.id, approvedBy: approver.displayName };
    });

  const run = <A>(effect: Effect.Effect<A, LibraryRequestError, LibraryToolServices>) =>
    effect.pipe(
      Effect.catchTag("LibraryRequestError", (error) => Effect.succeed({ error: error.detail })),
      Effect.provide(context),
    );

  return {
    save: (caller: LibraryToolCaller, input: Input<"library_create">) => run(save(caller, input)),
    search: (
      caller: LibraryToolCaller,
      readers: ReadonlyArray<AuthSessionId>,
      input: { readonly terms: ReadonlyArray<string>; readonly folderId?: string | undefined },
    ) => run(search(caller, readers, input)),
    read: (caller: LibraryToolCaller, input: Input<"library_read">) => run(read(caller, input)),
    updateDocument: (caller: LibraryToolCaller, input: Input<"library_update">) =>
      run(updateDocument(caller, input)),
    /** The skills this bot can use, one prompt line each; built-in ones even when the read fails. */
    skillsContext: (caller: LibraryToolCaller, options: { readonly computer: boolean }) =>
      listSkills(caller).pipe(
        Effect.map(({ skills }) => skills),
        Effect.orElseSucceed(() => []),
        Effect.map((skills) => skillCatalog(skills, options)),
        Effect.provide(context),
      ),
    proposeSkill: (
      caller: LibraryToolCaller,
      input: Input<"skill_create">,
      responder: ApprovalResponder | undefined,
    ) => run(proposeSkill(caller, input, responder)),
    updateSkill: (
      caller: LibraryToolCaller,
      input: Input<"skill_update">,
      responder: ApprovalResponder | undefined,
    ) => run(updateSkill(caller, input, responder)),
    readSkillFile: (caller: LibraryToolCaller, input: Input<"skill_read">) =>
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
