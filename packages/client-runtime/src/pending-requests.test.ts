import { EventId, TurnId, type OrchestrationThreadActivity } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveApprovalRecords,
  derivePendingApprovals,
  derivePendingRequests,
  derivePendingUserInputs,
} from "./pending-requests.ts";

let nextActivityId = 0;

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: OrchestrationThreadActivity["payload"];
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id ?? `activity-${nextActivityId++}`),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("approval records", () => {
  it("keeps every bot's approval, each answered or pending on its own", () => {
    const records = deriveApprovalRecords([
      makeActivity({
        kind: "approval.requested",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-juno",
        payload: { requestId: "juno-shell", requestKind: "command", toolName: "shell" },
      }),
      makeActivity({
        kind: "approval.requested",
        createdAt: "2026-02-23T00:00:02.000Z",
        turnId: "turn-nova",
        payload: { requestId: "nova-delegate", requestKind: "command", toolName: "delegate" },
      }),
      makeActivity({
        kind: "approval.resolved",
        createdAt: "2026-02-23T00:00:03.000Z",
        payload: {
          requestId: "nova-delegate",
          decision: "accept",
          actor: "user",
          respondedBy: "Ana",
        },
      }),
    ]);

    expect(
      records.map(({ requestId, turnId, resolution }) => ({ requestId, turnId, resolution })),
    ).toEqual([
      { requestId: "juno-shell", turnId: "turn-juno", resolution: null },
      {
        requestId: "nova-delegate",
        turnId: "turn-nova",
        resolution: { decision: "accept", actor: "user", respondedBy: "Ana" },
      },
    ]);
  });

  it("keeps an approval resolved before its request arrives as answered", () => {
    const records = deriveApprovalRecords([
      makeActivity({
        kind: "approval.resolved",
        payload: { requestId: "early", decision: "decline", actor: "user" },
      }),
      makeActivity({
        kind: "approval.requested",
        payload: { requestId: "early", requestKind: "command", toolName: "shell" },
      }),
    ]);

    expect(records.map((record) => record.resolution)).toEqual([
      { decision: "decline", actor: "user" },
    ]);
  });
});

describe("pending approvals", () => {
  it("carries command arguments from the matching tool activity", () => {
    const args = { command: 'printf "hi\\n"', cwd: null };

    const approvals = derivePendingApprovals([
      makeActivity({
        kind: "tool.started",
        payload: { toolCallId: "shell-1", data: { args } },
      }),
      makeActivity({
        kind: "approval.requested",
        payload: {
          requestId: "shell-1",
          requestKind: "command",
          toolName: "Shell",
        },
      }),
    ]);

    expect(approvals).toEqual([
      {
        requestId: "shell-1",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:00.000Z",
        toolName: "Shell",
        args,
      },
    ]);
  });

  it("carries command arguments when approval arrives before its tool activity", () => {
    const args = { command: "git status", cwd: "/workspace" };

    const approvals = derivePendingApprovals([
      makeActivity({
        kind: "approval.requested",
        payload: {
          requestId: "shell-reversed",
          requestKind: "command",
          toolName: "Shell",
        },
      }),
      makeActivity({
        kind: "tool.started",
        payload: { toolCallId: "shell-reversed", data: { args } },
      }),
    ]);

    expect(approvals[0]?.args).toEqual(args);
  });

  it("maps dynamic_tool_call approvals to the command kind", () => {
    expect(
      derivePendingApprovals([
        makeActivity({
          kind: "approval.requested",
          payload: {
            requestId: "req-dynamic-tool",
            requestType: "dynamic_tool_call",
            detail: "Search the web",
          },
        }),
      ]),
    ).toEqual([
      {
        requestId: "req-dynamic-tool",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:00.000Z",
        detail: "Search the web",
      },
    ]);
  });

  it.each(["tool_user_input", "auth_tokens_refresh"])(
    "does not turn %s into an approval",
    (requestType) => {
      expect(
        derivePendingApprovals([
          makeActivity({
            kind: "approval.requested",
            payload: { requestId: "not-an-approval", requestType },
          }),
        ]),
      ).toEqual([]);
    },
  );

  it("keeps a resolved approval closed when a later request activity arrives", () => {
    const activities = [
      makeActivity({
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.resolved",
        payload: { requestId: "req-closed" },
      }),
      makeActivity({
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        payload: { requestId: "req-closed", requestKind: "command" },
      }),
    ];

    expect(derivePendingRequests(activities).approvals).toEqual([]);
  });

  it("clears stale Codex approval callbacks", () => {
    expect(
      derivePendingApprovals([
        makeActivity({
          kind: "approval.requested",
          payload: { requestId: "req-stale-1", requestKind: "command" },
        }),
        makeActivity({
          kind: "provider.approval.respond.failed",
          payload: {
            requestId: "req-stale-1",
            detail: "Unknown pending Codex approval request: req-stale-1",
          },
        }),
      ]),
    ).toEqual([]);
  });
});

describe("pending questions", () => {
  it("keeps free-text questions that do not have options", () => {
    expect(
      derivePendingUserInputs([
        makeActivity({
          kind: "user-input.requested",
          payload: {
            requestId: "req-free-text",
            questions: [
              {
                id: "answer",
                header: "Question",
                question: "What should the bot do next?",
                options: [],
              },
            ],
          },
        }),
      ]),
    ).toMatchObject([
      {
        requestId: "req-free-text",
        questions: [{ id: "answer", question: "What should the bot do next?", options: [] }],
      },
    ]);
  });

  it("keeps a resolved question closed when a later request activity arrives", () => {
    expect(
      derivePendingUserInputs([
        makeActivity({
          createdAt: "2026-02-23T00:00:02.000Z",
          kind: "user-input.resolved",
          payload: { requestId: "req-closed" },
        }),
        makeActivity({
          createdAt: "2026-02-23T00:00:01.000Z",
          kind: "user-input.requested",
          payload: {
            requestId: "req-closed",
            questions: [
              {
                id: "q",
                header: "Q",
                question: "Choose",
                options: [{ label: "yes", description: "Yes" }],
              },
            ],
          },
        }),
      ]),
    ).toEqual([]);
  });

  it("clears stale pending user-input prompts including Codex callback errors", () => {
    expect(
      derivePendingUserInputs([
        makeActivity({
          kind: "user-input.requested",
          payload: {
            requestId: "req-user-input-stale-1",
            questions: [
              {
                id: "sandbox_mode",
                header: "Sandbox",
                question: "Which mode should be used?",
                options: [{ label: "workspace-write", description: "Allow workspace writes only" }],
              },
            ],
          },
        }),
        makeActivity({
          kind: "provider.user-input.respond.failed",
          payload: {
            requestId: "req-user-input-stale-1",
            detail:
              "Provider adapter request failed (codex) for item/tool/requestUserInput: Unknown pending Codex user input request: req-user-input-stale-1",
          },
        }),
      ]),
    ).toEqual([]);
  });

  it("preserves native question ids and option labels without trimming", () => {
    const question = {
      id: "  Which path?\n",
      header: " Path ",
      question: "  Which path?\n",
      options: [{ label: " Keep spaces ", description: "Keep" }],
      multiSelect: false,
    };

    expect(
      derivePendingUserInputs([
        makeActivity({
          kind: "user-input.requested",
          payload: {
            requestId: "native-question",
            questions: [
              question,
              { id: "bad", header: "bad", question: "bad", options: [{ label: 42 }] },
            ],
          },
        }),
      ])[0]?.questions,
    ).toEqual([question]);
  });
});
