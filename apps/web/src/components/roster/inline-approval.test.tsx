import { OTTO_CREATE_ROUTINE_TOOL_NAME, ApprovalRequestId, AuthSessionId } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ApprovalRecord } from "../../session-logic";
import { InlineApproval } from "./inline-approval";
import type { Bot } from "./types";

const juno: Pick<Bot, "name" | "avatar"> = {
  name: "Juno",
  avatar: { kind: "dither", seed: "juno" },
};

const idle = { responding: false, error: null } as const;

function render(
  approval: Omit<ApprovalRecord, "resolution"> & Partial<Pick<ApprovalRecord, "resolution">>,
  options: {
    readonly response?: { readonly responding: boolean; readonly error: string | null };
    readonly delegateTo?: string | null;
    readonly bot?: Pick<Bot, "name" | "avatar" | "owner">;
    readonly currentPersonId?: string;
    readonly startsGroup?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <InlineApproval
      approval={{ resolution: null, ...approval }}
      bot={options.bot ?? juno}
      startsGroup={options.startsGroup ?? true}
      currentPersonId={options.currentPersonId ?? "person-ana"}
      delegateTo={options.delegateTo ?? null}
      response={options.response ?? idle}
      onRespond={vi.fn()}
    />,
  );
}

describe("InlineApproval", () => {
  it("sits in the transcript under the bot's name as a questionnaire-style card", () => {
    const markup = render(
      {
        requestId: ApprovalRequestId.make("send-call"),
        requestKind: "command",
        createdAt: "2026-08-27T00:00:00.000Z",
        args: { command: "pnpm test" },
        options: [
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Allow" },
        ],
      },
      { response: { responding: true, error: "Could not answer approval." } },
    );

    expect(markup).toContain('data-testid="inline-approval-card"');
    expect(markup).toContain("Juno");
    expect(markup).toContain('data-slot="card"');
    expect(markup).toContain('data-slot="questionnaire-actions"');
    expect(markup).toContain("Run this command?");
    expect(markup).toContain("pnpm test");
    expect(markup).toContain("Runs once");
    expect(markup).toContain("Allow once");
    expect(markup).toContain("Never");
    expect(markup).not.toContain(">Always allow<");
    // Not docked on the composer any more.
    expect(markup).not.toContain("rounded-t-xl");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Could not answer approval.");
  });

  it("offers the three command decisions with Never first and Allow once last", () => {
    const markup = render({
      requestId: ApprovalRequestId.make("review-command-session"),
      requestKind: "command",
      createdAt: "2026-08-27T00:00:00.000Z",
      args: { command: "pwd" },
      options: [
        { decision: "decline", label: "Decline" },
        { decision: "acceptAlways", label: "Always allow" },
        { decision: "accept", label: "Allow" },
      ],
    });

    const order = ["Never", "Always allow", "Allow once"].map((label) => markup.indexOf(label));

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("offers Always allow only to the bot's owner", () => {
    const approval = {
      requestId: ApprovalRequestId.make("review-command-owner"),
      requestKind: "command" as const,
      createdAt: "2026-08-27T00:00:00.000Z",
      args: { command: "pwd" },
      options: [
        { decision: "decline" as const, label: "Decline" },
        { decision: "acceptAlways" as const, label: "Always allow" },
        { decision: "accept" as const, label: "Allow" },
      ],
    };

    const owned = {
      ...juno,
      owner: {
        kind: "person" as const,
        personId: AuthSessionId.make("person-ana"),
        displayName: "Ana",
      },
    };

    expect(render(approval, { bot: owned, currentPersonId: "person-ana" })).toContain(
      ">Always allow<",
    );

    const markup = render(approval, { bot: owned, currentPersonId: "person-ben" });

    expect(markup).not.toContain(">Always allow<");
    expect(markup).toContain("Never");
    expect(markup).toContain("Allow once");
  });

  it("shows a delegate's target bot and brief instead of the generic prompt", () => {
    const markup = render(
      {
        requestId: ApprovalRequestId.make("delegate-call"),
        requestKind: "command",
        toolName: "delegate",
        createdAt: "2026-08-27T00:00:00.000Z",
        detail:
          "Approve this action with delegate? This approval applies only to the pending action. It cannot undo completed work.",
        args: {
          botId: "bot-nova",
          task: "Draft five first-week questions.",
          expectedResult: "A numbered list of five questions.",
        },
      },
      { delegateTo: "Nova" },
    );

    expect(markup).toContain("Delegate to Nova?");
    expect(markup).toContain("Draft five first-week questions.");
    expect(markup).toContain("Done when");
    expect(markup).toContain("A numbered list of five questions.");
    expect(markup).not.toContain("Approve this action with");
  });

  it("shows another tool's own arguments, never the generic prompt", () => {
    const markup = render({
      requestId: ApprovalRequestId.make("post-call"),
      requestKind: "command",
      toolName: "message_post",
      createdAt: "2026-08-27T00:00:00.000Z",
      detail:
        "Approve this action with message_post? This approval applies only to the pending action.",
      args: { text: "Shipping today." },
    });

    expect(markup).toContain("Allow message_post?");
    expect(markup).toContain("Shipping today.");
    expect(markup).not.toContain("Approve this action with");
  });

  it("shows the routine purpose and schedule once, with Don't create before Create routine", () => {
    const markup = render({
      requestId: ApprovalRequestId.make("review-routine-quote"),
      requestKind: "command",
      toolName: OTTO_CREATE_ROUTINE_TOOL_NAME,
      appName: "Safari",
      createdAt: "2026-09-27T00:00:00.000Z",
      detail: "Review routine",
      args: {
        name: "Morning quote",
        instructions: "Send one random positive quote.",
        schedule: { kind: "daily", time: "08:00" },
        timezone: "Europe/London",
      },
      options: [
        { decision: "accept", label: "Create routine" },
        { decision: "decline", label: "Cancel" },
      ],
    });

    expect(markup.match(/Review routine/g)).toHaveLength(1);
    expect(markup).toContain("Safari");
    expect(markup).toContain("Morning quote");
    expect(markup).toContain("Every day at 08:00");
    expect(markup).not.toContain("Runs once");
    expect(markup.indexOf("Don&#x27;t create")).toBeLessThan(markup.indexOf("Create routine"));
  });

  it.each([
    [{ decision: "accept", actor: "user", respondedBy: "Ana" }, "Allowed once by Ana"],
    [{ decision: "acceptAlways", actor: "user", respondedBy: "Ana" }, "Always allowed by Ana"],
    [
      { decision: "acceptForSession", actor: "user", respondedBy: "Ana" },
      "Allowed for this session by Ana",
    ],
    [{ decision: "decline", actor: "user", respondedBy: "Ana" }, "Not allowed by Ana"],
    [{ decision: "cancel", actor: "system" }, "Closed without an answer"],
  ] as const)("collapses an answered approval to one muted line: %o", (resolution, label) => {
    const markup = render({
      requestId: ApprovalRequestId.make("answered"),
      requestKind: "command",
      createdAt: "2026-08-27T00:00:00.000Z",
      args: { command: "pwd" },
      resolution,
    });

    expect(markup).toContain('data-testid="answered-approval"');
    expect(markup).toContain(label);
    expect(markup).toContain("pwd");
    expect(markup).not.toContain("inline-approval-card");
    expect(markup).not.toContain("<button");
  });

  it("joins the bot's group: only an approval that opens it shows the avatar and name", () => {
    const answered = {
      requestId: ApprovalRequestId.make("grouped"),
      requestKind: "command",
      createdAt: "2026-08-27T00:00:00.000Z",
      args: { command: "pwd" },
      resolution: { decision: "accept", actor: "user", respondedBy: "Ana" },
    } as const;

    const opening = render(answered);
    expect(opening).toContain(">Juno</div>");
    expect(opening).toContain("mt-3");

    const continuing = render(answered, { startsGroup: false });
    expect(continuing).not.toContain(">Juno</div>");
    expect(continuing).toContain("ml-10");
    expect(continuing).toContain("mt-1");
  });
});
