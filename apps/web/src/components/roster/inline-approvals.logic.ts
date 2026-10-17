import type { BotId, TurnId } from "@otto/contracts";
import * as Data from "effect/Data";

import type { ApprovalRecord } from "../../session-logic";

/** An approval placed in the transcript, as a timeline row beside messages and cards. */
export interface InlineApprovalItem {
  readonly _tag: "Approval";
  readonly key: string;
  readonly approval: ApprovalRecord;
}

/**
 * Places each approval in the transcript at the time it was asked: before the first row that
 * came later. Rows without a time of their own (work cards) never push an approval past them.
 */
export function withInlineApprovals<TItem>(
  items: ReadonlyArray<TItem>,
  approvals: ReadonlyArray<ApprovalRecord>,
  createdAtOf: (item: TItem) => string | null,
): Array<TItem | InlineApprovalItem> {
  const rows: Array<TItem | InlineApprovalItem> = [];
  const queue = [...approvals];

  for (const item of items) {
    const createdAt = createdAtOf(item);
    const later = createdAt === null ? 0 : queue.findIndex((next) => next.createdAt >= createdAt);
    const due = queue.splice(0, later < 0 ? queue.length : later);

    rows.push(...due.map(inlineApproval), item);
  }

  return [...rows, ...queue.map(inlineApproval)];
}

const { Approval } = Data.taggedEnum<InlineApprovalItem>();

function inlineApproval(approval: ApprovalRecord): InlineApprovalItem {
  return Approval({ key: `approval:${approval.requestId}`, approval });
}

/**
 * The bot that asked: the bot that answered in the approval's turn, else the bot answering now.
 * In a group each bot runs its own turns, so the turn names the bot.
 */
export function approvalBotId(
  approval: { readonly turnId?: TurnId },
  messages: ReadonlyArray<{
    readonly role: string;
    readonly turnId: TurnId | null;
    readonly respondingBotId?: BotId | null | undefined;
  }>,
  fallback: string | null,
): string | null {
  const answered = approval.turnId
    ? messages.find(
        (message) =>
          message.role === "assistant" &&
          message.turnId === approval.turnId &&
          message.respondingBotId,
      )
    : undefined;

  return answered?.respondingBotId ?? fallback;
}
