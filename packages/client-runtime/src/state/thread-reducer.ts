import {
  applyTurnStartRequestedEvent,
  applyTurnInterruptRequestedEvent,
  applySessionSetEvent,
  applySessionStopRequestedEvent,
  applyTurnDiffCompletedEvent,
  applyRevertedEvent,
} from "./thread-reducer/turns.ts";
import { applyProposedPlanUpsertedEvent } from "./thread-reducer/plans.ts";
import { applyActivityAppendedEvent } from "./thread-reducer/activities.ts";
import {
  applyChannelDeliverySetEvent,
  applyMessageSentEvent,
  applyMessageReactionSetEvent,
} from "./thread-reducer/messages.ts";

import type { OrchestrationEvent, OrchestrationThread } from "@otto/contracts";
import { type ThreadDetailReducerResult } from "./thread-reducer/types.ts";

/**
 * Apply a single orchestration event to an `OrchestrationThread`, returning
 * the updated thread, a deletion signal, or an "unchanged" marker when the
 * event doesn't affect this thread.
 *
 * This is a pure reducer operating on contract types. UI-specific mapping
 * (e.g. resolving attachment preview URLs, normalising model slugs, adding
 * scoped fields like `environmentId`) is the caller's responsibility.
 */
export function applyThreadDetailEvent(
  thread: OrchestrationThread,
  event: OrchestrationEvent,
): ThreadDetailReducerResult {
  switch (event.type) {
    // ── Project events (irrelevant to thread detail) ────────────────
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
      return { kind: "unchanged" };

    // ── Thread lifecycle ────────────────────────────────────────────
    case "thread.created":
      return {
        kind: "updated",
        thread: {
          id: event.payload.threadId,
          projectId: event.payload.projectId,
          botId: event.payload.botId ?? null,
          groupId: event.payload.groupId ?? null,
          personId: event.payload.personId ?? null,
          createdBy: event.payload.createdBy ?? null,
          title: event.payload.title,
          modelSelection: event.payload.modelSelection,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          branch: event.payload.branch,
          worktreePath: event.payload.worktreePath,
          latestTurn: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          archivedAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      };

    case "thread.deleted":
      return { kind: "deleted" };

    case "thread.archived":
      return {
        kind: "updated",
        thread: {
          ...thread,
          archivedAt: event.payload.archivedAt,
          titleRegeneration: null,
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.unarchived":
      return {
        kind: "updated",
        thread: { ...thread, archivedAt: null, updatedAt: event.payload.updatedAt },
      };

    case "thread.snoozed":
      return {
        kind: "updated",
        thread: {
          ...thread,
          snoozedUntil: event.payload.snoozedUntil,
          snoozedAt: event.payload.snoozedAt,
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.unsnoozed":
      return {
        kind: "updated",
        thread: {
          ...thread,
          snoozedUntil: null,
          snoozedAt: null,
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.pinned":
      return {
        kind: "updated",
        thread: {
          ...thread,
          pinnedAt: event.payload.pinnedAt,
          ...(event.payload.pinOrderKey !== undefined
            ? { pinOrderKey: event.payload.pinOrderKey }
            : {}),
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.unpinned":
      return {
        kind: "updated",
        thread: {
          ...thread,
          pinnedAt: null,
          pinOrderKey: null,
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.pin-reordered":
      return {
        kind: "updated",
        thread: {
          ...thread,
          pinOrderKey: event.payload.orderKey,
          updatedAt: event.payload.updatedAt,
        },
      };

    // ── Thread metadata ─────────────────────────────────────────────
    case "thread.meta-updated":
      return {
        kind: "updated",
        thread: {
          ...thread,
          ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
          ...(event.payload.titleRegeneration !== undefined
            ? { titleRegeneration: event.payload.titleRegeneration }
            : {}),
          ...(event.payload.modelSelection !== undefined
            ? { modelSelection: event.payload.modelSelection }
            : {}),
          ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
          ...(event.payload.worktreePath !== undefined
            ? { worktreePath: event.payload.worktreePath }
            : {}),
          ...(event.payload.linkedPullRequest !== undefined
            ? { linkedPullRequest: event.payload.linkedPullRequest }
            : {}),
          ...(event.payload.visibility !== undefined
            ? { visibility: event.payload.visibility }
            : {}),
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.runtime-mode-set":
      return {
        kind: "updated",
        thread: {
          ...thread,
          runtimeMode: event.payload.runtimeMode,
          updatedAt: event.payload.updatedAt,
        },
      };

    case "thread.interaction-mode-set":
      return {
        kind: "updated",
        thread: {
          ...thread,
          interactionMode: event.payload.interactionMode,
          updatedAt: event.payload.updatedAt,
        },
      };

    // ── Turn lifecycle ──────────────────────────────────────────────
    case "thread.turn-start-requested":
      return applyTurnStartRequestedEvent(thread, event);

    case "thread.turn-interrupt-requested":
      return applyTurnInterruptRequestedEvent(thread, event);

    // ── Messages ────────────────────────────────────────────────────
    case "thread.channel-delivery-set":
      return applyChannelDeliverySetEvent(thread, event);

    case "thread.message-sent":
      return applyMessageSentEvent(thread, event);

    case "thread.message-reaction-set":
      return applyMessageReactionSetEvent(thread, event);

    // ── Session ─────────────────────────────────────────────────────
    case "thread.session-set":
      return applySessionSetEvent(thread, event);

    case "thread.session-stop-requested":
      return applySessionStopRequestedEvent(thread, event);

    // ── Proposed plans ──────────────────────────────────────────────
    case "thread.proposed-plan-upserted":
      return applyProposedPlanUpsertedEvent(thread, event);

    // ── Checkpoints / turn diffs ────────────────────────────────────
    case "thread.turn-diff-completed":
      return applyTurnDiffCompletedEvent(thread, event);

    // ── Revert ──────────────────────────────────────────────────────
    case "thread.reverted":
      return applyRevertedEvent(thread, event);

    // ── Activities ──────────────────────────────────────────────────
    case "thread.activity-appended":
      return applyActivityAppendedEvent(thread, event);

    // ── Events that don't mutate thread state directly ──────────────
    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
    case "thread.checkpoint-revert-requested":
      return { kind: "unchanged" };
  }

  // Forward-compatible: ignore unrecognized event types.
  return { kind: "unchanged" };
}

export { type ThreadDetailReducerResult } from "./thread-reducer/types.ts";
