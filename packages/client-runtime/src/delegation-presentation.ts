import * as Predicate from "effect/Predicate";
import {
  OTTO_DELEGATION_TRANSITIONS,
  ottoDelegationStateOf,
  isOttoDelegationTerminal,
  isThreadWaitingOnChildren,
  type OttoDelegationRecord,
  type OttoDelegationState,
  type OttoDelegationTrigger,
  type ThreadId,
} from "@otto/contracts";
import { withoutErrorStack } from "@otto/shared/errorText";

/**
 * Whether the parent bot has received a finished result. Completed and failed
 * work is delivered once, to the parent's next turn or its delegate_check call.
 * Canceled and unfinished work has no delivery state.
 */
export type DelegationDelivery = "pending" | "delivered";

export interface DelegationPresentation {
  readonly state: OttoDelegationState;
  readonly terminal: boolean;
  readonly outcome:
    | { readonly kind: "result"; readonly text: string }
    | { readonly kind: "failure"; readonly text: string }
    | { readonly kind: "blocked"; readonly text: string }
    | null;
  readonly delivery: DelegationDelivery | null;
  /** The child's chat, once the work has started. Opens the read-only detail view. */
  readonly childThreadId: ThreadId | null;
  /** Scheduled work comes from a routine, not from the parent bot's reply. */
  readonly trigger: OttoDelegationTrigger;
  /** Whether this card retries earlier Failed or Canceled work. */
  readonly retried: boolean;
}

/** Card state shared by the web and mobile delegation views. */
export function presentDelegation(delegation: OttoDelegationRecord): DelegationPresentation {
  const phase = delegation.phase;
  const state = ottoDelegationStateOf(phase);

  const delivery: DelegationDelivery | null =
    Predicate.isTagged(phase, "Completed") || Predicate.isTagged(phase, "Failed")
      ? phase.acknowledgedAt === null
        ? "pending"
        : "delivered"
      : null;

  return {
    state,
    terminal: isOttoDelegationTerminal(phase),
    // Records written before the phase union can decode without details; the text is then empty.
    // Older failures stored a full server stack, so only its first readable line is shown.
    outcome: Predicate.isTagged(phase, "Completed")
      ? { kind: "result", text: phase.result?.summary ?? "" }
      : Predicate.isTagged(phase, "Failed")
        ? { kind: "failure", text: withoutErrorStack(phase.failure?.message ?? "") }
        : Predicate.isTagged(phase, "Blocked")
          ? { kind: "blocked", text: withoutErrorStack(phase.reason) }
          : null,
    delivery,
    childThreadId: isQueuedPhase(phase) ? null : phase.childThreadId,
    trigger: delegation.trigger,
    retried: delegation.retryOfDelegationId !== null,
  };
}

/**
 * Milliseconds the work has run: from start (or creation while queued) to its
 * end, or to `now` while it is live. Null when the timestamps do not parse.
 */
export function delegationElapsedMs(delegation: OttoDelegationRecord, now: number): number | null {
  const phase = delegation.phase;

  const startedAt = Date.parse(
    isQueuedPhase(phase) || phase.startedAt === null ? delegation.createdAt : phase.startedAt,
  );

  const endedAt =
    Predicate.isTagged(phase, "Failed") ||
    Predicate.isTagged(phase, "Canceled") ||
    Predicate.isTagged(phase, "Completed")
      ? Date.parse(phase.completedAt)
      : now;

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) return null;

  return endedAt - startedAt;
}

/** Delegations a chat started, oldest first, and whether any are still working. */
type ThreadDelegationsResult = {
  readonly delegations: ReadonlyArray<OttoDelegationRecord>;
  readonly waitingOnChildren: boolean;
};

export function threadDelegations(
  delegations: ReadonlyArray<OttoDelegationRecord>,
  threadId: ThreadId,
): ThreadDelegationsResult {
  return {
    delegations: delegations.filter((delegation) => delegation.parentThreadId === threadId),
    waitingOnChildren: isThreadWaitingOnChildren(delegations, threadId),
  };
}

/**
 * Whether a later record already retries this one. The decider refuses a
 * second retry of the same record, so a superseded card offers no Try again.
 */
export function isDelegationSuperseded(
  delegation: OttoDelegationRecord,
  delegations: ReadonlyArray<OttoDelegationRecord>,
): boolean {
  return delegations.some((candidate) => candidate.retryOfDelegationId === delegation.delegationId);
}

/**
 * What a user can do with one piece of bot work. "Let it finish" keeps the work
 * running when its parent chat stops; cancel belongs in an overflow menu; retry
 * starts new work from a failed or canceled record without touching it, once.
 * Pass the chat's delegations so a record that was already retried offers nothing.
 */
export type DelegationAction = "keep" | "cancel" | "retry";

export function delegationActions(
  delegation: OttoDelegationRecord,
  delegations: ReadonlyArray<OttoDelegationRecord>,
): ReadonlyArray<DelegationAction> {
  const phase = delegation.phase._tag;

  if (phase === "Failed" || phase === "Canceled") {
    return isDelegationSuperseded(delegation, delegations) ? [] : ["retry"];
  }

  if (phase === "Completed") return [];
  const actions: DelegationAction[] = [];

  if (!delegation.keep) actions.push("keep");

  if (OTTO_DELEGATION_TRANSITIONS[phase].has("Canceled")) actions.push("cancel");

  return actions;
}

function isQueuedPhase(
  value: OttoDelegationRecord["phase"],
): value is Extract<OttoDelegationRecord["phase"], { readonly _tag: "Queued" }> {
  return Predicate.isTagged(value, "Queued");
}
