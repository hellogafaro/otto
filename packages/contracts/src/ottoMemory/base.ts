import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  BotId,
  IsoDateTime,
  MessageId,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const OTTO_MEMORY_PACKET_MAX_FACTS = 24;

export const OTTO_MEMORY_PACKET_MAX_CHARS = 12_000;

export const OTTO_MEMORY_PACKET_MAX_ESTIMATED_TOKENS = 3_000;

export const OTTO_MEMORY_FACT_MAX_CHARS = 2_048;

// New facts are capped. Stored revisions and candidates keep the uncapped
// shape so rows written before the cap still decode.
const OttoMemoryFactText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(OTTO_MEMORY_FACT_MAX_CHARS),
);

export const OTTO_USER_MEMORY_MAX_CHARS = 1_375;

export const OTTO_BOT_MEMORY_MAX_CHARS = 2_200;

export const OTTO_GROUP_MEMORY_MAX_CHARS = 2_200;

export const OttoMemoryId = TrimmedNonEmptyString.pipe(Schema.brand("OttoMemoryId"));

export type OttoMemoryId = typeof OttoMemoryId.Type;

export const OttoMemoryRootId = TrimmedNonEmptyString.pipe(Schema.brand("OttoMemoryRootId"));

export type OttoMemoryRootId = typeof OttoMemoryRootId.Type;

export const OttoMemoryCandidateId = TrimmedNonEmptyString.pipe(
  Schema.brand("OttoMemoryCandidateId"),
);

export type OttoMemoryCandidateId = typeof OttoMemoryCandidateId.Type;

export const OttoMemoryTenantId = TrimmedNonEmptyString.pipe(Schema.brand("OttoMemoryTenantId"));

export type OttoMemoryTenantId = typeof OttoMemoryTenantId.Type;

export const OttoMemoryUserId = TrimmedNonEmptyString.pipe(Schema.brand("OttoMemoryUserId"));

export type OttoMemoryUserId = typeof OttoMemoryUserId.Type;

export const OttoMemoryEntityId = TrimmedNonEmptyString.pipe(Schema.brand("OttoMemoryEntityId"));

export type OttoMemoryEntityId = typeof OttoMemoryEntityId.Type;

export const OttoMemoryPartitionId = TrimmedNonEmptyString.pipe(
  Schema.brand("OttoMemoryPartitionId"),
);

export type OttoMemoryPartitionId = typeof OttoMemoryPartitionId.Type;

export const OttoMemoryScope = Schema.Literals([
  "user",
  "bot-user",
  "bot",
  "project",
  "group",
  "workspace",
  "thread",
]);

export type OttoMemoryScope = typeof OttoMemoryScope.Type;

export const OttoMemoryVisibility = Schema.Literals(["private", "shared"]);

export type OttoMemoryVisibility = typeof OttoMemoryVisibility.Type;

export const OttoMemoryApprovalState = Schema.Literals(["pending", "approved", "rejected"]);

export type OttoMemoryApprovalState = typeof OttoMemoryApprovalState.Type;

export const OttoMemoryCandidateStatus = Schema.Literals(["pending", "approved", "rejected"]);

export type OttoMemoryCandidateStatus = typeof OttoMemoryCandidateStatus.Type;

export const OttoMemoryCandidateUpdate = Schema.Struct({
  rootId: OttoMemoryRootId,
  expectedRevision: PositiveInt,
});

export type OttoMemoryCandidateUpdate = typeof OttoMemoryCandidateUpdate.Type;

export const OttoMemoryTargetScope = Schema.Literals([
  "private",
  "bot",
  "project",
  "group",
  "workspace",
]);

export type OttoMemoryTargetScope = typeof OttoMemoryTargetScope.Type;

export const OttoMemoryDeletionState = Schema.Literals(["active", "tombstoned", "deleted"]);

export type OttoMemoryDeletionState = typeof OttoMemoryDeletionState.Type;

export const OttoMemoryKind = Schema.Literals([
  "fact",
  "preference",
  "identity",
  "relationship",
  "routine",
  "instruction",
]);

export type OttoMemoryKind = typeof OttoMemoryKind.Type;

export const OttoMemoryEntityKind = Schema.Literals([
  "user",
  "bot",
  "person",
  "project",
  "group",
  "workspace",
  "other",
]);

export type OttoMemoryEntityKind = typeof OttoMemoryEntityKind.Type;

export const OttoMemoryConfidence = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

export type OttoMemoryConfidence = typeof OttoMemoryConfidence.Type;

export const OttoMemoryPartition = Schema.Struct({
  tenantId: OttoMemoryTenantId,
  scope: OttoMemoryScope,
  partitionId: OttoMemoryPartitionId,
});

export type OttoMemoryPartition = typeof OttoMemoryPartition.Type;

export const OttoMemoryRevision = Schema.Struct({
  id: OttoMemoryId,
  rootId: OttoMemoryRootId,
  revision: PositiveInt,
  partition: OttoMemoryPartition,
  entityKind: OttoMemoryEntityKind,
  entityId: OttoMemoryEntityId,
  kind: OttoMemoryKind,
  value: Schema.Record(Schema.String, Schema.Unknown),
  fact: TrimmedNonEmptyString,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceMessageId: Schema.NullOr(MessageId),
  authorBotId: Schema.NullOr(BotId),
  initiatingUserId: OttoMemoryUserId,
  createdAt: IsoDateTime,
  confirmedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  confidence: OttoMemoryConfidence,
  approvalState: OttoMemoryApprovalState,
  supersedesId: Schema.NullOr(OttoMemoryId),
  supersededById: Schema.NullOr(OttoMemoryId),
  visibility: OttoMemoryVisibility,
  deletionState: OttoMemoryDeletionState,
  pinned: Schema.Boolean,
  sensitive: Schema.Boolean,
  affectedBotIds: Schema.Array(BotId),
});

export type OttoMemoryRevision = typeof OttoMemoryRevision.Type;

export const OttoMemoryCandidate = Schema.Struct({
  candidateId: OttoMemoryCandidateId,
  tenantId: OttoMemoryTenantId,
  initiatingUserId: OttoMemoryUserId,
  sourceThreadId: ThreadId,
  sourceMessageId: Schema.NullOr(MessageId),
  authorBotId: Schema.NullOr(BotId),
  fact: TrimmedNonEmptyString,
  scope: OttoMemoryTargetScope,
  sensitive: Schema.Boolean,
  confidence: OttoMemoryConfidence,
  affectedBotIds: Schema.Array(BotId),
  pendingUpdate: Schema.NullOr(OttoMemoryCandidateUpdate).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: OttoMemoryCandidateStatus,
  createdAt: IsoDateTime,
  decidedAt: Schema.NullOr(IsoDateTime),
  decidedMemoryRootId: Schema.NullOr(OttoMemoryRootId),
});

export type OttoMemoryCandidate = typeof OttoMemoryCandidate.Type;

export const OttoMemoryCandidateDecision = Schema.Union([
  Schema.Struct({
    candidateId: OttoMemoryCandidateId,
    decision: Schema.Literal("approve"),
    fact: Schema.optional(OttoMemoryFactText),
    scope: Schema.optional(OttoMemoryTargetScope),
  }),
  Schema.Struct({
    candidateId: OttoMemoryCandidateId,
    decision: Schema.Literal("reject"),
  }),
]);

export type OttoMemoryCandidateDecision = typeof OttoMemoryCandidateDecision.Type;

export const OttoMemoryDecisionReceipt = Schema.Struct({
  candidateId: OttoMemoryCandidateId,
  status: Schema.Literals(["approved", "rejected"]),
  fact: OttoMemoryFactText,
  scope: OttoMemoryTargetScope,
  affectedBotIds: Schema.Array(BotId),
  memoryRootId: Schema.NullOr(OttoMemoryRootId),
  createdAt: IsoDateTime,
});

export type OttoMemoryDecisionReceipt = typeof OttoMemoryDecisionReceipt.Type;

// Thread activity kinds for shared-memory approvals. A requested activity with
// no resolved activity for the same candidate is a pending approval card.
export const OTTO_MEMORY_APPROVAL_REQUESTED_ACTIVITY = "memory.approval.requested";

export const OTTO_MEMORY_APPROVAL_RESOLVED_ACTIVITY = "memory.approval.resolved";

export const OttoMemoryApprovalRequest = Schema.Struct({
  candidateId: OttoMemoryCandidateId,
  fact: OttoMemoryFactText,
  scope: OttoMemoryTargetScope,
  sensitive: Schema.Boolean,
  sourceThreadId: ThreadId,
  authorBotId: Schema.NullOr(BotId),
  affectedBotIds: Schema.Array(BotId),
});

export type OttoMemoryApprovalRequest = typeof OttoMemoryApprovalRequest.Type;
