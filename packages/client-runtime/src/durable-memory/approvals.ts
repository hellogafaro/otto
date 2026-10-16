import {
  MEMORY_APPROVAL_REQUESTED_ACTIVITY,
  MEMORY_APPROVAL_RESOLVED_ACTIVITY,
  MemoryApprovalRequest,
  MemoryApprovalResolution,
  type OttoMemoryApprovalRequest,
  type OttoMemoryMutation,
  type OttoMemoryTargetScope,
} from "@otto/contracts";
import * as Schema from "effect/Schema";
import { type MessageKey } from "../i18n/index.ts";
import { type DurableMemoryTranslator, englishTranslator } from "./types.ts";

/** Approval card heading for each scope a pending fact would be saved to. */
export const MEMORY_APPROVAL_HEADINGS: Readonly<Record<OttoMemoryTargetScope, MessageKey>> = {
  private: "Save to private memory?",
  bot: "Save to this bot's memory?",
  project: "Save to project memory?",
  group: "Save to group memory?",
  workspace: "Save to workspace memory?",
};

/** Inbox next-step line for each scope a pending fact would be saved to. */
export const MEMORY_APPROVAL_ACTIONS: Readonly<Record<OttoMemoryTargetScope, MessageKey>> = {
  private: "Save to private memory",
  bot: "Save to this bot's memory",
  project: "Save to project memory",
  group: "Save to group memory",
  workspace: "Save to workspace memory",
};

export const memoryApprovalHeading = (
  scope: OttoMemoryTargetScope,
  i18n: Pick<DurableMemoryTranslator, "t"> = englishTranslator,
) => i18n.t(MEMORY_APPROVAL_HEADINGS[scope]);

const isApprovalRequest = Schema.is(MemoryApprovalRequest);

const isResolution = Schema.is(MemoryApprovalResolution);

/**
 * Project and workspace changes a bot proposed in this chat that nobody has approved or
 * rejected yet, oldest first. Derived from thread activities, so the list survives reloads.
 */
export function pendingMemoryApprovals(
  activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>,
): ReadonlyArray<MemoryApprovalRequest> {
  const resolved = new Set(
    activities.flatMap((activity) =>
      activity.kind === MEMORY_APPROVAL_RESOLVED_ACTIVITY && isResolution(activity.payload)
        ? [activity.payload.memoryId]
        : [],
    ),
  );

  const pending = new Map<string, MemoryApprovalRequest>();

  for (const activity of activities) {
    if (activity.kind !== MEMORY_APPROVAL_REQUESTED_ACTIVITY) continue;

    if (!isApprovalRequest(activity.payload)) continue;

    if (resolved.has(activity.payload.memoryId)) continue;
    pending.set(activity.payload.memoryId, activity.payload);
  }

  return [...pending.values()];
}

export type MemoryApprovalIntent =
  | { readonly action: "approve"; readonly fact?: string }
  | { readonly action: "reject" };

/** Builds the mutation that approves, edits and approves, or rejects a pending shared fact. */
export function memoryApprovalMutation(
  request: Pick<OttoMemoryApprovalRequest, "candidateId" | "fact">,
  intent: MemoryApprovalIntent,
): OttoMemoryMutation {
  if (intent.action === "reject") {
    return {
      operation: "candidate.decide",
      decision: { candidateId: request.candidateId, decision: "reject" },
    };
  }

  const edited = intent.fact?.trim();

  return {
    operation: "candidate.decide",
    decision: {
      candidateId: request.candidateId,
      decision: "approve",
      ...(edited && edited !== request.fact ? { fact: edited } : {}),
    },
  };
}
