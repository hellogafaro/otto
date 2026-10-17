import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./base-schemas.ts";
import { McpServer, McpServerId } from "./mcp-server.ts";
import {
  BotId,
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./base-schemas.ts";
import { BotSandbox, BotInstructions } from "./orchestration/roster.ts";
import { ApprovalResponder } from "./orchestration/work.ts";
import {
  ChatAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "./orchestration/attachments.ts";
import {
  ModelSelection,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration/model-selection.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./provider-instance.ts";

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  // populates it (post-slice-4), routing flips to instance-id-only and the
  // legacy `provider` field is removed.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  mcpServerIds: Schema.optional(Schema.Array(McpServerId)),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});

export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  botId: Schema.optional(BotId),
  botName: Schema.optional(TrimmedNonEmptyString),
  botInstructions: Schema.optional(BotInstructions),
  botSandbox: Schema.optional(Schema.NullOr(BotSandbox)),
  botSandboxEnvironment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  mcpServers: Schema.optional(Schema.Array(McpServer)),
  /** Server-owned system context fixed when the native provider session starts. */
  persistentMemoryContext: Schema.optional(Schema.String),
  /** Who is in the group chat this session answers in, for the bot's system context. */
  groupContext: Schema.optional(Schema.String),
  /** Otto: the project the chat is filed in, for the bot's system context. */
  projectContext: Schema.optional(Schema.String),
  /** The workspace (organization) the bot belongs to. */
  workspaceName: Schema.optional(Schema.String),
  /** The workspace's people and projects, for the bot's chat context. */
  workspaceContext: Schema.optional(Schema.String),
  runtimeMode: RuntimeMode,
});

export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
  /** Server-owned marker for an automatic hidden self-wake. */
  hiddenWake: Schema.optional(Schema.Boolean),
  timezone: Schema.optional(TrimmedNonEmptyString),
  /**
   * Server-owned context refreshed immediately before dispatch. Clients never
   * populate this field; provider adapters keep it separate from the user's
   * message while constructing their native prompt.
   */
  persistentMemoryContext: Schema.optional(Schema.String),
});

export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});

export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});

export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});

export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  responder: Schema.optional(ApprovalResponder),
});

export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});

export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

export const ComputerWatchInput = Schema.Struct({ threadId: ThreadId });

export type ComputerWatchInput = typeof ComputerWatchInput.Type;

/** A short-lived, secret-bearing link to the bot computer's live desktop. Never store or log it. */
export const ComputerWatchResult = Schema.Struct({ url: TrimmedNonEmptyString });

export type ComputerWatchResult = typeof ComputerWatchResult.Type;

export class ComputerWatchError extends Schema.TaggedErrorClass<ComputerWatchError>()(
  "ComputerWatchError",
  { message: Schema.String },
) {}

/** The chat's bot has no computer running right now, so there is nothing to watch yet. */
export class ComputerNotRunningError extends Schema.TaggedErrorClass<ComputerNotRunningError>()(
  "ComputerNotRunningError",
  { message: Schema.String },
) {}

export const ProviderUploadFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.optional(TrimmedNonEmptyString),
});

export type ProviderUploadFeedbackInput = typeof ProviderUploadFeedbackInput.Type;

export const ProviderUploadFeedbackResult = Schema.Struct({
  feedbackId: TrimmedNonEmptyString,
});

export type ProviderUploadFeedbackResult = typeof ProviderUploadFeedbackResult.Type;

export class ProviderUploadFeedbackError extends Schema.TaggedErrorClass<ProviderUploadFeedbackError>()(
  "ProviderUploadFeedbackError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to upload feedback for thread ${this.threadId}.`;
  }
}

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});

export type ProviderEvent = typeof ProviderEvent.Type;
