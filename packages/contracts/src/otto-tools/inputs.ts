import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  BotId,
  ProjectId,
  TaskId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "../base-schemas.ts";
import { McpServerInstructions, McpServerUrl } from "../mcp-server.ts";
import { ImageGenerationRequest } from "../image-generation.ts";
import {
  LIBRARY_DOCUMENT_MAX_BYTES,
  LibraryFileId,
  LibraryFolderId,
  LibraryTitle,
  LibraryVisibility,
  SkillDescription,
} from "../orchestration/library.ts";
import {
  TaskDueDate,
  TaskPriority,
  TaskRepeat,
  WorkDescription,
  WorkParticipantKey,
  WorkStatus,
  WorkTitle,
} from "../orchestration/work.ts";
import { ActivityContent, ActivityEntryId } from "../orchestration/activity.ts";
import { BotInstructions } from "../orchestration/roster.ts";
import { OttoToolId } from "./catalog.ts";

export const OTTO_COMMAND_MAX_CHARS = 32_000;

export const OTTO_PATH_MAX_CHARS = 512;

export const OttoPluginRecommendation = Schema.Struct({
  id: TrimmedNonEmptyString,
  source: Schema.Literals(["directory", "composio"]),
  name: TrimmedNonEmptyString,
  description: Schema.String,
  category: Schema.optional(TrimmedNonEmptyString),
  logoUrl: Schema.optional(TrimmedNonEmptyString),
  action: Schema.Literals(["open", "install", "connect", "unavailable"]),
});

export type OttoPluginRecommendation = typeof OttoPluginRecommendation.Type;

export const OttoPluginSearchResult = Schema.Struct({
  kind: Schema.Literal("plugin-search-results"),
  query: Schema.String,
  total: NonNegativeInt,
  sources: Schema.Struct({
    directory: Schema.Literal("available"),
    composio: Schema.Literals(["available", "setup-required", "unavailable"]),
  }),
  recommendations: Schema.Array(OttoPluginRecommendation),
});

export type OttoPluginSearchResult = typeof OttoPluginSearchResult.Type;

const CommandText = TrimmedNonEmptyString.check(Schema.isMaxLength(OTTO_COMMAND_MAX_CHARS));

const PathText = TrimmedNonEmptyString.check(Schema.isMaxLength(OTTO_PATH_MAX_CHARS));

const CommandInput = Schema.Struct({
  command: CommandText,
  cwd: Schema.optional(PathText),
});

const WebSearchInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  domains: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});

const WebFetchInput = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https?:\/\//i)),
  offset: Schema.optional(NonNegativeInt),
});

const ConnectionIdInput = Schema.Struct({ id: TrimmedNonEmptyString });

const ConnectionCreateInput = Schema.Struct({
  pluginId: Schema.optional(TrimmedNonEmptyString),
  url: Schema.optional(McpServerUrl),
  title: Schema.optional(TrimmedNonEmptyString),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.pluginId !== undefined
        ? input.url === undefined
        : input.url !== undefined && input.title !== undefined) ||
      new SchemaIssue.InvalidValue({ message: "Pass either pluginId, or url with a title." }),
  ),
);

const ConnectionUpdateInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  instructions: Schema.optional(McpServerInstructions),
}).check(
  Schema.makeFilter(
    (input) =>
      input.title !== undefined ||
      input.instructions !== undefined ||
      new SchemaIssue.InvalidValue({ message: "Pass a title, instructions, or both." }),
  ),
);

const UpdateBotProfileInput = Schema.Struct({
  name: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(BotInstructions),
}).check(
  Schema.makeFilter(
    (input) =>
      input.name !== undefined ||
      input.title !== undefined ||
      input.label !== undefined ||
      input.description !== undefined ||
      input.instructions !== undefined ||
      new SchemaIssue.InvalidValue({ message: "At least one profile field is required." }),
    { identifier: "UpdateBotProfileInput" },
  ),
);

/**
 * Maximum characters of parent context a bot may hand to a child. Longer
 * input is rejected, never truncated, so the child never works from a silently
 * clipped brief.
 */
export const OTTO_DELEGATION_CONTEXT_MAX_CHARS = 8_000;

const AgentMessageInput = Schema.Struct({
  botId: BotId,
  task: TrimmedNonEmptyString,
  expectedResult: TrimmedNonEmptyString,
  context: Schema.optional(
    Schema.String.check(
      Schema.isMaxLength(OTTO_DELEGATION_CONTEXT_MAX_CHARS, {
        message: `Delegation context must be at most ${OTTO_DELEGATION_CONTEXT_MAX_CHARS} characters.`,
      }),
    ),
  ),
});

/** The size limit is checked on the saved bytes, so the model sees a plain string. */
const LibraryText = Schema.String;

const SkillInstructions = TrimmedNonEmptyString.check(
  Schema.isMaxLength(LIBRARY_DOCUMENT_MAX_BYTES),
);

/** Reference files a skill proposal brings; Otto keeps them as text under references/. */
const SkillProposalFiles = Schema.Array(
  Schema.Struct({
    path: TrimmedNonEmptyString.check(
      Schema.isMaxLength(200),
      Schema.isPattern(/^(references\/)?[A-Za-z0-9][\w.-]*\.(md|txt)$/),
    ),
    content: Schema.String.check(Schema.isMaxLength(LIBRARY_DOCUMENT_MAX_BYTES)),
  }),
).check(Schema.isMaxLength(10));

const SkillProposalReason = TrimmedNonEmptyString.check(Schema.isMaxLength(500));

const SaveToLibraryInput = Schema.Struct({
  content: Schema.optional(LibraryText),
  fileName: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  attachmentId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  title: Schema.optional(LibraryTitle),
  folderId: Schema.optional(LibraryFolderId),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.content === undefined) !== (input.attachmentId === undefined) ||
      new SchemaIssue.InvalidValue({ message: "Pass either content or attachmentId." }),
  ),
);

const AudioTranscribeInput = Schema.Struct({
  path: Schema.optional(PathText),
  fileId: Schema.optional(LibraryFileId),
  language: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z]{2}$/))),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.path === undefined) !== (input.fileId === undefined) ||
      new SchemaIssue.InvalidValue({ message: "Pass either path or fileId." }),
  ),
);

/** Otto: Someone work goes to: `me` for the calling bot, or a `bot:…` / `person:…` key. */
const TaskParticipantRef = Schema.Union([Schema.Literal("me"), WorkParticipantKey]);

/**
 * Otto: A field's description as bots read it in the tool schema, stating its rule. It sits on the
 * encoded side, which is what the model's JSON schema shows; decoding is unchanged.
 */
const described = <S extends Schema.Top>(schema: S, description: string) =>
  Schema.toEncoded(schema).annotate({ description }).pipe(Schema.decodeTo(schema));

/** A page of a task tool's list; the repository's list rule caps every page at 100. */
const TaskToolLimit = described(
  PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
  "Maximum results returned, at most 100. Default 50.",
);

const TaskToolCursor = described(
  TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  "Pass the cursor from the previous result to get the next page.",
);

/** What a task links to: a web page, a Library file, another task or a project. */
const TaskToolResource = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("url"),
    url: described(
      TrimmedNonEmptyString.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//i)),
      "Web address, starting with http:// or https://.",
    ),
    title: Schema.optional(
      described(
        TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
        "Display title. Defaults to the address.",
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("file"),
    fileId: described(LibraryFileId, "Library file ID, from library_create or search."),
  }),
  Schema.Struct({ type: Schema.Literal("task"), linkedTaskId: TaskId }),
  Schema.Struct({ type: Schema.Literal("project"), linkedProjectId: ProjectId }),
]);

const TaskToolFields = {
  description: Schema.optional(
    described(Schema.NullOr(WorkDescription), "Description in markdown. null clears it."),
  ),
  status: Schema.optional(
    described(
      WorkStatus,
      "completed records completedAt and completedBy. Any other status clears them, which " +
        "reopens the task. Completing a repeating task creates its next one.",
    ),
  ),
  priority: Schema.optional(
    described(Schema.NullOr(TaskPriority), "low, medium or high. null removes it."),
  ),
  dueDate: Schema.optional(
    described(Schema.NullOr(TaskDueDate), "Due date as YYYY-MM-DD. null clears it."),
  ),
  assignees: Schema.optional(
    described(
      Schema.Array(TaskParticipantRef).check(Schema.isMaxLength(20)),
      'Full list of assignees, as person keys, bot keys or "me". Replaces the current list; ' +
        "send [] to remove everyone. To add one, send the current list plus that one.",
    ),
  ),
  owner: Schema.optional(
    described(
      Schema.NullOr(WorkParticipantKey),
      "Person key of the owner. Must be a person, not a bot. null clears it.",
    ),
  ),
  repeat: Schema.optional(
    described(
      Schema.NullOr(TaskRepeat),
      "How the task repeats; weekly repeats on its due date's weekday. Completing it creates " +
        "the next task, a copy with status pending and the next due date, and the completed one " +
        "stops repeating. Cancelling it ends the chain; to skip one, move its due date instead. " +
        "null stops it repeating.",
    ),
  ),
  resources: Schema.optional(
    described(
      Schema.Array(TaskToolResource).check(Schema.isMaxLength(20)),
      "Full list of what the task links to: web pages, Library files, tasks and projects. " +
        "Replaces the current list, which task_read shows; send [] to remove them all. Removing " +
        "a link never touches the file, task or page itself.",
    ),
  ),
};

/** The task fields a null clears. */
const TASK_CLEARABLE_FIELDS = ["description", "priority", "dueDate", "owner", "repeat"] as const;

/**
 * Otto: The fields a tool clears with null. Some models send null for a field they leave out, so
 * every other null is dropped before decoding.
 */
export const OTTO_TOOL_CLEARABLE_FIELDS: Partial<Record<OttoToolId, ReadonlyArray<string>>> = {
  task_create: TASK_CLEARABLE_FIELDS,
  task_update: TASK_CLEARABLE_FIELDS,
};

const PersonRef = described(
  Schema.Union([Schema.Literal("me"), WorkParticipantKey]),
  'Person key, or "me" when a person makes the call.',
);

const OttoSearchType = Schema.Literals(["task", "file", "message", "routine"]);

const OttoSearchDue = Schema.Literals(["overdue", "today", "this_week", "none"]);

export const OttoToolInputSchemas = {
  search: Schema.Struct({
    query: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
    type: Schema.optional(OttoSearchType),
    status: Schema.optional(Schema.Array(WorkStatus)),
    assignee: Schema.optional(TaskParticipantRef),
    projectId: Schema.optional(ProjectId),
    due: Schema.optional(OttoSearchDue),
    folderId: Schema.optional(LibraryFolderId),
    priority: Schema.optional(
      described(Schema.Array(TaskPriority), 'Only tasks with these priorities, such as ["high"].'),
    ),
    limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
  }),
  shell: CommandInput,
  read: Schema.Struct({
    path: PathText,
    offset: Schema.optional(PositiveInt),
    limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(2_000))),
  }),
  edit: Schema.Struct({
    path: PathText,
    edits: Schema.Array(
      Schema.Struct({
        oldText: Schema.String.check(Schema.isMinLength(1)),
        newText: Schema.String,
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
  bot_create: Schema.Struct({
    name: TrimmedNonEmptyString,
    title: Schema.optional(TrimmedNonEmptyString),
    description: Schema.optional(TrimmedNonEmptyString),
  }),
  delegate_check: Schema.Struct({ botId: BotId }),
  delegate_stop: Schema.Struct({ botId: BotId }),
  delegate: AgentMessageInput,
  message_post: Schema.Struct({
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(OTTO_COMMAND_MAX_CHARS)),
    files: Schema.optional(
      Schema.Array(Schema.Struct({ path: PathText })).check(Schema.isMaxLength(10)),
    ),
  }),
  connection_search: Schema.Struct({
    query: TrimmedNonEmptyString,
    limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
  }),
  connection_read: ConnectionIdInput,
  connection_create: ConnectionCreateInput,
  connection_update: ConnectionUpdateInput,
  connection_check: Schema.Struct({
    id: TrimmedNonEmptyString,
    action: Schema.Literals(["test", "reconnect", "authenticate"]),
  }),
  connection_delete: ConnectionIdInput,
  message_react: Schema.Struct({
    messageId: MessageId,
    emoji: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
    action: Schema.Literals(["add", "remove"]),
  }),
  bot_update: UpdateBotProfileInput,
  web_search: WebSearchInput,
  web_fetch: WebFetchInput,
  image_create: ImageGenerationRequest,
  audio_transcribe: AudioTranscribeInput,
  library_create: SaveToLibraryInput,
  library_read: Schema.Struct({ fileId: LibraryFileId }),
  library_share: Schema.Struct({ fileId: LibraryFileId }),
  library_unshare: Schema.Struct({ fileId: LibraryFileId }),
  library_update: Schema.Struct({
    fileId: LibraryFileId,
    content: LibraryText,
    updatedAt: IsoDateTime,
    title: Schema.optional(LibraryTitle),
  }),
  skill_read: Schema.Struct({
    /** A built-in skill's name, or a Library skill's skillId. */
    skillId: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
    path: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  }),
  skill_create: Schema.Struct({
    name: TrimmedNonEmptyString.check(
      Schema.isMaxLength(64),
      Schema.isPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    ),
    description: SkillDescription,
    instructions: SkillInstructions,
    files: Schema.optional(SkillProposalFiles),
    visibility: LibraryVisibility,
    reason: SkillProposalReason,
  }),
  skill_update: Schema.Struct({
    skillId: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
    updatedAt: IsoDateTime,
    description: Schema.optional(SkillDescription),
    instructions: Schema.optional(SkillInstructions),
    files: Schema.optional(SkillProposalFiles),
    reason: SkillProposalReason,
  }),
  task_read: Schema.Struct({ taskId: TaskId }),
  task_create: Schema.Struct({
    title: described(WorkTitle, "Title."),
    projectId: Schema.optional(
      described(ProjectId, "Project to put the task in. Defaults to this chat's project."),
    ),
    ...TaskToolFields,
  }),
  task_update: Schema.Struct({
    taskId: described(TaskId, "ID of the task to change."),
    title: Schema.optional(described(WorkTitle, "New title.")),
    projectId: Schema.optional(described(ProjectId, "Move the task to this project.")),
    ...TaskToolFields,
  }),
  task_delete: Schema.Struct({ taskId: described(TaskId, "ID of the task to delete.") }),
  task_comment_create: Schema.Struct({
    taskId: TaskId,
    content: described(
      ActivityContent,
      "Comment text. Mention a person with @person:<key>, which notifies them.",
    ),
  }),
  task_comment_list: Schema.Struct({
    taskId: described(TaskId, "Task whose comments to list."),
    order: Schema.optional(
      described(Schema.Literals(["newest", "oldest"]), "Sort order. Default newest."),
    ),
    limit: Schema.optional(TaskToolLimit),
    cursor: Schema.optional(TaskToolCursor),
  }),
  task_comment_update: Schema.Struct({
    commentId: described(ActivityEntryId, "ID of a comment you wrote."),
    content: described(ActivityContent, "The comment's new text; it replaces the old text."),
  }),
  task_comment_delete: Schema.Struct({
    commentId: described(ActivityEntryId, "ID of the comment to delete."),
  }),
  task_time_create: Schema.Struct({
    taskId: described(TaskId, "Task the time belongs to."),
    person: described(PersonRef, "Person key of whoever did the work."),
    minutes: described(
      PositiveInt.check(Schema.isLessThanOrEqualTo(1440)),
      "Time spent, in whole minutes, at most 1440. 2 h is 120.",
    ),
    date: Schema.optional(
      described(
        TaskDueDate,
        "Day the work happened, as YYYY-MM-DD. Defaults to today in the organization's time " +
          "zone. Can't be in the future.",
      ),
    ),
    note: Schema.optional(
      described(
        TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
        "Optional note on what the time covered.",
      ),
    ),
  }),
  task_time_delete: Schema.Struct({
    entryId: described(
      TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
      "ID of the entry to delete, from task_time_create, task_time_list or task_read.",
    ),
  }),
  task_time_list: Schema.Struct({
    taskId: Schema.optional(described(TaskId, "Only entries on this task.")),
    person: Schema.optional(described(PersonRef, "Only entries for this person.")),
    projectId: Schema.optional(described(ProjectId, "Only entries on tasks in this project.")),
    from: Schema.optional(described(TaskDueDate, "First day, inclusive, as YYYY-MM-DD.")),
    to: Schema.optional(described(TaskDueDate, "Last day, inclusive, as YYYY-MM-DD.")),
    limit: Schema.optional(TaskToolLimit),
    cursor: Schema.optional(TaskToolCursor),
  }),
} as const satisfies Record<OttoToolId, Schema.Top>;

export const OttoMessageReactionResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("applied"),
    messageId: MessageId,
    emoji: TrimmedNonEmptyString,
    action: Schema.Literals(["add", "remove"]),
    changed: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    messageId: MessageId,
    reason: Schema.Literal("channel-does-not-support-reactions"),
  }),
]);

export type OttoMessageReactionResult = typeof OttoMessageReactionResult.Type;

// SAFETY: Each decoder is compiled from the schema paired with that exact tool id; fromEntries loses the key/value correlation.
const OttoToolInputDecoders = Object.fromEntries(
  Object.entries(OttoToolInputSchemas).map(([toolId, schema]) => [
    toolId,
    Schema.decodeUnknownSync(schema),
  ]),
) as {
  [Name in OttoToolId]: ReturnType<
    typeof Schema.decodeUnknownSync<(typeof OttoToolInputSchemas)[Name]>
  >;
};

export function decodeOttoToolInput<Name extends OttoToolId>(
  toolId: Name,
  input: Parameters<(typeof OttoToolInputDecoders)[Name]>[0],
): (typeof OttoToolInputSchemas)[Name]["Type"] {
  // SAFETY: The cache indexes the decoder and return type by the same tool id, and the decoder validates the input.
  return OttoToolInputDecoders[toolId](input, {
    onExcessProperty: "error",
  }) as (typeof OttoToolInputSchemas)[Name]["Type"];
}
