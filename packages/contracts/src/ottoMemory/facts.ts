import * as Schema from "effect/Schema";
import {
  BotId,
  GroupId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import {
  OTTO_MEMORY_PACKET_MAX_FACTS,
  OTTO_MEMORY_PACKET_MAX_CHARS,
  OTTO_MEMORY_PACKET_MAX_ESTIMATED_TOKENS,
  OttoMemoryRootId,
  OttoMemoryTenantId,
  OttoMemoryUserId,
  OttoMemoryScope,
  OttoMemoryApprovalState,
  OttoMemoryTargetScope,
  OttoMemoryDeletionState,
  OttoMemoryKind,
  OttoMemoryConfidence,
  OttoMemoryRevision,
  OttoMemoryCandidateDecision,
  OttoMemoryDecisionReceipt,
} from "./base.ts";
import { OttoMemoryArchiveTarget } from "./transfer.ts";

export const OttoMemoryMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("candidate.decide"),
    decision: OttoMemoryCandidateDecision,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.edit"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
    fact: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.pin"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
    pinned: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.scope"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
    scope: OttoMemoryTargetScope,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.decide"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
    decision: Schema.Literals(["approve", "reject"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.forget"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.delete"),
    memoryId: OttoMemoryRootId,
    expectedRevision: PositiveInt,
  }),
  Schema.Struct({ operation: Schema.Literal("conversation.clear") }),
]);

export type OttoMemoryMutation = typeof OttoMemoryMutation.Type;

export const OttoMemoryMutateInput = Schema.Struct({
  threadId: ThreadId,
  mutation: OttoMemoryMutation,
});

export type OttoMemoryMutateInput = typeof OttoMemoryMutateInput.Type;

export const OttoMemoryMutationResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("candidate"), receipt: OttoMemoryDecisionReceipt }),
  Schema.Struct({ kind: Schema.Literal("revision"), revision: OttoMemoryRevision }),
  Schema.Struct({ kind: Schema.Literal("deleted"), memoryId: OttoMemoryRootId }),
  Schema.Struct({ kind: Schema.Literal("conversation-cleared") }),
]);

export type OttoMemoryMutationResult = typeof OttoMemoryMutationResult.Type;

export const OttoMemoryFactsListInput = Schema.Struct({
  threadId: ThreadId,
  target: OttoMemoryArchiveTarget,
});

export type OttoMemoryFactsListInput = typeof OttoMemoryFactsListInput.Type;

export const OttoMemoryFactRead = Schema.Struct({
  rootId: OttoMemoryRootId,
  fact: TrimmedNonEmptyString,
  scope: OttoMemoryScope,
  sourceThreadId: Schema.NullOr(ThreadId),
  affectedBotIds: Schema.Array(BotId),
  approvalState: OttoMemoryApprovalState,
  deletionState: OttoMemoryDeletionState,
  pinned: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: PositiveInt,
  supersededFact: Schema.NullOr(Schema.String),
});

export type OttoMemoryFactRead = typeof OttoMemoryFactRead.Type;

export const OttoMemoryFactsListResult = Schema.Struct({
  facts: Schema.Array(OttoMemoryFactRead),
});

export type OttoMemoryFactsListResult = typeof OttoMemoryFactsListResult.Type;

export class OttoMemoryOperationError extends Schema.TaggedErrorClass<OttoMemoryOperationError>()(
  "OttoMemoryOperationError",
  { operation: TrimmedNonEmptyString, detail: TrimmedNonEmptyString },
) {}

export const OttoMemoryPacketFact = Schema.Struct({
  memoryId: OttoMemoryRootId,
  expectedRevision: PositiveInt,
  scope: OttoMemoryScope,
  kind: OttoMemoryKind,
  fact: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
  confidence: OttoMemoryConfidence,
  updatedAt: IsoDateTime,
});

export type OttoMemoryPacketFact = typeof OttoMemoryPacketFact.Type;

export const OttoMemoryPacket = Schema.Struct({
  threadId: ThreadId,
  facts: Schema.Array(OttoMemoryPacketFact).check(Schema.isMaxLength(OTTO_MEMORY_PACKET_MAX_FACTS)),
  estimatedTokens: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(OTTO_MEMORY_PACKET_MAX_ESTIMATED_TOKENS),
  ),
  rendered: Schema.String.check(Schema.isMaxLength(OTTO_MEMORY_PACKET_MAX_CHARS)),
});

export type OttoMemoryPacket = typeof OttoMemoryPacket.Type;

export const OttoMemoryThreadAccess = Schema.Struct({
  tenantId: OttoMemoryTenantId,
  userId: OttoMemoryUserId,
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  legacyWorkspaceOwnerProjectId: Schema.optional(ProjectId),
  botId: Schema.NullOr(BotId),
  groupId: Schema.NullOr(GroupId),
  respondingBotId: Schema.NullOr(BotId),
  groupMemberBotIds: Schema.Array(BotId),
});

export type OttoMemoryThreadAccess = typeof OttoMemoryThreadAccess.Type;
