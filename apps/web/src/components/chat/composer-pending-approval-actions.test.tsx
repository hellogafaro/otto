import { OTTO_CREATE_ROUTINE_TOOL_NAME, ApprovalRequestId } from "@otto/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPendingApprovalActions } from "./composer-pending-approval-actions";

describe("ComposerPendingApprovalActions", () => {
  it("states that the persistent approval lasts for this session", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain(">Cancel<");
    expect(markup).toContain("Always allow this session");
    expect(markup).not.toContain(">Always allow<");
    expect(markup).toContain("h-7");
    expect(markup).not.toContain("sm:h-");
    // The questionnaire's footer buttons: the allowing choice is its sky Send button.
    expect(markup).toContain("bg-(--primary-button-background)");
    expect(markup).toContain("text-muted-foreground");
    expect(markup).not.toContain("bg-foreground text-background");
  });

  it("shows each approval shortcut beside the choice it picks, only on the front request", () => {
    const actions = (shortcuts: boolean) =>
      renderToStaticMarkup(
        <ComposerPendingApprovalActions
          requestId={ApprovalRequestId.make("approval-shortcuts")}
          requestKind="command"
          isResponding={false}
          options={[
            { decision: "decline", label: "Decline" },
            { decision: "acceptAlways", label: "Always allow" },
            { decision: "accept", label: "Approve" },
          ]}
          shortcuts={shortcuts}
          onRespondToApproval={async () => undefined}
        />,
      );

    vi.stubGlobal("navigator", { platform: "Linux" });
    const front = actions(true);
    vi.unstubAllGlobals();

    const hints = [...front.matchAll(/truncate">([^<]+)<\/span><kbd[^>]*>([^<]+)</g)].map(
      ([, label, keys]) => [label, keys],
    );

    expect(hints).toEqual([
      ["Never", "Ctrl+Shift+Backspace"],
      ["Always allow", "Ctrl+Shift+Enter"],
      ["Allow once", "Ctrl+Enter"],
    ]);
    expect(actions(false)).not.toContain("<kbd");
  });

  it("shows only the approval choices advertised by an MCP server", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-safari")}
        isResponding={false}
        options={[
          { decision: "decline", label: "Decline" },
          { decision: "acceptAlways", label: "Always allow Safari" },
          { decision: "accept", label: "Approve" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("Always allow Safari");
    expect(markup).toContain(">Approve<");
    expect(markup).not.toContain("Always allow this session");
  });

  it("limits provider-supplied approval labels so narrow rows can wrap", () => {
    const label = "Allow ".repeat(40).trim();

    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-long-label")}
        isResponding={false}
        options={[{ decision: "acceptAlways", label }]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain('class="max-w-40 truncate"');
    expect(markup).toContain(label);
  });

  it("does not invent persistent permission for a one-use command", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-shell")}
        requestKind="command"
        isResponding={false}
        options={[
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Allow" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).not.toContain(">Always allow<");
    expect(markup).toContain("Allow once");
    expect(markup).toContain("Never");
    expect(markup).not.toContain(">Decline<");
  });

  it("offers Always allow as an outline button beside the primary Allow once", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-shell-auto-review")}
        requestKind="command"
        isResponding={false}
        options={[
          { decision: "decline", label: "Decline" },
          { decision: "acceptAlways", label: "Always allow" },
          { decision: "accept", label: "Allow" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain(">Always allow<");
    expect(markup).toContain("Allow once");
    expect(markup).toContain("Never");
    expect(markup.match(/bg-\(--primary-button-background\)/g)).toHaveLength(1);
    expect(markup.indexOf("Always allow")).toBeLessThan(markup.indexOf("Allow once"));
  });

  it("keeps a session-only approval under its own label", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-shell-session")}
        requestKind="command"
        isResponding={false}
        options={[
          { decision: "acceptForSession", label: "Allow for session" },
          { decision: "accept", label: "Allow" },
          { decision: "decline", label: "Decline" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("Allow for session");
    expect(markup).not.toContain(">Always allow<");
  });

  it("uses one create or cancel choice for a routine", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-routine")}
        requestKind="command"
        toolName={OTTO_CREATE_ROUTINE_TOOL_NAME}
        isResponding={false}
        options={[
          { decision: "accept", label: "Create routine" },
          { decision: "decline", label: "Cancel" },
        ]}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(markup).toContain("Create routine");
    expect(markup).toContain(">Don&#x27;t create<");
    expect(markup.indexOf("Don&#x27;t create")).toBeLessThan(markup.indexOf("Create routine"));
    expect(markup).toContain("bg-(--primary-button-background)");
    expect(markup).not.toContain("text-destructive-foreground");
    expect(markup).not.toContain(">Always allow<");
    expect(markup).not.toContain("Allow once");
    expect(markup).not.toContain(">Never<");

    const fallbackMarkup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-routine-fallback")}
        requestKind="command"
        toolName={OTTO_CREATE_ROUTINE_TOOL_NAME}
        isResponding={false}
        onRespondToApproval={async () => undefined}
      />,
    );

    expect(fallbackMarkup).toContain("Create routine");
    expect(fallbackMarkup).toContain(">Don&#x27;t create<");
    expect(fallbackMarkup).not.toContain(">Always allow<");
  });
});
