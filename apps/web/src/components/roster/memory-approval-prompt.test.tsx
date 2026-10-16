import { BotId, EnvironmentId, ThreadId, type MemoryApprovalRequest } from "@otto/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(async <T,>(_input: T) => ({ _tag: "Success" as const })),
  // State the next render starts from, in hook order; empty means each hook's initial value.
  states: [] as unknown[],
  setState: vi.fn(<T,>(_value: T) => {}),
}));

// Hooks run outside a renderer so the element tree exposes each button handler.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T) => [
      mocks.states.length > 0 ? mocks.states.shift() : initial,
      mocks.setState,
    ],
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [{ id: "bot-grace", name: "Grace" }],
}));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("../../state/bots", () => ({ environmentBotsAtom: () => Symbol("bots") }));

vi.mock("../../state/memory", () => ({ memoryEnvironment: { decide: Symbol("decide") } }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.decide }));

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { MemoryApprovalPrompt } from "./memory-approval-prompt";

type ButtonElement = ReactElement<{ children: ReactNode; onClick: () => void }>;

type TextareaElement = ReactElement<{
  onKeyDown: (event: {
    key: string;
    nativeEvent: { isComposing: boolean };
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
}>;

function textarea(node: ReactNode): TextareaElement | undefined {
  if (Array.isArray(node)) return node.map(textarea).find(Boolean);

  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;

  if (node.type === Textarea) return node as TextareaElement;

  return textarea(node.props.children);
}

function buttons(node: ReactNode): ButtonElement[] {
  if (Array.isArray(node)) return node.flatMap(buttons);

  if (!isValidElement<{ children?: ReactNode }>(node)) return [];

  if (node.type === Button) return [node as ButtonElement];

  return buttons(node.props.children);
}

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-ada"),
};

const approval = (
  memoryId: string,
  authorBotId: string | null = "bot-grace",
  overrides: Partial<MemoryApprovalRequest> = {},
): MemoryApprovalRequest => ({
  memoryId,
  scope: "project",
  action: "add",
  text: "Deploys happen on Fridays.",
  previousText: null,
  title: "Otto",
  authorBotId: authorBotId === null ? null : BotId.make(authorBotId),
  ...overrides,
});

describe("MemoryApprovalPrompt", () => {
  beforeEach(() => {
    mocks.decide.mockClear();
    mocks.setState.mockClear();
    mocks.states = [];
  });

  it("shows the oldest pending proposal and where it would be saved", () => {
    const markup = renderToStaticMarkup(
      <MemoryApprovalPrompt
        threadRef={threadRef}
        approvals={[approval("m_first"), approval("m_second")]}
      />,
    );

    expect(markup).toContain('data-testid="memory-approval-prompt"');
    expect(markup).toContain("Save to project memory?");
    expect(markup).toContain("Grace wants to remember this for Otto");
    expect(markup).toContain("1 of 2");
    expect(markup).toContain("Deploys happen on Fridays.");
    // Attaches to the prompt box like the provider approval card.
    expect(markup).toContain("rounded-t-xl");
    expect(markup).not.toContain("animate-");
  });

  it("names the change for updates and deletes in the workspace", () => {
    const update = renderToStaticMarkup(
      <MemoryApprovalPrompt
        threadRef={threadRef}
        approvals={[
          approval("m_update", null, {
            scope: "workspace",
            action: "update",
            text: "Deploys happen on Mondays.",
            previousText: "Deploys happen on Fridays.",
            title: "",
          }),
        ]}
      />,
    );

    expect(update).toContain("Update workspace memory?");
    expect(update).toContain("A bot wants to remember this for the workspace");
    expect(update).toContain("Replaces: Deploys happen on Fridays.");

    const remove = MemoryApprovalPrompt({
      threadRef,
      approvals: [
        approval("m_delete", "bot-grace", {
          action: "delete",
          text: "",
          previousText: "Deploys happen on Fridays.",
        }),
      ],
    });

    expect(renderToStaticMarkup(remove)).toContain("Delete from project memory?");
    expect(buttons(remove).map((item) => item.props.children)).toEqual(["Reject", "Approve"]);
  });

  it("renders nothing once every proposal is decided", () => {
    expect(
      renderToStaticMarkup(<MemoryApprovalPrompt threadRef={threadRef} approvals={[]} />),
    ).toBe("");
  });

  it.each(["Approve", "Reject"] as const)("%s decides the proposal", async (label) => {
    const tree = MemoryApprovalPrompt({ threadRef, approvals: [approval("m_first")] });
    const target = buttons(tree).find((item) => item.props.children === label);
    expect(target).toBeDefined();
    target?.props.onClick();
    await vi.waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.decide).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { id: "m_first", decision: label === "Approve" ? "approve" : "reject" },
    });
  });

  it("cancels an edit on Escape without letting the key reach other UI", () => {
    const escape = (isComposing: boolean) => {
      mocks.states = [{ memoryId: "m_first", text: "Deploys happen on Mondays." }];
      mocks.setState.mockClear();

      const tree = MemoryApprovalPrompt({ threadRef, approvals: [approval("m_first")] });

      const event = {
        key: "Escape",
        nativeEvent: { isComposing },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };

      textarea(tree)?.props.onKeyDown(event);

      return event;
    };

    const event = escape(false);
    expect(mocks.setState).toHaveBeenCalledWith(null);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();

    // Escape that closes an IME candidate list leaves the edit open.
    const composing = escape(true);
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(composing.stopPropagation).not.toHaveBeenCalled();
  });
});
