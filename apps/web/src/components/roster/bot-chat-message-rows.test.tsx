import { MessageId, type OrchestrationMessage } from "@otto/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("../../hooks/use-settings", () => ({
  useClientSettings: <T,>(select: (settings: { timestampFormat: "locale" }) => T) =>
    select({ timestampFormat: "locale" }),
}));

// The fold measures height in a layout effect, which static rendering never runs, so mark
// where it wraps a message instead.
vi.mock("../chat/folded-message", () => ({
  FoldedMessage: ({ children }: { readonly children: ReactNode }) => (
    <div data-fold="true">{children}</div>
  ),
}));

const { AssistantMessageRow, UserMessageRow } = await import("./bot-chat-message-rows");

const LONG_TEXT = Array.from({ length: 80 }, (_, line) => `Line ${line + 1} of the reply.`).join(
  "\n\n",
);

const message = (role: "assistant" | "user"): OrchestrationMessage => ({
  id: MessageId.make(`message-${role}`),
  role,
  text: LONG_TEXT,
  turnId: null,
  streaming: false,
  createdAt: "2026-10-20T07:00:00.000Z",
  updatedAt: "2026-10-20T07:00:00.000Z",
});

const CODY = {
  name: "Cody",
  avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
} as const;

const botReply = (author: typeof CODY | null) =>
  renderToStaticMarkup(
    <AssistantMessageRow
      message={message("assistant")}
      author={author}
      testId="bot-row"
      startsGroup
      cwd={undefined}
      threadRef={undefined}
      stepMeter={undefined}
      trace={undefined}
      environmentId={null}
      currentPersonId={null}
      playback={null}
      playbackKey={null}
      channelApproval={null}
      onReply={vi.fn()}
      onReactionChange={null}
    />,
  );

const personMessage = (authorName: string | null) =>
  renderToStaticMarkup(
    <UserMessageRow
      message={message("user")}
      testId="user-row"
      authorName={authorName}
      startsGroup
      replyLabel="You"
      showChannelOrigin={false}
      skills={undefined}
      environmentId={null}
      currentPersonId={null}
      onReply={vi.fn()}
      onReactionChange={null}
    />,
  );

describe("bot chat message rows", () => {
  it("shows a bot's whole reply across the column, never folded", () => {
    for (const author of [CODY, null]) {
      const markup = botReply(author);

      expect(markup).toContain("Line 80 of the reply.");
      expect(markup).toContain('data-testid="bot-message-body"');
      expect(markup).not.toContain('data-fold="true"');
      expect(markup).not.toContain("max-w-39/50");
      expect(markup).not.toContain("max-w-17/20");
    }
  });

  it("still folds a long message from a person", () => {
    expect(personMessage(null)).toContain('data-fold="true"');
    expect(personMessage("Hanan")).toContain('data-fold="true"');
  });
});
