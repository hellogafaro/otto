import type { OttoMastraHarness } from "../../otto-mastra-harness.ts";
import { sessionFixture } from "./partial-fixtures.ts";
import type { OttoMastraSession } from "../../mastra/otto-harness-types.ts";
import type { OttoMastraState } from "../../otto-mastra-harness.ts";

import type { AgentControllerEvent, MastraDBMessage } from "@mastra/core/agent-controller";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";
import { type AgentControllerLiveOptions } from "../agent-controller.ts";
import { codexThreadId } from "./agent-controller-fixtures.ts";

export function mastraHarnessFixture() {
  const harnessOptions: Array<
    Parameters<NonNullable<AgentControllerLiveOptions["makeMastraHarness"]>>[0]
  > = [];

  const listeners = new Set<(event: AgentControllerEvent) => void>();
  let modeId = "build";
  let modelId = "openai/gpt-5.6-sol";
  let state: OttoMastraState = {};
  let resolveSend: (() => void) | undefined;
  const rejectSends: Array<(cause: unknown) => void> = [];
  let sendMessageCount = 0;
  const sendMessageWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = [];

  const sendMessage = vi.fn(() => {
    sendMessageCount += 1;

    for (const waiter of sendMessageWaiters.splice(0)) {
      if (sendMessageCount >= waiter.count) waiter.resolve();
      else sendMessageWaiters.push(waiter);
    }

    return new Promise<void>((resolve, reject) => {
      resolveSend = resolve;
      rejectSends.push(reject);
    });
  });

  let runId: string | null = null;

  const sendSignal = vi.fn((input: Parameters<OttoMastraSession["sendSignal"]>[0]) => ({
    id: `signal-${sendSignal.mock.calls.length}`,
    type: "type" in input ? input.type : ("user" as const),
    accepted: Promise.resolve({ accepted: true as const, action: "deliver" as const }),
  }));

  const session = sessionFixture({
    run: {
      getRunId: () => runId,
      waitForTeardown: async () => undefined,
    },
    state: {
      get: () => state,
      set: vi.fn(async (next: OttoMastraState) => {
        state = next;
      }),
    },
    mode: {
      get: () => modeId,
      switch: vi.fn(async ({ modeId: next }: { readonly modeId: string }) => {
        modeId = next;
      }),
    },
    model: {
      get: () => modelId,
      switch: vi.fn(async (next: string) => {
        modelId = next;
      }),
    },
    permissions: {
      setForCategory: vi.fn(async () => undefined),
      setForTool: vi.fn(async () => undefined),
    },
    grantTool: vi.fn(),
    subscribe: vi.fn((listener: (event: AgentControllerEvent) => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    }),
    sendMessage,
    sendSignal,
    abort: vi.fn(),
    respondToToolApproval: vi.fn(),
    respondToToolSuspension: vi.fn(async () => undefined),
  });

  const createSession = vi.fn(async <Input>(_input: Input) => session as never);
  const deleteSession = vi.fn(async () => true);

  const persistExternalTurn = vi.fn(
    async (_input: Parameters<NonNullable<OttoMastraHarness["persistExternalTurn"]>>[0]) =>
      undefined,
  );

  const factory: NonNullable<AgentControllerLiveOptions["makeMastraHarness"]> = (options) =>
    Effect.sync(() => {
      harnessOptions.push(options);

      return {
        controller: {
          init: vi.fn(async () => undefined),
          createSession,
          deleteSession,
        },
        persistExternalTurn,
      };
    });

  const emit = (event: AgentControllerEvent) => {
    for (const listener of listeners) listener(event);
  };

  const streamedParts = new Map<string, string[]>();

  /** Streams a message as Mastra does: a start, updates for changed parts, then an id-only end. */
  const emitMessage = (message: MastraDBMessage, { end = false }: { end?: boolean } = {}) => {
    const parts = message.content.parts.map((part) => JSON.stringify(part));
    const previous = streamedParts.get(message.id);

    if (!previous) emit({ type: "message_start", message: structuredClone(message) });

    if (previous) {
      for (const [index, part] of message.content.parts.entries()) {
        if (previous[index] === parts[index]) continue;
        emit({ type: "message_update", id: message.id, event: { type: "part", index, part } });
      }
    }

    streamedParts.set(message.id, parts);

    if (!end) return;
    streamedParts.delete(message.id);
    emit({ type: "message_end", id: message.id });
  };

  return {
    factory,
    harnessOptions,
    session,
    createSession,
    deleteSession,
    sendMessage,
    sendSignal,
    persistExternalTurn,
    emit,
    emitMessage,
    /** Marks a Mastra run live, as it is from its first stream chunk to its end. */
    setRunId: (next: string | null) => {
      runId = next;
    },
    waitForSendMessageCount: (count: number) =>
      sendMessageCount >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => sendMessageWaiters.push({ count, resolve })),
    finishSend: () => resolveSend?.(),
    rejectSend: (index: number, cause: unknown) => rejectSends[index]?.(cause),
    failSend: (cause: unknown) => rejectSends.at(-1)?.(cause),
  };
}

export function assistantMessage(text: string, id = "assistant-message"): MastraDBMessage {
  return {
    id,
    role: "assistant",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    content: {
      format: 2,
      parts: [{ type: "text", text }],
    },
    threadId: String(codexThreadId),
    resourceId: String(codexThreadId),
  } as MastraDBMessage;
}
