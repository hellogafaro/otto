import type { TestValue } from "../test-support/react-tree";
import type { ReactElement } from "react";
import {
  OttoDelegationRecord,
  ApprovalRequestId,
  BotId,
  EnvironmentId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationLatestTurn,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadActivity,
} from "@otto/contracts";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/react-hook-harness";
import { visitElements } from "../test-support/react-tree";
import type { Bot, Group } from "./types";
import type { ApprovalRecord, PendingUserInput } from "../../session-logic";

const mocks = vi.hoisted(() => ({
  providersAtom: Symbol("providers"),
  snapshotAtom: Symbol("snapshot"),
  peopleAtom: Symbol("people"),
  snapshot: null as OrchestrationShellSnapshot | null,
  bots: [] as Bot[],
  groups: [] as Group[],
  activities: [] as OrchestrationThreadActivity[],
  messages: [] as OrchestrationMessage[],
  groupMessages: [] as OrchestrationMessage[],
  pendingUserInputs: [] as PendingUserInput[],
  groupPendingUserInputs: [] as PendingUserInput[],
  approvals: [] as ApprovalRecord[],
  respond: vi.fn(),
  latestTurn: null as OrchestrationLatestTurn | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => undefined,
    useId: () => "test-id",
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/react-hook-harness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: <T,>(atom: T) =>
    atom === mocks.snapshotAtom
      ? mocks.snapshot
      : atom === mocks.peopleAtom
        ? { current: null, host: null }
        : [],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@otto/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("../../hooks/use-settings", () => ({ usePrimarySettings: () => ({}) }));

vi.mock("../../model-selection", () => ({
  getCustomModelOptionsByInstance: () => new Map(),
  resolveAppModelSelectionState: () => null,
}));

vi.mock("../../provider-instances", () => ({
  applyProviderInstanceSettings: () => [],
  deriveProviderInstanceEntries: () => [],
  sortProviderInstanceEntries: () => [],
}));

vi.mock("../../state/bots", () => ({
  botEnvironment: { update: Symbol("update"), channels: { send: Symbol("send") } },
  environmentPeopleAtom: () => mocks.peopleAtom,
  environmentBotsAtom: () => Symbol("bots"),
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-1"),
}));

vi.mock("./details-panel-open", () => ({
  useChatDetailsOpen: () => [false, () => undefined],
}));

vi.mock("../chat/chat-actions-menu", () => ({
  ChatActionsMenu: () => null,
  useMarkChatVisited: () => undefined,
}));

vi.mock("../../state/entities", () => ({
  useThreadActivities: () => mocks.activities,
  useThreadShell: () => null,
}));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: { inbox: [] } }) }));

vi.mock("../settings/providers-panel", () => ({
  useSubscriptionStatuses: () => ({ statusByProvider: new Map() }),
}));

vi.mock("../../state/server", () => ({
  primaryServerProvidersAtom: mocks.providersAtom,
  serverEnvironment: { subscriptionAuth: () => null, routineThreadRuns: () => null },
}));

vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => ({ data: null, isPending: false }),
}));

vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: () => mocks.snapshotAtom }));

vi.mock("./use-server-roster", () => ({
  useRosterLoadState: () => ({ kind: "loading" }),
  useEnableBotAutoReview: () => vi.fn(),
}));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("../../settings-dialog-store", () => ({ openSettings: vi.fn() }));

vi.mock("../voice/voice-call", () => ({
  BotVoiceCallButton: () => null,
  useVoiceCall: () => ({ activeCall: null, startingBotId: null }),
  useOptionalVoiceCall: () => ({ activeCall: null, startingBotId: null }),
}));

vi.mock("../chat/reply-playback-provider", () => ({
  ReplyPlaybackProvider: ({ children }: { children: unknown }) => children,
  useOptionalReplyPlayback: () => null,
  useReplyPlayback: () => {
    throw new Error("Reply playback is not available in this test.");
  },
}));

vi.mock("~/lib/reply-playback-thread", () => ({
  useReplyPlaybackThread: () => undefined,
  replyPlaybackControlProps: () => undefined,
}));

vi.mock("./use-roster-approvals", () => ({
  useRosterApprovals: () => ({
    approvals: mocks.approvals,
    pending: mocks.approvals.filter((approval) => approval.resolution === null),
    respond: mocks.respond,
    responseFor: () => ({ responding: false, error: null }),
  }),
}));

vi.mock("./use-bot-engine-availability", () => ({
  useBotEngineAvailability: () => ({
    instanceEntries: [],
    selection: null,
    unavailability: null,
    blocked: false,
  }),
}));

vi.mock("./bot-presence", () => ({
  useBotPresence: () => "idle",
  useGroupPresence: () => "idle",
}));

vi.mock("./roster-store", () => {
  const useRosterStore = <T,>(
    selector: (state: {
      bots: typeof mocks.bots;
      groups: typeof mocks.groups;
      environmentId: string;
    }) => T,
  ) => selector({ bots: mocks.bots, groups: mocks.groups, environmentId: "environment-1" });

  useRosterStore.getState = () => ({ selectBot: vi.fn() });

  return { useRosterStore };
});

vi.mock("./use-bot-thread-runtime", () => ({
  useBotThreadRuntime: () => ({
    sending: false,
    respondingRequestIds: [],
    pendingUserInputs: mocks.pendingUserInputs,
    pendingUserInputAnswers: {},
    selectPendingUserInputOption: vi.fn(),
    answerPendingUserInputWithText: vi.fn(),
    submitPendingUserInputAnswers: vi.fn(),
    messages: mocks.messages,
    error: null,
    project: null,
    botReady: true,
    bootstrapped: true,
    linkedThreadRef: {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-parent"),
    },
    latestTurn: mocks.latestTurn,
    send: vi.fn(),
  }),
}));

vi.mock("./use-group-thread-runtime", () => ({
  useGroupThreadRuntime: () => ({
    sending: false,
    respondingRequestIds: [],
    messages: mocks.groupMessages,
    error: null,
    project: null,
    groupReady: true,
    bootstrapped: true,
    respondingBotId: "bot-parent",
    linkedThreadRef: {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-parent"),
    },
    latestTurn: mocks.latestTurn,
    pendingUserInputs: mocks.groupPendingUserInputs,
    pendingUserInputAnswers: {},
    selectPendingUserInputOption: vi.fn(),
    answerPendingUserInputWithText: vi.fn(),
    submitPendingUserInputAnswers: vi.fn(),
    send: vi.fn(),
  }),
}));

import { AssistantMessageRow } from "./bot-chat-message-rows";
import { BotThreadLanding } from "./bot-thread-landing";
import { BotActivityStatus } from "./bot-activity-status";
import { GroupWorkingRows } from "./group-working-rows";
import { BotPromptComposer } from "./bot-prompt-composer";
import { ComposerPendingUserInputPanel } from "../chat/composer-pending-user-input-panel";
import { DelegationCard } from "./delegation-card";
import { GroupThreadLanding } from "./group-thread-landing";
import { BotUserInputPrompt } from "./bot-user-input-prompt";
import { InlineApproval } from "./inline-approval";
import { ThreadRuntimeWarningBanner } from "./thread-runtime-warning-banner";

const chatRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-parent"),
};

const decodeDelegation = Schema.decodeUnknownSync(OttoDelegationRecord);

const parentBot: Bot = {
  id: "bot-parent",
  name: "Otto",
  title: "Boss",
  label: null,
  description: null,
  instructions: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither", seed: "parent" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: "group-1",
  pinned: false,
  archivedAt: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const childBot: Bot = { ...parentBot, id: "bot-child", name: "Mori", title: "Researcher" };

const group: Group = {
  id: "group-1",
  name: "Research",
  bossBotId: parentBot.id,
  members: [
    { kind: "bot", botId: BotId.make(parentBot.id), role: "boss" },
    { kind: "bot", botId: BotId.make(childBot.id), role: "specialist" },
  ],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function delegation(
  id: string,
  parentThreadId: string,
  placement: { readonly parentTurnId?: string; readonly anchorMessageId?: string } = {},
) {
  return decodeDelegation({
    delegationId: id,
    parentDelegationId: null,
    parentBotId: BotId.make(parentBot.id),
    childBotId: BotId.make(childBot.id),
    parentThreadId,
    childThreadId: null,
    parentTurnId: placement.parentTurnId ?? "turn-parent",
    anchorMessageId: placement.anchorMessageId ?? null,
    childTurnId: null,
    ancestorBotIds: [BotId.make(parentBot.id)],
    depth: 1,
    task: "Compare the release options.",
    expectedResult: "A short comparison.",
    access: {
      sandbox: "local",
      runtimeMode: "approval-required",
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
    },
    state: "queued",
    billedBotId: BotId.make(childBot.id),
    result: null,
    failure: null,
    keep: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  });
}

function message(id: string, role: "user" | "assistant", turn: string, minute: number) {
  const timestamp = `2026-09-11T12:0${minute}:00.000Z`;

  return {
    id: MessageId.make(id),
    role,
    text: `${role} ${id}`,
    turnId: TurnId.make(turn),
    ...(role === "assistant" ? { respondingBotId: BotId.make(parentBot.id) } : {}),
    streaming: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies OrchestrationMessage;
}

// Three turns, each started by a user message and answered by the parent bot.
const THREE_TURNS = [
  message("user-1", "user", "turn-1", 1),
  message("reply-1", "assistant", "turn-1", 2),
  message("user-2", "user", "turn-2", 3),
  message("reply-2", "assistant", "turn-2", 4),
  message("user-3", "user", "turn-3", 5),
  message("reply-3", "assistant", "turn-3", 6),
];

/** Message ids and delegation ids in the order the landing renders them. */
function timelineOrder(rendered: TestValue): string[] {
  const order: string[] = [];
  visitElements(rendered, (element) => {
    if (element.type === DelegationCard) {
      order.push(
        `card:${(element.props as Parameters<typeof DelegationCard>[0]).delegation.delegationId}`,
      );

      return false;
    }

    const key = element.key?.replace(/^message:/, "");

    if (key && THREE_TURNS.some((entry) => entry.id === key)) order.push(key);

    return false;
  });

  return order;
}

describe("thread landing delegations", () => {
  beforeEach(() => {
    hooks.reset();
    mocks.bots = [parentBot, childBot];
    mocks.groups = [group];
    mocks.activities = [];
    mocks.messages = [];
    mocks.groupMessages = [];
    mocks.pendingUserInputs = [];
    mocks.groupPendingUserInputs = [];
    mocks.approvals = [];
    mocks.respond.mockReset();
    mocks.latestTurn = null;
    mocks.snapshot = {
      snapshotSequence: 1,
      bots: [],
      groups: [],
      delegations: [delegation("matching", "thread-parent"), delegation("other", "thread-other")],
      projects: [],
      threads: [],
      updatedAt: "2026-08-31T00:00:00.000Z",
    };
  });

  it.each([
    ["bot", () => BotThreadLanding({ botId: parentBot.id, threadRef: chatRef })],
    ["group", () => GroupThreadLanding({ groupId: group.id, threadRef: chatRef })],
  ])("renders the shared card for the matching %s thread delegation", (_kind, render) => {
    hooks.beginRender();

    const card = visitElements(
      render(),
      (element) => element.type === DelegationCard,
    ) as ReactElement<Parameters<typeof DelegationCard>[0]> | null;

    expect(card?.props.delegation.delegationId).toBe("matching");
    expect(card?.props.childBot).toBe(childBot);
  });

  it.each([
    ["bot", () => BotThreadLanding({ botId: parentBot.id, threadRef: chatRef })],
    ["group", () => GroupThreadLanding({ groupId: group.id, threadRef: chatRef })],
  ])("places three delegations from three turns at three points in the %s chat", (kind, render) => {
    if (kind === "bot") mocks.messages = THREE_TURNS;
    else mocks.groupMessages = THREE_TURNS;
    mocks.snapshot = {
      ...mocks.snapshot!,
      delegations: [
        delegation("first", "thread-parent", { parentTurnId: "turn-1", anchorMessageId: "user-1" }),
        delegation("second", "thread-parent", {
          parentTurnId: "turn-2",
          anchorMessageId: "user-2",
        }),
        delegation("third", "thread-parent", { parentTurnId: "turn-3", anchorMessageId: "user-3" }),
      ],
    };

    hooks.beginRender();
    expect(timelineOrder(render())).toEqual([
      "user-1",
      "reply-1",
      "card:first",
      "user-2",
      "reply-2",
      "card:second",
      "user-3",
      "reply-3",
      "card:third",
    ]);
  });

  it("follows the anchor, then the parent turn, then the end of the chat", () => {
    mocks.messages = THREE_TURNS;
    mocks.snapshot = {
      ...mocks.snapshot!,
      delegations: [
        delegation("by-anchor", "thread-parent", {
          parentTurnId: "turn-gone",
          anchorMessageId: "reply-2",
        }),
        delegation("by-turn", "thread-parent", { parentTurnId: "turn-1" }),
        delegation("unplaced", "thread-parent", { parentTurnId: "turn-gone" }),
      ],
    };

    hooks.beginRender();
    expect(timelineOrder(BotThreadLanding({ botId: parentBot.id, threadRef: chatRef }))).toEqual([
      "user-1",
      "reply-1",
      "card:by-turn",
      "user-2",
      "reply-2",
      "card:by-anchor",
      "user-3",
      "reply-3",
      "card:unplaced",
    ]);
  });

  it("names the asking bot on group cards", () => {
    hooks.beginRender();

    const groupCard = visitElements(
      GroupThreadLanding({ groupId: group.id, threadRef: chatRef }),
      (element) => element.type === DelegationCard,
    ) as ReactElement<Parameters<typeof DelegationCard>[0]> | null;

    hooks.reset();

    const botCard = visitElements(
      BotThreadLanding({ botId: parentBot.id, threadRef: chatRef }),
      (element) => element.type === DelegationCard,
    ) as ReactElement<Parameters<typeof DelegationCard>[0]> | null;

    expect(groupCard?.props.variant).toBe("group");
    expect(groupCard?.props.parentBot).toBe(parentBot);
    expect(botCard?.props.variant).toBeUndefined();
  });

  it("renders plugin recommendations inside the bot conversation", () => {
    const turnId = TurnId.make("turn-plugins");
    const timestamp = "2026-09-02T20:00:00.000Z";
    mocks.messages = [
      {
        id: MessageId.make("message-user"),
        role: "user",
        text: "Can you connect my email?",
        turnId,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: MessageId.make("message-assistant"),
        role: "assistant",
        text: "I found Gmail.",
        turnId,
        respondingBotId: BotId.make(parentBot.id),
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    mocks.activities = [
      {
        id: EventId.make("activity-plugin-search"),
        tone: "tool",
        kind: "tool.completed",
        summary: "connection_search",
        turnId,
        createdAt: timestamp,
        payload: {
          itemType: "dynamic_tool_call",
          title: "connection_search",
          data: {
            result: {
              kind: "plugin-search-results",
              query: "email",
              total: 1,
              sources: { directory: "available", composio: "available" },
              recommendations: [
                {
                  id: "composio:gmail",
                  source: "composio",
                  name: "Gmail",
                  description: "Read and send email.",
                  action: "connect",
                  logoUrl: "https://logos.composio.dev/api/gmail",
                },
              ],
            },
          },
        },
      },
    ];

    hooks.beginRender();

    const row = visitElements(
      BotThreadLanding({ botId: parentBot.id, threadRef: chatRef }),
      (element) => element.type === AssistantMessageRow,
    ) as ReactElement<Parameters<typeof AssistantMessageRow>[0]> | null;

    const result = row?.props.pluginResults?.[0]?.result;

    expect(result?.query).toBe("email");
    expect(result?.recommendations[0]?.name).toBe("Gmail");
  });

  it("renders provider questions inside the bot conversation", () => {
    mocks.pendingUserInputs = [
      {
        requestId: ApprovalRequestId.make("question-request"),
        createdAt: "2026-09-02T20:00:00.000Z",
        questions: [
          {
            id: "snack",
            header: "Question",
            question: "If you had to pick a snack right now, which one?",
            options: [
              { label: "Chips", description: "Chips" },
              { label: "Fruit", description: "Fruit" },
              { label: "Chocolate", description: "Chocolate" },
            ],
            multiSelect: false,
          },
        ],
      },
    ];

    hooks.beginRender();

    const card = visitElements(
      BotThreadLanding({ botId: parentBot.id, threadRef: chatRef }),
      (element) => element.type === ComposerPendingUserInputPanel,
    ) as ReactElement<Parameters<typeof ComposerPendingUserInputPanel>[0]> | null;

    expect(card?.props.pendingUserInputs[0]?.questions[0]?.question).toBe(
      "If you had to pick a snack right now, which one?",
    );
  });

  it("renders pending provider questions in group threads", () => {
    mocks.groupPendingUserInputs = [
      {
        requestId: "group-question" as PendingUserInput["requestId"],
        createdAt: "2026-09-01T00:00:00.000Z",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which workspace should I use?",
            options: [{ label: "Current", description: "Use the current workspace." }],
            multiSelect: false,
          },
        ],
      },
    ];

    hooks.beginRender();

    const prompt = visitElements(
      GroupThreadLanding({ groupId: group.id, threadRef: chatRef }),
      (element) => element.type === BotUserInputPrompt,
    ) as ReactElement<Parameters<typeof BotUserInputPrompt>[0]> | null;

    expect(prompt?.props.pendingUserInputs).toEqual(mocks.groupPendingUserInputs);
    expect(prompt?.props.onSelectOption).toBeTypeOf("function");
    expect(prompt?.props.onAnswerWithText).toBeTypeOf("function");
  });

  it("keeps the active turn's intermediate answer out of the group transcript", () => {
    const turnId = TurnId.make("turn-active");
    const timestamp = "2026-09-11T12:00:00.000Z";
    mocks.groupMessages = [
      {
        id: MessageId.make("group-user"),
        role: "user",
        text: "Compare the options.",
        turnId,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: MessageId.make("group-intermediate"),
        role: "assistant",
        text: "Let me look.",
        turnId,
        respondingBotId: BotId.make(parentBot.id),
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    mocks.latestTurn = {
      turnId,
      state: "running",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      assistantMessageId: null,
    };

    hooks.beginRender();
    const rendered = GroupThreadLanding({ groupId: group.id, threadRef: chatRef });

    const provider = visitElements(
      rendered,
      (element) => element.props.testId === "group-provider-message",
    );

    const sent = visitElements(
      rendered,
      (element) => element.props.testId === "group-user-message",
    );

    expect(sent).not.toBeNull();
    expect(provider).toBeNull();
  });

  it("shows the group answer again once the turn settles", () => {
    const turnId = TurnId.make("turn-settled");
    const timestamp = "2026-09-11T12:00:00.000Z";
    mocks.groupMessages = [
      {
        id: MessageId.make("group-user"),
        role: "user",
        text: "Compare the options.",
        turnId,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: MessageId.make("group-answer"),
        role: "assistant",
        text: "Here is the comparison.",
        turnId,
        respondingBotId: BotId.make(parentBot.id),
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];

    hooks.beginRender();

    const provider = visitElements(
      GroupThreadLanding({ groupId: group.id, threadRef: chatRef }),
      (element) => element.props.testId === "group-provider-message",
    );

    expect(provider).not.toBeNull();
  });

  it.each([
    ["bot", () => BotThreadLanding({ botId: parentBot.id, threadRef: chatRef })],
    ["group", () => GroupThreadLanding({ groupId: group.id, threadRef: chatRef })],
  ])("does not report the %s composer as sending while an approval waits", (_kind, render) => {
    const timestamp = "2026-09-11T12:00:00.000Z";
    mocks.latestTurn = {
      turnId: TurnId.make("turn-approval"),
      state: "running",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      assistantMessageId: null,
    };
    mocks.approvals = [
      {
        requestId: ApprovalRequestId.make("approval-1"),
        requestKind: "command",
        createdAt: timestamp,
        detail: "Run the tests?",
        options: [
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Allow" },
        ],
        resolution: null,
      },
    ];

    hooks.beginRender();
    const tree = render();

    const composer = visitElements(
      tree,
      (element) => element.type === BotPromptComposer,
    ) as ReactElement<Parameters<typeof BotPromptComposer>[0]> | null;

    expect(composer?.props.busy).toBe(false);
    // The approval waits inline in the transcript, not docked on the composer.
    expect(composer?.props.pendingActionSlot ?? null).toBeNull();
    expect(composer?.props.quietSurface ?? false).toBe(false);
    expect(visitElements(tree, (element) => element.type === InlineApproval)).not.toBeNull();
    expect(visitElements(tree, (element) => element.type === BotActivityStatus)).toBeNull();
  });

  it("shows two bots' pending approvals as two cards, each named and answered on its own", () => {
    const at = (minute: number) => `2026-09-11T12:0${minute}:00.000Z`;

    const reply = (id: string, turn: string, botId: string, minute: number) =>
      ({
        id: MessageId.make(id),
        role: "assistant",
        text: id,
        turnId: TurnId.make(turn),
        respondingBotId: BotId.make(botId),
        streaming: false,
        createdAt: at(minute),
        updatedAt: at(minute),
      }) satisfies OrchestrationMessage;

    mocks.groupMessages = [
      { ...message("ask", "user", "turn-ask", 1) },
      reply("otto-says", "turn-otto", parentBot.id, 2),
      reply("mori-says", "turn-mori", childBot.id, 3),
    ];

    const approval = (id: string, turn: string, minute: number, command: string) =>
      ({
        requestId: ApprovalRequestId.make(id),
        requestKind: "command",
        createdAt: at(minute),
        turnId: TurnId.make(turn),
        args: { command },
        resolution: null,
      }) satisfies ApprovalRecord;

    mocks.approvals = [
      approval("otto-approval", "turn-otto", 4, "pnpm test"),
      approval("mori-approval", "turn-mori", 5, "git status"),
    ];

    hooks.beginRender();
    const tree = GroupThreadLanding({ groupId: group.id, threadRef: chatRef });
    const cards: Array<Parameters<typeof InlineApproval>[0]> = [];

    visitElements(tree, (element) => {
      if (element.type === InlineApproval) {
        const props: unknown = element.props;
        cards.push(props as Parameters<typeof InlineApproval>[0]);
      }

      return false;
    });

    expect(cards.map((card) => [card.approval.requestId, card.bot?.name ?? null])).toEqual([
      ["otto-approval", "Otto"],
      ["mori-approval", "Mori"],
    ]);

    void cards[1]?.onRespond(ApprovalRequestId.make("mori-approval"), "decline");
    void cards[0]?.onRespond(ApprovalRequestId.make("otto-approval"), "accept");
    expect(mocks.respond.mock.calls).toEqual([
      ["mori-approval", "decline"],
      ["otto-approval", "accept"],
    ]);

    const composer = visitElements(
      tree,
      (element) => element.type === BotPromptComposer,
    ) as ReactElement<Parameters<typeof BotPromptComposer>[0]> | null;

    expect(composer?.props.pendingActionSlot ?? null).toBeNull();
  });

  it.each([
    ["bot", () => BotThreadLanding({ botId: parentBot.id, threadRef: chatRef })],
    ["group", () => GroupThreadLanding({ groupId: group.id, threadRef: chatRef })],
  ])("reports the %s composer as sending while a turn runs", (_kind, render) => {
    const timestamp = "2026-09-11T12:00:00.000Z";
    mocks.latestTurn = {
      turnId: TurnId.make("turn-running"),
      state: "running",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      assistantMessageId: null,
    };

    hooks.beginRender();
    const tree = render();

    const composer = visitElements(
      tree,
      (element) => element.type === BotPromptComposer,
    ) as ReactElement<Parameters<typeof BotPromptComposer>[0]> | null;

    expect(composer?.props.busy).toBe(true);
    expect(
      visitElements(
        tree,
        (element) => element.type === BotActivityStatus || element.type === GroupWorkingRows,
      ),
    ).not.toBeNull();
  });

  it.each([
    ["bot", () => BotThreadLanding({ botId: parentBot.id, threadRef: chatRef })],
    ["group", () => GroupThreadLanding({ groupId: group.id, threadRef: chatRef })],
  ])("renders an active runtime warning in the %s conversation", (_kind, render) => {
    const turnId = TurnId.make("turn-warning");
    const timestamp = "2026-09-11T12:00:00.000Z";
    mocks.latestTurn = {
      turnId,
      state: "running",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      assistantMessageId: null,
    };
    mocks.activities = [
      {
        id: EventId.make("warning-current"),
        tone: "info",
        kind: "runtime.warning",
        summary: "Usage limit reached",
        payload: { message: "Claude is paused until the usage window resets." },
        turnId,
        createdAt: timestamp,
      },
    ];

    hooks.beginRender();

    const banner = visitElements(
      render(),
      (element) => element.type === ThreadRuntimeWarningBanner,
    ) as ReactElement<Parameters<typeof ThreadRuntimeWarningBanner>[0]> | null;

    expect(banner?.props.warning).toBe("Claude is paused until the usage window resets.");
  });
});
