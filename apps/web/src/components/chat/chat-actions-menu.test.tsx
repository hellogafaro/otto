import { Predicate } from "effect";
import { EnvironmentId, type OrchestrationThreadShell, ThreadId } from "@otto/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Item = { disabled?: boolean; onClick?: () => void; variant?: string };

const mocks = vi.hoisted(() => ({
  copied: [] as string[],
  toasts: [] as string[],
  shell: null as ReturnType<typeof shell> | null,
  visited: {} as Record<string, string>,
  items: new Map<string, Item>(),
  subTriggers: new Map<string, Item>(),
  actions: {
    rename: vi.fn(),
    setVisibility: vi.fn(),
    regenerateTitle: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    snooze: vi.fn(),
    unsnooze: vi.fn(),
    markUnread: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    delete: vi.fn(),
  },
}));

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      Predicate.isString(child)
        ? child
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : "",
    )
    .join("")
    .trim();
}

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));

vi.mock("../../state/entities", () => ({
  useThreadShell: () => mocks.shell,
  readEnvironmentSupportsPinning: () => true,
  readEnvironmentSupportsSnooze: () => true,
  readEnvironmentSupportsTitleRegeneration: () => true,
}));

vi.mock("../../hooks/use-chat-actions", () => ({ useChatActions: () => mocks.actions }));

vi.mock("../../hooks/use-now-minute", () => ({ useNowMinute: () => "2026-09-27T12:00" }));

vi.mock("../../ui-state-store", () => ({
  useUiStateStore: <T,>(
    select: (state: {
      threadLastVisitedAtById: typeof mocks.visited;
      markThreadVisited: () => void;
    }) => T,
  ) => select({ threadLastVisitedAtById: mocks.visited, markThreadVisited: vi.fn() }),
}));

vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuPopup: ({ children }: { children: ReactNode }) => children,
  MenuSub: ({ children }: { children: ReactNode }) => children,
  MenuSubPopup: ({ children }: { children: ReactNode }) => children,
  MenuSeparator: () => null,
  MenuTrigger: () => null,
  MenuSubTrigger: (props: Item & { children: ReactNode }) => {
    mocks.subTriggers.set(textOf(props.children), props);

    return null;
  },
  MenuItem: (props: Item & { children: ReactNode }) => {
    mocks.items.set(textOf(props.children), props);

    return null;
  },
}));

vi.mock("../../environments/primary/target", () => ({
  readPrimaryEnvironmentTarget: () => ({ target: { httpBaseUrl: "https://otto.example.com/" } }),
}));

vi.mock("../../hooks/use-copy-to-clipboard", () => ({
  writeTextToClipboard: async (value: string) => {
    mocks.copied.push(value);

    return true;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => mocks.toasts.push(message),
    error: (message: string) => mocks.toasts.push(message),
  },
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  // Renders the trigger element itself, so the pinned mark shows up in markup.
  TooltipTrigger: ({ render }: { render?: ReactNode }) => render ?? null,
  TooltipPopup: () => null,
}));

import { buildChatPaletteActions, ChatActionsMenu } from "./chat-actions-menu";
import { resolveChatMenuState } from "./chat-actions.logic";

const threadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

function shell(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Trip plans",
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: "2026-09-27T10:00:00.000Z",
      startedAt: "2026-09-27T10:00:01.000Z",
      completedAt: "2026-09-27T10:01:00.000Z",
      assistantMessageId: null,
    },
    createdAt: "2026-09-27T09:00:00.000Z",
    updatedAt: "2026-09-27T10:01:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: "2026-09-27T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  } as OrchestrationThreadShell;
}

function render(props: Parameters<typeof ChatActionsMenu>[0] = { threadRef }): string {
  mocks.items.clear();
  mocks.subTriggers.clear();

  return renderToStaticMarkup(<ChatActionsMenu {...props} />);
}

beforeEach(() => {
  mocks.shell = shell();
  mocks.visited = {
    [`${threadRef.environmentId}:${threadRef.threadId}`]: "2026-09-27T10:01:00.000Z",
  };

  for (const action of Object.values(mocks.actions)) action.mockReset();
});

const SNOOZE_PRESETS = ["In 1 hour", "In 3 hours", "This evening", "Tomorrow", "Next week"];

/** Menu rows in order, with snooze presets (whose times follow the clock) folded away. */
function menuLabels(): string[] {
  return [...mocks.items.keys()].filter(
    (label) => !SNOOZE_PRESETS.some((preset) => label.startsWith(preset)),
  );
}

function click(label: string): void {
  const item = mocks.items.get(label);
  expect(item, label).toBeDefined();
  expect(item?.disabled ?? false, `${label} is disabled`).toBe(false);
  item?.onClick?.();
}

describe("ChatActionsMenu", () => {
  it("renders nothing before the bot has a chat", () => {
    mocks.shell = null;
    expect(render()).toBe("");
    expect(mocks.items.size).toBe(0);
  });

  it("offers each way in for an idle chat and runs it on the open chat", () => {
    render();

    expect(menuLabels()).toEqual([
      "Rename chat",
      "Regenerate title",
      "Pin chat",
      "Mark unread",
      "Copy link",
      "Copy ID",
      "Archive chat",
      "Delete chat",
    ]);
    expect(mocks.subTriggers.get("Snooze")?.disabled).toBe(false);

    click("Pin chat");
    click("Mark unread");
    click("Archive chat");
    click("Delete chat");
    expect(mocks.actions.pin).toHaveBeenCalledWith(threadRef);
    expect(mocks.actions.markUnread).toHaveBeenCalledWith(threadRef);
    expect(mocks.actions.archive).toHaveBeenCalledWith(threadRef);
    expect(mocks.actions.delete).toHaveBeenCalledWith(threadRef);
    expect(mocks.items.get("Delete chat")?.variant).toBe("destructive");
  });

  it("snoozes until the chosen preset", () => {
    render();
    const preset = [...mocks.items.entries()].find(([label]) => label.startsWith("Tomorrow"));
    preset?.[1].onClick?.();

    expect(mocks.actions.snooze).toHaveBeenCalledTimes(1);
    const [ref, until] = mocks.actions.snooze.mock.calls[0] ?? [];
    expect(ref).toEqual(threadRef);
    expect(Date.parse(until)).toBeGreaterThan(Date.now());
  });

  it("shows pinned and snoozed chats with the way back out", () => {
    mocks.shell = shell({
      pinnedAt: "2026-09-27T11:00:00.000Z",
      snoozedUntil: "2999-01-01T09:00:00.000Z",
    });
    const markup = render();

    expect(markup).toContain('aria-label="Pinned"');
    expect(markup).toContain("Snoozed until");
    expect(menuLabels()).toEqual([
      "Rename chat",
      "Regenerate title",
      "Unpin chat",
      "Mark unread",
      "Wake chat",
      "Copy link",
      "Copy ID",
      "Archive chat",
      "Delete chat",
    ]);
    expect(mocks.subTriggers.size).toBe(0);

    click("Unpin chat");
    click("Wake chat");
    expect(mocks.actions.unpin).toHaveBeenCalledWith(threadRef);
    expect(mocks.actions.unsnooze).toHaveBeenCalledWith(threadRef);
  });

  it("copies the chat's full link and its ID", async () => {
    mocks.copied = [];
    mocks.toasts = [];
    render();

    click("Copy link");
    click("Copy ID");
    await vi.waitFor(() => expect(mocks.toasts).toHaveLength(2));

    expect(mocks.copied).toEqual(["https://otto.example.com/chats/thread-1", "thread-1"]);
    expect(mocks.toasts).toEqual(["Link has been copied", "ID has been copied"]);
  });

  it("keeps a running chat from being archived", () => {
    mocks.shell = shell({
      session: {
        threadId: "thread-1",
        status: "running",
        activeTurnId: "turn-2",
      } as OrchestrationThreadShell["session"],
    });
    render();

    expect(mocks.items.get("Archive chat")?.disabled).toBe(true);
    expect(mocks.items.get("Delete chat")?.disabled).toBeUndefined();
  });

  it("offers Mark unread only while the chat reads as seen", () => {
    mocks.visited = {
      [`${threadRef.environmentId}:${threadRef.threadId}`]: "2026-09-27T10:00:59.999Z",
    };
    render();
    expect(mocks.items.get("Mark unread")?.disabled).toBe(true);
  });

  it("leaves starting a chat to New chat, outside the chat menu", () => {
    render({ threadRef, newChat: { canStart: true, start: vi.fn() } });
    expect(menuLabels()).not.toContain("New chat");
  });
});

describe("buildChatPaletteActions", () => {
  const t = ((message: string, params?: Record<string, string | number>) =>
    message.replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key]))) as Parameters<
    typeof buildChatPaletteActions
  >[0]["t"];

  function paletteActions(overrides: Partial<OrchestrationThreadShell> = {}, openSnooze = vi.fn()) {
    const state = resolveChatMenuState({
      shell: shell(overrides),
      lastVisitedAt: "2026-09-27T10:01:00.000Z",
      now: "2026-09-27T12:00:00.000Z",
      supports: { snooze: true, pinning: true, titleRegeneration: true },
    });

    return buildChatPaletteActions({
      threadRef,
      state,
      newChat: null,
      actions: mocks.actions as Parameters<typeof buildChatPaletteActions>[0]["actions"],
      t,
      openRename: vi.fn(),
      openSnooze,
      copy: null,
    });
  }

  it("binds each chat verb to its item key", () => {
    const keys = Object.fromEntries(
      paletteActions().map((action) => [action.id, action.shortcutCommand]),
    );

    expect(keys).toMatchObject({
      rename: "item.rename",
      pin: "item.pin",
      "mark-unread": "item.markUnread",
      snooze: "item.snooze",
      archive: "item.archive",
      delete: "item.delete",
    });
  });

  it("opens the snooze presets from Snooze", async () => {
    const openSnooze = vi.fn();
    const snooze = paletteActions({}, openSnooze).find((action) => action.id === "snooze");

    await snooze?.run();
    expect(openSnooze).toHaveBeenCalledOnce();
  });

  it("offers Wake chat instead of Snooze while the chat is snoozed", async () => {
    const actions = paletteActions({ snoozedUntil: "2999-01-01T09:00:00.000Z" });

    expect(actions.some((action) => action.id === "snooze")).toBe(false);
    await actions.find((action) => action.id === "unsnooze")?.run();
    expect(mocks.actions.unsnooze).toHaveBeenCalledWith(threadRef);
  });
});
