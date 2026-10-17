import { ApprovalRequestId, BotId, TurnId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ApprovalRecord } from "../../session-logic";
import { approvalBotId, withInlineApprovals } from "./inline-approvals.logic";

const approval = (id: string, createdAt: string, turn?: string): ApprovalRecord => ({
  requestId: ApprovalRequestId.make(id),
  requestKind: "command",
  createdAt,
  ...(turn ? { turnId: TurnId.make(turn) } : {}),
  resolution: null,
});

describe("withInlineApprovals", () => {
  it("places each approval before the first later row and keeps untimed rows in order", () => {
    const rows = withInlineApprovals(
      [
        { id: "ask", at: "2026-01-01T00:01:00.000Z" },
        { id: "card", at: null },
        { id: "reply", at: "2026-01-01T00:05:00.000Z" },
      ],
      [approval("first", "2026-01-01T00:02:00.000Z"), approval("last", "2026-01-01T00:06:00.000Z")],
      (row) => row.at,
    );

    expect(rows.map((row) => ("_tag" in row ? row.key : row.id))).toEqual([
      "ask",
      "card",
      "approval:first",
      "reply",
      "approval:last",
    ]);
  });
});

describe("approvalBotId", () => {
  const messages = [
    {
      role: "assistant",
      turnId: TurnId.make("turn-nova"),
      respondingBotId: BotId.make("bot-nova"),
    },
  ];

  it("names the bot that answered in the approval's turn", () => {
    expect(approvalBotId(approval("a", "t", "turn-nova"), messages, "bot-juno")).toBe("bot-nova");
  });

  it("falls back to the bot answering now", () => {
    expect(approvalBotId(approval("b", "t", "turn-other"), messages, "bot-juno")).toBe("bot-juno");
  });
});
