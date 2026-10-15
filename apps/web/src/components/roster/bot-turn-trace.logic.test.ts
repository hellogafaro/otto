import {
  EventId,
  MessageId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildBotTurnTraces } from "./bot-turn-trace.logic";

const TURN = TurnId.make("turn-1");

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 15, 8, 0, seconds)).toISOString();

let nextId = 0;

function tool(
  kind: "tool.started" | "tool.completed",
  name: string,
  seconds: number,
  callId: string,
  payload: NonNullable<OrchestrationThreadActivity["payload"]>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`activity-${nextId++}`),
    createdAt: at(seconds),
    kind,
    summary: kind === "tool.started" ? `${name} started` : name,
    tone: "tool",
    payload: { itemType: "dynamic_tool_call", toolCallId: callId, ...payload },
    turnId: TURN,
  };
}

function message(id: string, role: "user" | "assistant", seconds: number): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text: id,
    turnId: role === "assistant" ? TURN : null,
    streaming: false,
    createdAt: at(seconds),
    updatedAt: at(seconds),
  };
}

const messages = [message("ask", "user", 0), message("answer", "assistant", 24)];

describe("buildBotTurnTraces", () => {
  it("lists a turn's tool calls in the past tense with the thinking between them", () => {
    const trace = buildBotTurnTraces(
      [
        tool("tool.started", "WebSearch", 5, "search", {
          data: { detail: "Madrid population 2025" },
        }),
        tool("tool.completed", "WebSearch", 9, "search", { status: "completed", data: {} }),
        tool("tool.started", "WebFetch", 9, "fetch", {
          data: { detail: "https://www.ine.es/consul/serie.do?L=0" },
        }),
        tool("tool.completed", "WebFetch", 10, "fetch", { status: "failed", data: {} }),
      ],
      messages,
    ).get(TURN);

    expect(trace?.workedMs).toBe(24_000);
    expect(
      trace?.steps.map((step) =>
        step.kind === "thought"
          ? ["thought", step.durationMs]
          : [step.label, step.detail, step.durationMs, step.failed],
      ),
    ).toEqual([
      ["thought", 5_000],
      ["Searched the web", "Madrid population 2025", 4_000, false],
      ["Read a web page", "ine.es/consul/serie.do", 1_000, true],
      ["thought", 14_000],
    ]);
  });

  it("opens a command into its command line and the start of its output", () => {
    const trace = buildBotTurnTraces(
      [
        tool("tool.started", "Shell", 1, "pwd", {
          itemType: "command_execution",
          data: { command: "pwd" },
        }),
        tool("tool.completed", "Shell", 2, "pwd", {
          itemType: "command_execution",
          status: "completed",
          data: { output: "/workspace" },
        }),
      ],
      messages,
    ).get(TURN);

    expect(trace?.steps[0]).toMatchObject({
      label: "Ran a command",
      detail: "pwd",
      terminal: "$ pwd\n/workspace",
    });
  });

  it("times a turn from the message that opened it, not one sent while it worked", () => {
    const trace = buildBotTurnTraces(
      [
        tool("tool.started", "WebSearch", 2, "search", { data: { detail: "Madrid weather" } }),
        tool("tool.completed", "WebSearch", 6, "search", { status: "completed", data: {} }),
      ],
      [message("ask", "user", 0), message("wait", "user", 7), message("answer", "assistant", 16)],
    ).get(TURN);

    expect(trace?.workedMs).toBe(16_000);
    expect(trace?.steps.map((step) => step.durationMs)).toEqual([2_000, 4_000, 10_000]);
  });

  it("gives no trace to a turn that only answered", () => {
    expect(buildBotTurnTraces([], messages).size).toBe(0);
  });

  it("leaves out plan updates", () => {
    const traces = buildBotTurnTraces(
      [
        tool("tool.started", "task_write", 2, "plan", {}),
        tool("tool.completed", "task_write", 3, "plan", {}),
      ],
      messages,
    );

    expect(traces.size).toBe(0);
  });
});
