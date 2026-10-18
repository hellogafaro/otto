import {
  TaskCreateCommand,
  TaskTimeAddCommand,
  TaskTimeRemoveCommand,
  TaskUpdateCommand,
} from "./work.ts";
import { TaskCommentAddCommand } from "./activity.ts";
import {
  LibraryFileCreateCommand,
  LibraryFileDeleteCommand,
  LibraryFileUpdateCommand,
  LibraryFolderCreateCommand,
  LibraryFolderDeleteCommand,
  LibraryFolderUpdateCommand,
} from "./library.ts";
import * as Schema from "effect/Schema";
import {
  BotId,
  CheckpointRef,
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "../base-schemas.ts";
import { OttoDelegationRecord } from "../otto-delegation.ts";
import { ClientRoutineCommand, InternalRoutineCommand } from "../routines.ts";
import { ChatAttachment } from "./attachments.ts";
import {
  ChannelDeliveryState,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationThreadActivity,
} from "./thread.ts";
import {
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  BotCreateCommand,
  BotUpdateCommand,
  ClientBotUpdateCommand,
  BotArchiveCommand,
  BotRestoreCommand,
  BotDeleteCommand,
  ChannelConnectCommand,
  ChannelConnectionSaveCommand,
  ChannelConnectionDeleteCommand,
  ChannelAttachCommand,
  ChannelDisconnectCommand,
  ChannelDetachCommand,
  ChannelReconnectCommand,
  ChannelChangeProjectCommand,
  ChannelSendCommand,
  GroupCreateCommand,
  GroupRenameCommand,
  GroupDeleteCommand,
  GroupMemberAssignCommand,
  GroupMemberUnassignCommand,
  GroupPersonAssignCommand,
  GroupPersonUnassignCommand,
  GroupLeaveCommand,
  GroupBossSetCommand,
  McpServerCreateCommand,
  McpServerUpdateCommand,
  McpServerInstructionsSetCommand,
  McpServerDeleteCommand,
  McpServerEnableCommand,
  McpServerDisableCommand,
  McpServerAccessSetCommand,
} from "./roster-commands.ts";
import {
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadPinCommand,
  ThreadUnpinCommand,
  ThreadPinReorderCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnResumeCommand,
  ClientThreadTurnStartCommand,
  ThreadVoiceTranscriptAppendCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  DelegationCancelCommand,
  DelegationRetryCommand,
  ThreadMessageReactionSetCommand,
} from "./thread-commands.ts";

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  TaskCreateCommand,
  TaskUpdateCommand,
  TaskTimeAddCommand,
  TaskTimeRemoveCommand,
  LibraryFolderCreateCommand,
  LibraryFolderUpdateCommand,
  LibraryFolderDeleteCommand,
  LibraryFileUpdateCommand,
  LibraryFileDeleteCommand,
  BotCreateCommand,
  BotUpdateCommand,
  BotArchiveCommand,
  BotRestoreCommand,
  BotDeleteCommand,
  GroupCreateCommand,
  GroupRenameCommand,
  GroupDeleteCommand,
  GroupMemberAssignCommand,
  GroupMemberUnassignCommand,
  GroupPersonAssignCommand,
  GroupPersonUnassignCommand,
  GroupLeaveCommand,
  GroupBossSetCommand,
  McpServerCreateCommand,
  McpServerUpdateCommand,
  McpServerInstructionsSetCommand,
  McpServerDeleteCommand,
  McpServerEnableCommand,
  McpServerDisableCommand,
  McpServerAccessSetCommand,
  ClientRoutineCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadPinCommand,
  ThreadUnpinCommand,
  ThreadPinReorderCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnResumeCommand,
  ThreadVoiceTranscriptAppendCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageReactionSetCommand,
  ThreadSessionStopCommand,
  DelegationCancelCommand,
  DelegationRetryCommand,
]);

export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  TaskCreateCommand,
  TaskUpdateCommand,
  TaskTimeAddCommand,
  TaskTimeRemoveCommand,
  LibraryFolderCreateCommand,
  LibraryFolderUpdateCommand,
  LibraryFolderDeleteCommand,
  LibraryFileUpdateCommand,
  LibraryFileDeleteCommand,
  BotCreateCommand,
  ClientBotUpdateCommand,
  BotArchiveCommand,
  BotRestoreCommand,
  BotDeleteCommand,
  ChannelConnectCommand,
  ChannelConnectionSaveCommand,
  ChannelConnectionDeleteCommand,
  ChannelAttachCommand,
  ChannelDisconnectCommand,
  ChannelDetachCommand,
  ChannelReconnectCommand,
  ChannelChangeProjectCommand,
  ChannelSendCommand,
  GroupCreateCommand,
  GroupRenameCommand,
  GroupDeleteCommand,
  GroupMemberAssignCommand,
  GroupMemberUnassignCommand,
  GroupPersonAssignCommand,
  GroupPersonUnassignCommand,
  GroupLeaveCommand,
  GroupBossSetCommand,
  McpServerCreateCommand,
  McpServerUpdateCommand,
  McpServerInstructionsSetCommand,
  McpServerDeleteCommand,
  McpServerEnableCommand,
  McpServerDisableCommand,
  McpServerAccessSetCommand,
  ClientRoutineCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadPinCommand,
  ThreadUnpinCommand,
  ThreadPinReorderCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnResumeCommand,
  ThreadVoiceTranscriptAppendCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageReactionSetCommand,
  ThreadSessionStopCommand,
  DelegationCancelCommand,
  DelegationRetryCommand,
]);

export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.optional(TurnId),
  /** Attributes a server-authored message to this bot instead of the thread's responder. */
  respondingBotId: Schema.optional(BotId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  respondingBotId: Schema.optional(BotId),
  createdAt: IsoDateTime,
});

const ThreadChannelDeliverySetCommand = Schema.Struct({
  type: Schema.Literal("thread.channel-delivery.set"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delivery: ChannelDeliveryState,
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadHistoryRestoreCommand = Schema.Struct({
  type: Schema.Literal("thread.history.restore"),
  commandId: CommandId,
  threadId: ThreadId,
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan),
  activities: Schema.Array(OrchestrationThreadActivity),
  snoozedUntil: Schema.NullOr(IsoDateTime),
  snoozedAt: Schema.NullOr(IsoDateTime),
  pinnedAt: Schema.NullOr(IsoDateTime),
  pinOrderKey: Schema.NullOr(TrimmedNonEmptyString),
  archivedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadTitleRegenerationCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.title.regeneration.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: CommandId,
  title: Schema.optional(TrimmedNonEmptyString),
});

/** Starts one bot's turn in a group round. Sent by the server, never by clients. */
const ThreadGroupTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.group-turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  botId: BotId,
  /** The newest person message the round answers. */
  messageId: MessageId,
  /** What this bot receives instead of that message's text. */
  input: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  createdAt: IsoDateTime,
});

export const DelegationCreateCommand = Schema.Struct({
  type: Schema.Literal("delegation.create"),
  commandId: CommandId,
  delegation: Schema.suspend(() => OttoDelegationRecord),
});

export const DelegationStateSetCommand = Schema.Struct({
  type: Schema.Literal("delegation.state.set"),
  commandId: CommandId,
  delegation: Schema.suspend(() => OttoDelegationRecord),
});

const InternalOrchestrationCommand = Schema.Union([
  InternalRoutineCommand,
  TaskCommentAddCommand,
  LibraryFileCreateCommand,
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadChannelDeliverySetCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadHistoryRestoreCommand,
  ThreadRevertCompleteCommand,
  ThreadTitleRegenerationCompleteCommand,
  ThreadGroupTurnStartCommand,
  DelegationCreateCommand,
  DelegationStateSetCommand,
]);

export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);

export type OrchestrationCommand = typeof OrchestrationCommand.Type;
