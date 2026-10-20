import {
  ApprovalResponder,
  RoutineWake,
  TaskWake,
  WorkDescription,
  WorkParticipant,
  WorkResources,
  WorkStatus,
} from "./work.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RepositoryIdentity, ThreadEnvMode } from "../environment.ts";
import {
  ApprovalRequestId,
  AuthSessionId,
  BotId,
  CheckpointRef,
  GroupId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
  Visibility,
} from "../base-schemas.ts";
import { McpServer, McpServerId } from "../mcp-server.ts";
import { OttoDelegationRecord } from "../otto-delegation.ts";
import { ImageProviderId } from "../image-generation.ts";
import { LibraryFileId, LibraryFolderId } from "./library.ts";
import { DelegationIdSchema } from "./identities.ts";
import {
  ModelSelection,
  RuntimeMode,
  DEFAULT_RUNTIME_MODE,
  ProviderInteractionMode,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "./model-selection.ts";
import { ChatAttachment } from "./attachments.ts";
import {
  ProjectScript,
  ProjectFaviconPath,
  BotAvatar,
  BotEngine,
  PersistedBotSandbox,
  SandboxSize,
  BotInstructions,
  BotAlwaysAllowedTool,
  ChannelBinding,
  GroupBotMembership,
  GroupPersonMembership,
  GroupMembership,
} from "./roster.ts";
import {
  ChannelMessageOrigin,
  ChannelDeliveryState,
  OrchestrationMessageRole,
  OrchestrationProposedPlan,
  SourceProposedPlanReference,
  OrchestrationSession,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationThreadActivity,
  ThreadTitleRegeneration,
  ThreadLinkedPullRequest,
} from "./thread.ts";

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "task.created",
  "task.updated",
  "task.time-added",
  "task.time-removed",
  "task.commented",
  "library.folder-created",
  "library.folder-updated",
  "library.folder-deleted",
  "library.file-created",
  "library.file-updated",
  "library.file-deleted",
  "bot.created",
  "bot.updated",
  "bot.archived",
  "bot.restored",
  "bot.deleted",
  "group.created",
  "group.renamed",
  "group.deleted",
  "group.member-assigned",
  "group.member-unassigned",
  "group.person-assigned",
  "group.person-unassigned",
  "group.boss-set",
  "mcp-server.created",
  "mcp-server.updated",
  "mcp-server.deleted",
  "mcp-server.enabled",
  "mcp-server.disabled",
  "routine.drafted",
  "routine.approved",
  "routine.enabled",
  "routine.running",
  "routine.paused",
  "routine.blocked",
  "routine.failed",
  "routine.completed",
  "routine.run-canceled",
  "routine.updated",
  "routine.deleted",
  "skill-assignment.assigned",
  "skill-assignment.unassigned",
  "thread.created",
  "thread.ownership-updated",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.pinned",
  "thread.unpinned",
  "thread.pin-reordered",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.channel-delivery-set",
  "thread.message-reaction-set",
  "thread.turn-start-requested",
  "thread.turn-resume-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "delegation.created",
  "delegation.updated",
  "delegation.retry-requested",
]);

export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals([
  "project",
  "task",
  "library-folder",
  "library-file",
  "bot",
  "group",
  "mcp-server",
  "routine",
  "routine-run",
  "skill-assignment",
  "thread",
  "delegation",
]);

export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;

export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  // Optional so persisted events from older servers still decode.
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.Array(ProjectScript),
  description: Schema.optional(WorkDescription),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  resources: Schema.optional(WorkResources),
  status: Schema.optional(WorkStatus),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  description: Schema.optional(WorkDescription),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  resources: Schema.optional(WorkResources),
  status: Schema.optional(WorkStatus),
  coverFileId: Schema.optional(Schema.NullOr(LibraryFileId)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const BotCreatedPayload = Schema.Struct({
  botId: BotId,
  name: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  label: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  description: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  instructions: Schema.NullOr(BotInstructions).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  disabledMcpServerIds: Schema.Array(McpServerId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  disabledSkillIds: Schema.optional(Schema.Array(LibraryFolderId)),
  owner: Schema.NullOr(WorkParticipant).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  visibility: Schema.optional(Visibility),
  avatar: BotAvatar,
  engine: Schema.NullOr(BotEngine),
  sandbox: PersistedBotSandbox,
  sandboxSize: Schema.NullOr(SandboxSize).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  imageProvider: Schema.NullOr(ImageProviderId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  voiceEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  channelBindings: Schema.Array(ChannelBinding).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  groupId: Schema.NullOr(GroupId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const BotUpdatedPayload = Schema.Struct({
  botId: BotId,
  name: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.NullOr(BotInstructions)),
  disabledMcpServerIds: Schema.optional(Schema.Array(McpServerId)),
  disabledSkillIds: Schema.optional(Schema.Array(LibraryFolderId)),
  alwaysAllowed: Schema.optional(Schema.Array(BotAlwaysAllowedTool)),
  owner: Schema.optional(Schema.NullOr(WorkParticipant)),
  visibility: Schema.optional(Visibility),
  avatar: Schema.optional(BotAvatar),
  engine: Schema.optional(Schema.NullOr(BotEngine)),
  sandbox: Schema.optional(PersistedBotSandbox),
  sandboxSize: Schema.optional(Schema.NullOr(SandboxSize)),
  runtimeMode: Schema.optional(RuntimeMode),
  imageProvider: Schema.optional(Schema.NullOr(ImageProviderId)),
  voiceEnabled: Schema.optional(Schema.Boolean),
  channelBindings: Schema.optional(Schema.Array(ChannelBinding)),
  groupId: Schema.optional(Schema.NullOr(GroupId)),
  updatedAt: IsoDateTime,
});

export const BotArchivedPayload = Schema.Struct({
  botId: BotId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const BotRestoredPayload = Schema.Struct({
  botId: BotId,
  updatedAt: IsoDateTime,
});

export const BotDeletedPayload = Schema.Struct({
  botId: BotId,
  deletedAt: IsoDateTime,
});

export const GroupCreatedPayload = Schema.Struct({
  groupId: GroupId,
  name: TrimmedNonEmptyString,
  // Defaults keep pre-membership group.created events replayable.
  bossBotId: Schema.NullOr(BotId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  members: Schema.Array(GroupMembership).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const GroupRenamedPayload = Schema.Struct({
  groupId: GroupId,
  name: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const GroupDeletedPayload = Schema.Struct({
  groupId: GroupId,
  deletedAt: IsoDateTime,
});

export const GroupMemberAssignedPayload = Schema.Struct({
  groupId: GroupId,
  member: GroupBotMembership,
  updatedAt: IsoDateTime,
});

export const GroupMemberUnassignedPayload = Schema.Struct({
  groupId: GroupId,
  botId: BotId,
  updatedAt: IsoDateTime,
});

export const GroupPersonAssignedPayload = Schema.Struct({
  groupId: GroupId,
  person: GroupPersonMembership,
  updatedAt: IsoDateTime,
});

export const GroupPersonUnassignedPayload = Schema.Struct({
  groupId: GroupId,
  personId: AuthSessionId,
  updatedAt: IsoDateTime,
});

export const GroupBossSetPayload = Schema.Struct({
  groupId: GroupId,
  bossBotId: BotId,
  previousBossBotId: Schema.NullOr(BotId),
  previousBossRole: Schema.NullOr(Schema.Literals(["specialist", "unassigned"])),
  updatedAt: IsoDateTime,
});

export const McpServerCreatedPayload = Schema.Struct({
  mcpServer: McpServer,
});

export const McpServerUpdatedPayload = Schema.Struct({
  mcpServer: McpServer,
});

export const McpServerDeletedPayload = Schema.Struct({
  mcpServerId: McpServerId,
  deletedAt: IsoDateTime,
});

export const McpServerEnabledPayload = Schema.Struct({
  mcpServer: McpServer,
});

export const McpServerDisabledPayload = Schema.Struct({
  mcpServer: McpServer,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  botId: Schema.optional(Schema.NullOr(BotId)),
  groupId: Schema.optional(Schema.NullOr(GroupId)),
  /** Otto: The other person in a person-to-person DM; no bot answers there. */
  personId: Schema.optional(Schema.NullOr(AuthSessionId)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  parentDelegationId: Schema.optional(Schema.NullOr(DelegationIdSchema)),
  /** Otto: The person who started the chat; null for server-started chats and older ones. */
  createdBy: Schema.optional(Schema.NullOr(AuthSessionId)),
  /** Otto: `user` shows a DM only to its creator; absent reads as `organization`. */
  visibility: Schema.optional(Visibility),
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadOwnershipUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  botId: Schema.NullOr(BotId),
  groupId: Schema.NullOr(GroupId),
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadSnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  snoozedUntil: IsoDateTime,
  snoozedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  // user: explicit "wake now". activity: real work arrived (user message /
  // session coming alive) and the decider cleared the snooze. Timer wakes emit no event: clients
  // derive them from snoozedUntil passing.
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadPinnedPayload = Schema.Struct({
  threadId: ThreadId,
  pinnedAt: IsoDateTime,
  // Absent on re-pins of an already-pinned thread (the existing key wins)
  // and on pins from clients that predate reordering.
  pinOrderKey: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ThreadUnpinnedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadPinReorderedPayload = Schema.Struct({
  threadId: ThreadId,
  orderKey: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  /** Intent marker consumed by the title-generation reactor. Keeping this on
      the existing event lets older clients safely ignore the new field. */
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  /** Title at request time, used to avoid overwriting a later manual rename. */
  previousTitle: Schema.optional(TrimmedNonEmptyString),
  /** Pending state shared with clients. Null clears a matching request. */
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  visibility: Schema.optional(Visibility),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  respondingBotId: Schema.optional(Schema.NullOr(BotId)),
  authorPersonId: Schema.optional(Schema.NullOr(AuthSessionId)),
  authorDisplayName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  channelOrigin: Schema.optional(Schema.NullOr(ChannelMessageOrigin)),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadChannelDeliverySetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  delivery: ChannelDeliveryState,
  updatedAt: IsoDateTime,
});

export const ThreadMessageReactionSetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  botId: Schema.optional(BotId),
  personId: Schema.optional(AuthSessionId),
  emoji: TrimmedNonEmptyString,
  present: Schema.Boolean,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  hiddenWake: Schema.optional(Schema.Boolean),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  respondingBotId: Schema.optional(Schema.NullOr(BotId)),
  /** A group round's input, sent instead of the message's own text and attachments. */
  groupInput: Schema.optional(
    Schema.Struct({ text: Schema.String, attachments: Schema.Array(ChatAttachment) }),
  ),
  /** A task event, sent to the bot as signals instead of the message's own text. */
  taskWake: Schema.optional(TaskWake),
  /** A routine run, sent to the bot as a signal instead of the message's own text. */
  routineWake: Schema.optional(RoutineWake),
  timezone: Schema.optional(TrimmedNonEmptyString),
  /**
   * Finished child delegations acknowledged by this turn start. The same
   * durable step stamps their acknowledgedAt, and the provider turn receives
   * their results as context, so each result reaches the parent exactly once.
   */
  acknowledgedDelegationIds: Schema.optional(
    Schema.Array(Schema.suspend(() => DelegationIdSchema)),
  ),
  createdAt: IsoDateTime,
});

export const ThreadTurnResumeRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  responder: Schema.optional(ApprovalResponder),
  createdAt: IsoDateTime,
});

export const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const DelegationCreatedPayload = Schema.Struct({
  delegation: Schema.suspend(() => OttoDelegationRecord),
});

export const DelegationUpdatedPayload = DelegationCreatedPayload;

export const DelegationRetryRequestedPayload = Schema.Struct({
  delegationId: Schema.suspend(() => DelegationIdSchema),
  parentThreadId: ThreadId,
  createdAt: IsoDateTime,
});
