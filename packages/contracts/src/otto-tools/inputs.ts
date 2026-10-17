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
import { LibraryFileId, LibraryFolderId, LibraryTitle } from "../orchestration/library.ts";
import {
  TaskDueDate,
  WorkDescription,
  WorkParticipantKey,
  WorkStatus,
  WorkTitle,
} from "../orchestration/work.ts";
import { ActivityContent } from "../orchestration/activity.ts";
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

/** Otto: Someone work goes to: `me` for the calling bot, or a `bot:…` / `person:…` key. */
const TaskParticipantRef = Schema.Union([Schema.Literal("me"), WorkParticipantKey]);

const TaskToolFields = {
  description: Schema.optional(WorkDescription),
  status: Schema.optional(WorkStatus),
  dueDate: Schema.optional(Schema.NullOr(TaskDueDate)),
  assignees: Schema.optional(Schema.Array(TaskParticipantRef).check(Schema.isMaxLength(20))),
};

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
    query: Schema.optional(TrimmedNonEmptyString),
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
  library_create: SaveToLibraryInput,
  library_read: Schema.Struct({ fileId: LibraryFileId }),
  library_update: Schema.Struct({
    fileId: LibraryFileId,
    content: LibraryText,
    updatedAt: IsoDateTime,
    title: Schema.optional(LibraryTitle),
  }),
  skill_read: Schema.Struct({
    skillId: LibraryFolderId,
    path: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
  }),
  task_read: Schema.Struct({ taskId: TaskId }),
  task_create: Schema.Struct({
    title: WorkTitle,
    projectId: Schema.optional(ProjectId),
    ...TaskToolFields,
  }),
  task_update: Schema.Struct({
    taskId: TaskId,
    title: Schema.optional(WorkTitle),
    projectId: Schema.optional(ProjectId),
    ...TaskToolFields,
  }),
  task_comment: Schema.Struct({ taskId: TaskId, content: ActivityContent }),
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
