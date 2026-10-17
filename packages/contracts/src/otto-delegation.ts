import * as Match from "effect/Match";
import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  BotId,
  IsoDateTime,
  MessageId,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./base-schemas.ts";
import { McpServerId } from "./mcp-server.ts";
import { BotSandbox } from "./orchestration/roster.ts";
import { RuntimeMode } from "./orchestration/model-selection.ts";

const DelegationPhase = Data.taggedEnum<OttoDelegationPhase>();

export const OTTO_DELEGATION_MAX_DEPTH = 2;

export const OTTO_DELEGATION_MAX_CONCURRENCY = 3;

export const DelegationId = TrimmedNonEmptyString.pipe(Schema.brand("DelegationId"));

export type DelegationId = typeof DelegationId.Type;

/** @deprecated Lifecycle records use OttoDelegationPhase. */
export const OttoDelegationState = Schema.Literals([
  "queued",
  "running",
  "blocked",
  "failed",
  "canceled",
  "completed",
]);

export type OttoDelegationState = typeof OttoDelegationState.Type;

/** Whether a delegation has finished and can no longer change state. */
export const isTerminalDelegationState = (state: OttoDelegationState): boolean =>
  state === "completed" || state === "failed" || state === "canceled";

/**
 * Finished delegations a shell snapshot keeps per parent thread, newest first.
 * Open delegations are always kept.
 */
export const SHELL_RECENT_TERMINAL_DELEGATIONS_PER_THREAD = 20;

/** What started a delegation: a parent bot's tool call or a scheduled routine. */
export const OttoDelegationTrigger = Schema.Literals(["bot", "scheduled"]);

export type OttoDelegationTrigger = typeof OttoDelegationTrigger.Type;

/** The target bot's own settings when the work started. */
export const OttoDelegationAccessGrant = Schema.Struct({
  sandbox: Schema.NullOr(Schema.suspend((): Schema.Codec<BotSandbox> => BotSandbox)),
  runtimeMode: Schema.suspend((): Schema.Codec<RuntimeMode> => RuntimeMode),
  enabledMcpServerIds: Schema.Array(McpServerId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  disabledMcpServerIds: Schema.Array(McpServerId),
});

export type OttoDelegationAccessGrant = typeof OttoDelegationAccessGrant.Type;

export const OttoDelegationFailureCode = Schema.Literals([
  "timeout",
  "denied",
  "child_failed",
  "parent_failed",
  "internal",
]);

export type OttoDelegationFailureCode = typeof OttoDelegationFailureCode.Type;

export const OttoDelegationResult = Schema.Struct({
  summary: TrimmedNonEmptyString,
  childThreadId: ThreadId,
  childTurnId: Schema.NullOr(TurnId),
});

export type OttoDelegationResult = typeof OttoDelegationResult.Type;

export const OttoDelegationFailure = Schema.Struct({
  failureCode: OttoDelegationFailureCode,
  message: TrimmedNonEmptyString,
});

export type OttoDelegationFailure = typeof OttoDelegationFailure.Type;

const OttoDelegationRecordFields = {
  delegationId: DelegationId,
  parentDelegationId: Schema.NullOr(DelegationId),
  parentBotId: BotId,
  childBotId: BotId,
  parentThreadId: ThreadId,
  parentTurnId: TurnId,
  ancestorBotIds: Schema.Array(BotId),
  depth: PositiveInt.check(Schema.isLessThanOrEqualTo(OTTO_DELEGATION_MAX_DEPTH)),
  task: TrimmedNonEmptyString,
  expectedResult: TrimmedNonEmptyString,
  access: OttoDelegationAccessGrant,
  billedBotId: BotId,
  keep: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Parent chat message the work card sits under. Null places it by parentTurnId. */
  anchorMessageId: Schema.NullOr(MessageId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** The Failed or Canceled delegation this one retries. The original is never mutated. */
  retryOfDelegationId: Schema.NullOr(DelegationId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  trigger: OttoDelegationTrigger.pipe(Schema.withDecodingDefault(Effect.succeed("bot" as const))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;

export const OttoDelegationPhase = Schema.TaggedUnion({
  Queued: {},
  Running: {
    childThreadId: ThreadId,
    childTurnId: Schema.NullOr(TurnId),
    startedAt: IsoDateTime,
    progress: Schema.NullOr(TrimmedNonEmptyString),
  },
  Blocked: {
    childThreadId: ThreadId,
    childTurnId: Schema.NullOr(TurnId),
    startedAt: IsoDateTime,
    reason: TrimmedNonEmptyString,
  },
  Completed: {
    childThreadId: ThreadId,
    childTurnId: Schema.NullOr(TurnId),
    startedAt: IsoDateTime,
    completedAt: IsoDateTime,
    result: OttoDelegationResult,
    acknowledgedAt: Schema.NullOr(IsoDateTime),
  },
  Failed: {
    childThreadId: Schema.NullOr(ThreadId),
    childTurnId: Schema.NullOr(TurnId),
    startedAt: Schema.NullOr(IsoDateTime),
    completedAt: IsoDateTime,
    failure: OttoDelegationFailure,
    acknowledgedAt: Schema.NullOr(IsoDateTime).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
  },
  Canceled: {
    childThreadId: Schema.NullOr(ThreadId),
    childTurnId: Schema.NullOr(TurnId),
    startedAt: Schema.NullOr(IsoDateTime),
    completedAt: IsoDateTime,
    canceledBy: Schema.Literals(["user", "parent-bot", "parent-turn-failed"]),
  },
});

export type OttoDelegationPhase = typeof OttoDelegationPhase.Type;

const TaggedDelegationRecord = Schema.Struct({
  ...OttoDelegationRecordFields,
  phase: OttoDelegationPhase,
});

const LegacyDelegationRecord = Schema.Struct({
  ...OttoDelegationRecordFields,
  childThreadId: Schema.NullOr(ThreadId),
  childTurnId: Schema.NullOr(TurnId),
  state: Schema.Literals(["queued", "running", "blocked", "failed", "canceled", "completed"]),
  result: Schema.NullOr(OttoDelegationResult),
  failure: Schema.NullOr(OttoDelegationFailure),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  // Phase details the flat wire form carries so replay keeps them. Older clients ignore them.
  progress: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  blockedReason: Schema.optionalKey(TrimmedNonEmptyString),
  acknowledgedAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  canceledBy: Schema.optionalKey(Schema.Literals(["user", "parent-bot", "parent-turn-failed"])),
});

type LegacyDelegationRecord = typeof LegacyDelegationRecord.Type;

type TaggedDelegationRecord = typeof TaggedDelegationRecord.Type;

const legacyPhase = (legacy: LegacyDelegationRecord): OttoDelegationPhase => {
  const childThreadId = legacy.childThreadId ?? legacy.result?.childThreadId ?? null;
  const startedAt = legacy.startedAt ?? legacy.createdAt;
  const completedAt = legacy.completedAt ?? legacy.updatedAt;

  switch (legacy.state) {
    case "queued":
      return DelegationPhase.Queued();
    case "running":
    case "blocked":
      if (childThreadId === null) return DelegationPhase.Queued();

      return legacy.state === "running"
        ? DelegationPhase.Running({
            childThreadId,
            childTurnId: legacy.childTurnId,
            startedAt,
            progress: legacy.progress ?? null,
          })
        : DelegationPhase.Blocked({
            childThreadId,
            childTurnId: legacy.childTurnId,
            startedAt,
            reason: legacy.blockedReason ?? legacy.failure?.message ?? "The bot is blocked.",
          });
    case "completed":
      if (childThreadId !== null && legacy.result !== null) {
        return DelegationPhase.Completed({
          childThreadId,
          childTurnId: legacy.childTurnId,
          startedAt,
          completedAt,
          result: legacy.result,
          acknowledgedAt: legacy.acknowledgedAt ?? null,
        });
      }

      return DelegationPhase.Failed({
        childThreadId,
        childTurnId: legacy.childTurnId,
        startedAt: legacy.startedAt,
        completedAt,
        failure: { failureCode: "child_failed", message: "The bot did not return a result." },
        acknowledgedAt: null,
      });
    case "failed":
      return DelegationPhase.Failed({
        childThreadId,
        childTurnId: legacy.childTurnId,
        startedAt: legacy.startedAt,
        completedAt,
        failure: legacy.failure ?? {
          failureCode: "child_failed",
          message: "The bot did not return a result.",
        },
        acknowledgedAt: null,
      });
    case "canceled":
      return DelegationPhase.Canceled({
        childThreadId,
        childTurnId: legacy.childTurnId,
        startedAt: legacy.startedAt,
        completedAt,
        canceledBy: legacy.canceledBy ?? "user",
      });
  }
};

const LegacyToTagged = LegacyDelegationRecord.pipe(
  Schema.decodeTo(
    Schema.toType(TaggedDelegationRecord),
    SchemaTransformation.transform<TaggedDelegationRecord, LegacyDelegationRecord>({
      decode: (legacy) => {
        const {
          childThreadId: _childThreadId,
          childTurnId: _childTurnId,
          state: _state,
          result: _result,
          failure: _failure,
          startedAt: _startedAt,
          completedAt: _completedAt,
          progress: _progress,
          blockedReason: _blockedReason,
          acknowledgedAt: _acknowledgedAt,
          canceledBy: _canceledBy,
          ...base
        } = legacy;

        return { ...base, phase: legacyPhase(legacy) };
      },
      encode: ({ phase, ...base }) => ({
        ...base,
        childThreadId: isQueuedPhase(phase) ? null : phase.childThreadId,
        childTurnId: isQueuedPhase(phase) ? null : phase.childTurnId,
        state: ottoDelegationStateOf(phase),
        result: Predicate.isTagged(phase, "Completed") ? phase.result : null,
        failure: Predicate.isTagged(phase, "Failed") ? phase.failure : null,
        startedAt: isQueuedPhase(phase) ? null : phase.startedAt,
        completedAt: "completedAt" in phase ? phase.completedAt : null,
        ...(Predicate.isTagged(phase, "Running") ? { progress: phase.progress } : {}),
        ...(Predicate.isTagged(phase, "Blocked") ? { blockedReason: phase.reason } : {}),
        ...(Predicate.isTagged(phase, "Completed") ? { acknowledgedAt: phase.acknowledgedAt } : {}),
        ...(Predicate.isTagged(phase, "Canceled") ? { canceledBy: phase.canceledBy } : {}),
      }),
    }),
  ),
);

/** Lowercase state name for a phase, as used by activity kinds and tool payloads. */
export const ottoDelegationStateOf = (phase: OttoDelegationPhase): OttoDelegationState => {
  return Match.value(phase).pipe(
    Match.tagsExhaustive({
      Queued: () => {
        return "queued" as const;
      },
      Running: () => {
        return "running" as const;
      },
      Blocked: () => {
        return "blocked" as const;
      },
      Completed: () => {
        return "completed" as const;
      },
      Failed: () => {
        return "failed" as const;
      },
      Canceled: () => {
        return "canceled" as const;
      },
    }),
  );
};

export const OttoDelegationRecord = Schema.Union([LegacyToTagged, TaggedDelegationRecord]);

export type OttoDelegationRecord = typeof OttoDelegationRecord.Type;

export const OTTO_DELEGATION_TRANSITIONS = {
  Queued: new Set(["Running", "Failed", "Canceled"]),
  Running: new Set(["Blocked", "Completed", "Failed", "Canceled"]),
  Blocked: new Set(["Running", "Failed", "Canceled"]),
} as const;

export const OTTO_DELEGATION_TERMINAL_PHASES: ReadonlySet<OttoDelegationPhase["_tag"]> = new Set([
  "Completed",
  "Failed",
  "Canceled",
]);

export const isOttoDelegationTerminal = (phase: OttoDelegationPhase): boolean =>
  OTTO_DELEGATION_TERMINAL_PHASES.has(phase._tag);

/**
 * A finished child result the parent bot has not received yet. Completed and
 * failed work is delivered to the parent's next turn; user cancels are not,
 * because the user already knows about them.
 */
export const isOttoDelegationResultPending = (
  record: OttoDelegationRecord,
): record is OttoDelegationRecord & {
  readonly phase: Extract<OttoDelegationPhase, { _tag: "Completed" | "Failed" }>;
} =>
  (Predicate.isTagged(record.phase, "Completed") || Predicate.isTagged(record.phase, "Failed")) &&
  record.phase.acknowledgedAt === null;

/** Stamps a pending result as delivered to the parent bot. */
export const acknowledgeOttoDelegation = (
  record: OttoDelegationRecord,
  acknowledgedAt: string,
): OttoDelegationRecord =>
  isOttoDelegationResultPending(record)
    ? {
        ...record,
        phase: { ...record.phase, acknowledgedAt },
        updatedAt:
          Date.parse(acknowledgedAt) >= Date.parse(record.updatedAt)
            ? acknowledgedAt
            : record.updatedAt,
      }
    : record;

/**
 * Returns an acknowledged result to pending when the turn that acknowledged it
 * never reached its provider, so the next parent turn receives it instead.
 */
export const releaseOttoDelegationAcknowledgement = (
  record: OttoDelegationRecord,
): OttoDelegationRecord =>
  (Predicate.isTagged(record.phase, "Completed") || Predicate.isTagged(record.phase, "Failed")) &&
  record.phase.acknowledgedAt !== null
    ? { ...record, phase: { ...record.phase, acknowledgedAt: null } }
    : record;

/**
 * True while any child delegation started from this parent thread is still
 * working. Derived from the delegation records so every client and the server
 * agree without a second persisted flag.
 */
export const isThreadWaitingOnChildren = (
  delegations: ReadonlyArray<OttoDelegationRecord>,
  parentThreadId: ThreadId,
): boolean =>
  delegations.some(
    (delegation) =>
      delegation.parentThreadId === parentThreadId && !isOttoDelegationTerminal(delegation.phase),
  );

export class OttoDelegationContextTooLongError extends Schema.TaggedErrorClass<OttoDelegationContextTooLongError>()(
  "OttoDelegationContextTooLongError",
  {
    length: Schema.Number,
    maxLength: Schema.Number,
  },
) {
  override get message(): string {
    return `Delegation context is ${this.length} characters; the limit is ${this.maxLength}. Shorten it or put the details in the task.`;
  }
}

/** SendToAgent names a bot whose provider runs on the legacy bridge. */
export class OttoDelegationProviderUnsupportedError extends Schema.TaggedErrorClass<OttoDelegationProviderUnsupportedError>()(
  "OttoDelegationProviderUnsupportedError",
  {
    botName: Schema.String,
    driverKind: Schema.String,
  },
) {
  override get message(): string {
    return `${this.botName} runs on the ${this.driverKind} provider, which cannot receive handed-off work. Do the work yourself or pick a bot on another provider.`;
  }
}

function isQueuedPhase(
  value: OttoDelegationPhase,
): value is Extract<OttoDelegationPhase, { readonly _tag: "Queued" }> {
  return Predicate.isTagged(value, "Queued");
}
