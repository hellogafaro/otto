import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

function readSibling(file: string) {
  return NodeFS.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

/** Returns the source of one exported memo row component. */
function rowComponent(source: string, name: string) {
  const start = source.indexOf(`export const ${name} = memo(`);
  const end = source.indexOf("\nexport ", start + 1);

  return start < 0 ? "" : source.slice(start, end < 0 ? source.length : end);
}

describe("BotThreadLanding message formatting", () => {
  it("renders assistant messages with the shared rich markdown component", () => {
    const entries = [
      ["bot-thread-landing.tsx", "bot-provider-message", "bot-user-message"],
      ["group-thread-landing.tsx", "group-provider-message", "group-user-message"],
    ] as const;

    for (const [file, assistantTestId, userTestId] of entries) {
      const source = readSibling(file);
      const assistantStart = source.indexOf(`testId="${assistantTestId}"`);
      const userStart = source.indexOf(`testId="${userTestId}"`, assistantStart);
      const assistantSource = source.slice(assistantStart, userStart);

      expect(assistantStart).toBeGreaterThan(-1);
      expect(userStart).toBeGreaterThan(assistantStart);
      expect(source.lastIndexOf("<AssistantMessageRow", assistantStart)).toBeGreaterThan(-1);
      expect(assistantSource).toContain("cwd={runtime.project?.workspaceRoot}");
      expect(assistantSource).toContain("threadRef={runtime.linkedThreadRef ?? undefined}");
      expect(source.lastIndexOf("<UserMessageRow", userStart)).toBeGreaterThan(assistantStart);
    }

    const assistantRow = rowComponent(
      readSibling("bot-chat-message-rows.tsx"),
      "AssistantMessageRow",
    );

    expect(assistantRow).toContain("<ChatMarkdown");
    expect(assistantRow).toContain('className="relative w-fit min-w-56 max-w-full"');
    expect(assistantRow).not.toContain("onTaskListChange");
    const userRow = rowComponent(readSibling("bot-chat-message-rows.tsx"), "UserMessageRow");
    // Sent text goes through SentMessageText, which keeps a reply's backlink compact.
    expect(userRow).toContain("<SentMessageText");
  });

  it("renders step meters for bot and group replies", () => {
    for (const file of ["bot-thread-landing.tsx", "group-thread-landing.tsx"]) {
      expect(readSibling(file)).toContain("stepMeters.get(message.turnId)");
    }

    const assistantRow = rowComponent(
      readSibling("bot-chat-message-rows.tsx"),
      "AssistantMessageRow",
    );

    expect(assistantRow).toContain("<BotStepMeter meter={stepMeter} />");
  });

  it("uses the free-scrolling conversation area instead of end-justified overflow", () => {
    const botSource = NodeFS.readFileSync(
      new URL("./bot-thread-landing.tsx", import.meta.url),
      "utf8",
    );

    const groupSource = NodeFS.readFileSync(
      new URL("./group-thread-landing.tsx", import.meta.url),
      "utf8",
    );

    expect(botSource).toContain("<BotConversationScrollArea");
    expect(groupSource).toContain("<BotConversationScrollArea");
    expect(botSource).not.toContain("justify-end gap-4");
    expect(groupSource).not.toContain("justify-end gap-4");
  });

  it("renders approvals inline in bot and group threads, never locking the composer", () => {
    const sources = ["bot-thread-landing.tsx", "group-thread-landing.tsx"].map((file) =>
      NodeFS.readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
    );

    for (const source of sources) {
      expect(source).toContain("<InlineApproval");
      expect(source).toContain("useRosterApprovals(runtime.linkedThreadRef)");
      expect(source).not.toContain("pendingApproval");
    }
  });

  it("keeps message actions visible for coarse pointers without dropping reply controls", () => {
    const source = readSibling("bot-chat-message-rows.tsx");
    expect(source).toContain("pointer-coarse:opacity-100");

    for (const name of ["AssistantMessageRow", "UserMessageRow"]) {
      const row = rowComponent(source, name);
      const controls = row.split("<MessageControls").slice(1);
      expect(controls.length).toBeGreaterThan(0);
      expect(row).toContain("toolbarClass(startsGroup)");

      for (const block of controls) {
        const props = block.slice(0, block.indexOf("/>"));
        expect(props).toContain("onReply=");

        if (name === "AssistantMessageRow") expect(props).toContain("readAloud");
      }
    }

    // Only the "Unavailable bot" layout omits reactions.
    const assistantControls = rowComponent(source, "AssistantMessageRow").split("<MessageControls");
    expect(assistantControls[2]).toContain("{...reactions.controls}");
    expect(rowComponent(source, "UserMessageRow")).toContain("{...reactions.controls}");
    // Every message, your own too, shares the one floating toolbar, inset from the right edge.
    expect(source).toContain("pointer-fine:md:end-2");
    expect(rowComponent(source, "UserMessageRow").split("toolbarClass(startsGroup)")).toHaveLength(
      3,
    );
    expect(source).not.toContain("OWN_ACTIONS_CLASS");
  });

  it("mounts the voice action in the live bot chat header", () => {
    const source = NodeFS.readFileSync(
      new URL("./bot-thread-landing.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'import { BotVoiceCallButton, useVoiceCall } from "../voice/voice-call"',
    );
    expect(source).toContain("data-chat-header-actions");
    expect(source).toContain('runtime.latestTurn?.state === "running"');
    expect(source).toContain("voiceCall.activeCall?.botId === bot.id");
    expect(source).toContain("voiceCall.startingBotId === bot.id");
  });

  it("disables reactions with an accessible reason while the linked thread is unavailable", () => {
    const source = NodeFS.readFileSync(
      new URL("./bot-thread-landing.tsx", import.meta.url),
      "utf8",
    );

    const rows = readSibling("bot-chat-message-rows.tsx");

    expect(source).toContain(
      "const reactionHandler = runtime.linkedThreadRef !== null ? updateReaction : null;",
    );
    expect(rows).toContain("<UnavailableReactionControl");
    expect(rows).toContain("aria-label={unavailableReason}");
    expect(rows).toContain("disabled:pointer-events-auto");
    expect(rows).toContain("if (!onReactionChange) return { controls: {}, chips: {} };");
    expect(source).not.toContain(
      'if (!threadRef) {\n      toast.error(t("Reaction couldn\'t be updated"));',
    );
  });

  it("renders routine receipts as cards whose failure reason stays readable", () => {
    const source = NodeFS.readFileSync(
      new URL("./bot-thread-landing.tsx", import.meta.url),
      "utf8",
    );

    const receiptRow = NodeFS.readFileSync(
      new URL("./routine-receipt-row.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<RoutineReceiptRow receipt={item.receipt} />");
    // The foreground token keeps the failure reason at WCAG AA on the card in every
    // built-in theme; the saturated destructive color does not in dark mode.
    expect(receiptRow).toContain("truncate text-destructive-foreground");
    expect(receiptRow).not.toMatch(/text-destructive(?!-foreground)/);
    // The receipt shares the bot's column: past the 28px avatar and its 12px gap.
    expect(receiptRow).toContain('className="w-full py-1 pl-10" data-testid="routine-receipt"');
  });
});
