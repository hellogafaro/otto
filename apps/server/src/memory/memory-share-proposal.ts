import {
  OttoMemoryCandidateId,
  OttoMemoryRootId,
  type OttoMemoryCandidateDecision,
  type OttoMemoryDecisionReceipt,
  type OttoMemoryShareScope,
  type OttoMemoryTargetScope,
  type OttoMemoryThreadAccess,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class MemoryApprovalError extends Schema.TaggedErrorClass<MemoryApprovalError>()(
  "MemoryApprovalError",
  { message: Schema.String },
) {}

export interface MemoryShareProposal {
  readonly access: OttoMemoryThreadAccess;
  readonly fact: string;
  readonly scope: OttoMemoryShareScope;
  readonly sensitive: boolean;
  // "auto" saves non-sensitive shared facts without asking.
  readonly mode: "ask" | "auto";
}

export type MemoryShareResult =
  | { readonly status: "saved"; readonly memoryId: OttoMemoryRootId }
  | { readonly status: "pending"; readonly candidateId: OttoMemoryCandidateId };

export interface MemoryApprovalsShape {
  // Called by the memory tool when a bot wants to save a shared fact.
  readonly propose: (
    input: MemoryShareProposal,
  ) => Effect.Effect<MemoryShareResult, MemoryApprovalError>;
  // Called when a person approves or rejects a pending candidate from the
  // chat card or the bot inbox. Deciding twice returns the first receipt.
  readonly decide: (input: {
    readonly access: OttoMemoryThreadAccess;
    readonly decision: OttoMemoryCandidateDecision;
  }) => Effect.Effect<OttoMemoryDecisionReceipt, MemoryApprovalError>;
}

export const memoryApprovalIncidentKey = (candidateId: string) => `memory-approval:${candidateId}`;

export const SCOPE_LABELS: Record<OttoMemoryTargetScope, string> = {
  private: "private",
  bot: "this bot's",
  project: "project",
  group: "group",
  workspace: "workspace",
};

export const INBOX_SUMMARY_MAX_CHARS = 240;

export const boundedSummary = (value: string) =>
  value.length <= INBOX_SUMMARY_MAX_CHARS
    ? value
    : `${value.slice(0, INBOX_SUMMARY_MAX_CHARS - 1)}…`;
