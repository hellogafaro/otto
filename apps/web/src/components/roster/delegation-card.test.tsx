import type { TestProps, TestValue } from "../test-support/react-tree";
import { Predicate } from "effect";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OttoDelegationRecord,
  BotId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OttoDelegationState,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
} from "@otto/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  activities: [] as OrchestrationThreadActivity[],
  cancel: vi.fn(),
  retry: vi.fn(),
  toast: vi.fn(),
  // The in-flight action a mounted card would hold after a click.
  pendingAction: null as string | null,
  navigate: vi.fn(),
  recordChatPath: vi.fn(),
  setState: vi.fn(),
  thread: null as OrchestrationThreadShell | null,
  messages: [] as OrchestrationMessage[],
  // When set, external stores subscribe like a mounted component would.
  clockCleanups: null as Array<() => void> | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initial: T) => [
      initial === null ? (mocks.pendingAction as T) : initial,
      mocks.setState,
    ],
    useSyncExternalStore: <T,>(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ) => {
      mocks.clockCleanups?.push(subscribe(() => undefined));

      return getSnapshot();
    },
  };
});

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-1"),
}));

vi.mock("../../state/entities", () => ({
  useThreadActivities: () => mocks.activities,
  useThreadMessages: () => mocks.messages,
  useThreadShell: () => mocks.thread,
}));

vi.mock("../chat-markdown", () => ({ default: ({ text }: { text: string }) => text }));

vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: {
    cancelDelegation: "cancelDelegation",
    retryDelegation: "retryDelegation",
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "retryDelegation" ? mocks.retry : mocks.cancel),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toast, error: mocks.toast, warning: mocks.toast, info: mocks.toast },
}));

vi.mock("./roster-store", () => ({
  useRosterStore: { getState: () => ({ recordChatPath: mocks.recordChatPath }) },
}));

import { DelegationCard, delegationUsageTokens } from "./delegation-card";
import { DelegationDetail } from "./delegation-detail";
import { delegationClockState } from "./delegation-clock";
import { visitElements } from "../test-support/react-tree";
import type { Bot } from "./types";

const decodeDelegationRecord = Schema.decodeUnknownSync(OttoDelegationRecord);

const parentBot: Bot = {
  id: "bot-parent",
  name: "Mira",
  title: "Lead",
  label: null,
  description: null,
  instructions: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither", seed: "mira" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: null,
  pinned: false,
  archivedAt: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const childBot: Bot = {
  id: "bot-child",
  name: "Mori",
  title: "Researcher",
  label: null,
  description: null,
  instructions: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither", seed: "mori" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: null,
  pinned: false,
  archivedAt: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const childThread = {
  id: ThreadId.make("thread-child"),
  projectId: ProjectId.make("project-1"),
  botId: BotId.make("bot-child"),
  groupId: null,
  respondingBotId: BotId.make("bot-child"),
  title: "Delegated research",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-08-31T00:00:10.000Z",
  updatedAt: "2026-08-31T00:01:00.000Z",
  archivedAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
} satisfies OrchestrationThreadShell;

const CHILD_RUN = {
  childThreadId: "thread-child",
  childTurnId: "turn-child",
  startedAt: "2026-08-31T00:00:10.000Z",
};

const FINISHED_AT = "2026-08-31T00:01:00.000Z";

function phaseFor(state: OttoDelegationState) {
  switch (state) {
    case "queued":
      return { _tag: "Queued" };
    case "running":
      return { _tag: "Running", ...CHILD_RUN, progress: null };
    case "blocked":
      return { _tag: "Blocked", ...CHILD_RUN, reason: "The provider is blocked." };
    case "completed":
      return {
        _tag: "Completed",
        ...CHILD_RUN,
        completedAt: FINISHED_AT,
        acknowledgedAt: null,
        result: {
          summary: "Release comparison complete.",
          childThreadId: "thread-child",
          childTurnId: "turn-child",
        },
      };
    case "failed":
      return {
        _tag: "Failed",
        ...CHILD_RUN,
        completedAt: FINISHED_AT,
        acknowledgedAt: null,
        failure: { failureCode: "child_failed", message: "The provider stopped." },
      };
    case "canceled":
      return { _tag: "Canceled", ...CHILD_RUN, completedAt: FINISHED_AT, canceledBy: "user" };
  }
}

function delegation(state: OttoDelegationState, overrides: TestProps = {}) {
  return decodeDelegationRecord({
    delegationId: `delegation-${state}`,
    parentDelegationId: null,
    parentBotId: "bot-parent",
    childBotId: "bot-child",
    parentThreadId: "thread-parent",
    parentTurnId: "turn-parent",
    ancestorBotIds: ["bot-parent"],
    depth: 1,
    task: "Compare the release options.",
    expectedResult: "A short comparison.",
    access: {
      sandbox: "local",
      runtimeMode: "approval-required",
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
    },
    billedBotId: "bot-child",
    phase: phaseFor(state),
    keep: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:01:00.000Z",
    ...overrides,
  });
}

function usage(turnId: string, totalProcessedTokens: number): OrchestrationThreadActivity {
  return {
    id: EventId.make(`usage-${turnId}`),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload: { usedTokens: totalProcessedTokens, totalProcessedTokens },
    turnId: TurnId.make(turnId),
    createdAt: "2026-08-31T00:00:40.000Z",
  };
}

function renderCard(
  state: OttoDelegationState,
  bot: Bot | null = childBot,
  parent: Bot | null = parentBot,
) {
  return renderToStaticMarkup(
    <DelegationCard
      delegation={delegation(state)}
      delegations={[]}
      childBot={bot}
      parentBot={parent}
    />,
  );
}

function cardElement(state: OttoDelegationState, bot: Bot | null = childBot) {
  return DelegationCard({
    delegation: delegation(state),
    delegations: [],
    childBot: bot,
    parentBot,
  }) as ReactElement<TestProps>;
}

/** Finds an element by aria-label, calling nested function components on the way. */
function findByLabel(node: TestValue, label: string): ReactElement<TestProps> | null {
  let found: ReactElement<TestProps> | null = null;
  visitElements(node, (element) => {
    if (found) return true;

    if (element.props["aria-label"] === label) {
      found = element;

      return true;
    }

    if (Predicate.isFunction(element.type) && element.type.name.startsWith("Delegation")) {
      found = findByLabel((element.type as (props: TestProps) => TestValue)(element.props), label);
    }

    return found !== null;
  });

  return found;
}

function detailElement(bot: Bot | null = childBot, onOpenChange = vi.fn()) {
  return DelegationDetail({
    delegation: delegation("running"),
    childBot: bot,
    parentBot,
    onOpenChange,
  });
}

/** The detail dialog's text, read from its element tree; Base UI parts need a live dialog to render. */
function detailMarkup(bot: Bot | null = childBot): string {
  const parts: string[] = [];

  visitElements(detailElement(bot) as TestValue, (element) => {
    for (const child of [element.props.children].flat()) {
      if (Predicate.isString(child) || Predicate.isNumber(child)) parts.push(String(child));
    }

    return false;
  });

  return parts.join(" ");
}

describe("DelegationCard", () => {
  beforeEach(() => {
    mocks.activities = [usage("other-turn", 99_999), usage("turn-child", 1_234)];
    mocks.thread = childThread;
    mocks.messages = [];
    mocks.cancel.mockReset().mockResolvedValue({ _tag: "Success", value: { sequence: 1 } });
    mocks.retry.mockReset().mockResolvedValue({ _tag: "Success", value: { sequence: 1 } });
    mocks.toast.mockReset();
    mocks.pendingAction = null;
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.recordChatPath.mockReset();
    mocks.setState.mockReset();
    mocks.clockCleanups = null;
  });

  it.each(["queued", "running", "blocked", "failed", "canceled", "completed"] as const)(
    "marks the %s state on the receipt line",
    (state) => {
      expect(renderCard(state)).toContain(`data-delegation-state="${state}"`);
    },
  );

  it("shimmers only while the work runs", () => {
    for (const state of ["queued", "running", "blocked"] as const) {
      const markup = renderCard(state);
      expect(markup).toContain("shimmer");
      expect(markup).toContain("Working for");
    }

    for (const state of ["failed", "canceled", "completed"] as const) {
      const markup = renderCard(state);
      expect(markup).not.toContain("shimmer");
      expect(markup).toContain("New message from Mori");
    }
  });

  it("keeps the result and failure text off the receipt line", () => {
    expect(renderCard("completed")).not.toContain("Release comparison complete.");
    expect(renderCard("failed")).not.toContain("The provider stopped.");
    expect(renderCard("blocked")).not.toContain("The provider is blocked.");
  });

  it("shows the elapsed time on the receipt and keeps the brief off it", () => {
    const markup = renderCard("completed");
    expect(markup).toContain("New message from Mori");
    expect(markup).toContain("50s");
    expect(markup).not.toContain("A short comparison.");
    expect(markup).not.toContain("MCP servers");
  });

  it("shows hours for work that ran an hour or more", () => {
    const completed = delegation("completed");

    const markup = renderToStaticMarkup(
      <DelegationCard
        delegation={{
          ...completed,
          phase: {
            ...completed.phase,
            startedAt: "2026-08-30T16:12:17.000Z",
          } as typeof completed.phase,
        }}
        delegations={[]}
        childBot={childBot}
        parentBot={parentBot}
      />,
    );

    expect(markup).toContain("7h 48m");
  });

  it("uses only the delegated child turn usage", () => {
    expect(delegationUsageTokens(delegation("completed"), mocks.activities)).toBe(1_234);
    expect(delegationUsageTokens(delegation("queued"), mocks.activities)).toBeNull();
    expect(renderCard("completed")).not.toContain("tokens");
  });

  it("cancels through the delegation command with keep disabled", async () => {
    const cancel = findByLabel(cardElement("running"), "Cancel delegation to Mori");
    (cancel?.props.onClick as (() => void) | undefined)?.();
    await Promise.resolve();
    expect(mocks.cancel).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      input: { delegationId: delegation("running").delegationId, keep: false },
    });
  });

  it.each(["failed", "canceled", "completed"] as const)(
    "hides cancel for the terminal %s state",
    (state) => {
      expect(renderCard(state)).not.toContain(`aria-label="Cancel delegation to Mori"`);
    },
  );

  it("offers let it finish and cancel while the work is live", () => {
    const markup = renderCard("running");
    expect(markup).toContain('aria-label="Let Mori finish the work"');
    expect(markup).toContain('aria-label="Cancel delegation to Mori"');
    expect(markup).not.toContain('aria-label="Ask Mori to try again"');
  });

  it("lets the work finish through the delegation command with keep enabled", async () => {
    const keep = findByLabel(cardElement("running"), "Let Mori finish the work");
    (keep?.props.onClick as (() => void) | undefined)?.();
    await Promise.resolve();
    expect(mocks.setState).toHaveBeenCalledWith("keep");
    expect(mocks.cancel).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      input: { delegationId: delegation("running").delegationId, keep: true },
    });
  });

  it("drops let it finish once the work is already kept", () => {
    const markup = renderToStaticMarkup(
      <DelegationCard
        delegation={delegation("running", { keep: true })}
        delegations={[]}
        childBot={childBot}
        parentBot={parentBot}
      />,
    );

    expect(markup).not.toContain("Let Mori finish the work");
    expect(markup).toContain('aria-label="Cancel delegation to Mori"');
  });

  it.each(["failed", "canceled"] as const)("offers try again for %s work", async (state) => {
    expect(renderCard(state)).not.toContain("Let Mori finish the work");
    const retry = findByLabel(cardElement(state), "Ask Mori to try again");
    (retry?.props.onClick as (() => void) | undefined)?.();
    await Promise.resolve();
    expect(mocks.retry).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      input: { delegationId: delegation(state).delegationId },
    });
  });

  it("offers no try again once another card retries the work", () => {
    const failed = delegation("failed");

    const retry = delegation("running", {
      delegationId: "delegation-retry",
      retryOfDelegationId: failed.delegationId,
    });

    const markup = renderToStaticMarkup(
      <DelegationCard
        delegation={failed}
        delegations={[failed, retry]}
        childBot={childBot}
        parentBot={parentBot}
      />,
    );

    expect(markup).not.toContain("Ask Mori to try again");
    expect(markup).toContain('aria-label="View Mori&#x27;s work"');
  });

  it("shows no reverse-state action for completed work", () => {
    const markup = renderCard("completed");
    expect(markup).not.toContain("Let Mori finish the work");
    expect(markup).not.toContain("Ask Mori to try again");
  });

  it("disables every action while one is in flight", () => {
    mocks.pendingAction = "keep";
    const card = cardElement("running");
    expect(findByLabel(card, "Let Mori finish the work")?.props.disabled).toBe(true);
    expect(findByLabel(card, "Let Mori finish the work")?.props["aria-busy"]).toBe(true);
    expect(findByLabel(card, "Cancel delegation to Mori")?.props.disabled).toBe(true);
  });

  it("explains a rejected retry in a toast and clears the busy state", async () => {
    mocks.retry.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail(new Error("This bot already has 3 bot work items running.")),
    });
    const retry = findByLabel(cardElement("failed"), "Ask Mori to try again");
    await (retry?.props.onClick as (() => Promise<void>) | undefined)?.();
    expect(mocks.setState).toHaveBeenLastCalledWith(null);
    expect(mocks.toast).toHaveBeenCalledWith("Work couldn't be retried");
  });

  it("opens the read-only work view from the card", () => {
    const view = findByLabel(cardElement("running"), "View Mori's work");
    (view?.props.onClick as (() => void) | undefined)?.();
    expect(mocks.setState).toHaveBeenCalledWith(true);
    expect(renderCard("queued")).toMatch(/aria-label="View Mori&#x27;s work" disabled=""/);
  });

  it("opens a read-only chat with both bots in the header and no footer", () => {
    const markup = detailMarkup();
    expect(markup).toContain("Mira");
    expect(markup).toContain("Mori");
    expect(markup).toContain("Compare the release options.");
    expect(markup).not.toContain("Open chat");
    expect(markup).not.toContain("Expected result");
  });

  it("shows the work as a normal chat: the asking bot on the right, the worker on the left", () => {
    const message = (
      id: string,
      role: "user" | "assistant",
      text: string,
    ): OrchestrationMessage => ({
      id: MessageId.make(id),
      role,
      text,
      turnId: null,
      streaming: false,
      createdAt: "2026-08-31T00:00:20.000Z",
      updatedAt: "2026-08-31T00:00:20.000Z",
    });

    // Before the child has a chat, the brief stands in as the asking bot's first message.
    const brief = visitElements(detailElement() as TestValue, (element) =>
      Object.is(element.props["data-role"], "brief"),
    );

    expect(brief).not.toBeNull();

    mocks.messages = [
      message("m1", "user", "Compare the release options."),
      message("m2", "assistant", "Option B is safer."),
      message("m3", "assistant", "Numbers attached."),
    ];

    const rows: Array<{ testId: unknown; startsGroup: unknown; author: unknown }> = [];

    visitElements(detailElement() as TestValue, (element) => {
      if (element.props["data-role"] === "brief")
        rows.push({ testId: "brief", startsGroup: null, author: null });
      const testId = element.props["testId"];

      if (Predicate.isString(testId) && testId.startsWith("delegation-")) {
        rows.push({
          testId,
          startsGroup: element.props["startsGroup"],
          author: (element.props["author"] as { name?: string } | undefined)?.name ?? null,
        });
        expect(element.props["onReply"]).toBeNull();
        expect(element.props["onReactionChange"]).toBeNull();
      }

      return false;
    });

    expect(rows).toEqual([
      { testId: "delegation-parent-message", startsGroup: true, author: null },
      { testId: "delegation-child-message", startsGroup: true, author: "Mori" },
      { testId: "delegation-child-message", startsGroup: false, author: "Mori" },
    ]);
  });

  it("handles a missing child", () => {
    mocks.thread = null;
    expect(renderCard("running", null)).toContain("Unknown bot");
    expect(detailMarkup(null)).toContain("Unknown bot");
  });

  it("treats an archived child as unavailable", () => {
    const archived = { ...childBot, archivedAt: "2026-08-31T00:02:00.000Z" };
    expect(renderCard("running", archived)).toContain("Unknown bot");
    expect(detailMarkup(archived)).toContain("Unknown bot");
  });

  it("names both actions for assistive technology", () => {
    const markup = renderCard("running");
    expect(markup).toContain('aria-label="Cancel delegation to Mori"');
    expect(markup).toContain('aria-label="View Mori&#x27;s work"');
  });

  it("keeps access details off the receipt", () => {
    const record = delegation("running", {
      access: {
        sandbox: "local",
        runtimeMode: "approval-required",
        enabledMcpServerIds: ["github", "linear"],
        disabledMcpServerIds: [],
      },
    });

    const face = renderToStaticMarkup(
      <DelegationCard
        delegation={record}
        delegations={[]}
        childBot={childBot}
        parentBot={parentBot}
      />,
    );

    expect(face).not.toContain("MCP servers");
    expect(face).not.toContain("sandbox");
  });

  it("keeps the same short line in group chats", () => {
    const group = renderToStaticMarkup(
      <DelegationCard
        delegation={delegation("running")}
        delegations={[]}
        childBot={childBot}
        parentBot={parentBot}
        variant="group"
      />,
    );

    expect(group).toContain('data-variant="group"');
    expect(group).toContain("Mori");
    expect(group).not.toContain("asked");
  });

  it("lets the actions slot replace the default cancel control", () => {
    const markup = renderToStaticMarkup(
      <DelegationCard
        delegation={delegation("running")}
        delegations={[]}
        childBot={childBot}
        parentBot={parentBot}
        actions={<button type="button">Let it finish</button>}
      />,
    );

    expect(markup).toContain("Let it finish");
    expect(markup).not.toContain("Cancel delegation to Mori");
    expect(markup).toContain('aria-label="View Mori&#x27;s work"');
  });

  it("runs one shared timer for every live card and none for finished cards", () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const cleanups: Array<() => void> = [];
    mocks.clockCleanups = cleanups;

    try {
      for (const state of ["running", "queued", "blocked", "completed", "failed"] as const) {
        renderCard(state);
      }

      expect(delegationClockState()).toEqual({ subscribers: 3, ticking: true });
      expect(setInterval).toHaveBeenCalledTimes(1);
    } finally {
      for (const cleanup of cleanups) cleanup();
      setInterval.mockRestore();
    }

    expect(delegationClockState()).toEqual({ subscribers: 0, ticking: false });
  });
});
