import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  ApprovalRequestId,
  AuthSessionId,
  BotId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe, expect } from "vite-plus/test";
import { AgentController } from "../services/agent-controller.ts";
import {
  codexThreadId,
  openCodeGoThreadId,
  codexInstanceId,
  openCodeGoInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive", () => {
  it.effect("keeps protected tools approval-gated in full-access mode", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });

        expect(mastra.session.state.set).toHaveBeenCalledWith(
          expect.objectContaining({ yolo: false }),
        );
        expect(mastra.session.permissions.setForTool).not.toHaveBeenCalledWith({
          toolName: OTTO_CREATE_ROUTINE_TOOL_NAME,
          policy: expect.anything(),
        });
        expect(mastra.session.permissions.setForTool).toHaveBeenCalledWith({
          toolName: "shell",
          policy: "ask",
        });
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("keeps a pending approval across reconnect and grants one exact tool call", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Run pwd." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "shell-tool-1",
          toolName: "shell",
          args: { command: "pwd" },
        } as AgentControllerEvent);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "approval-required",
        });
        yield* controller.respondToRequest({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("shell-tool-1"),
          decision: "accept",
        });

        const runtime = mastra.harnessOptions[0]?.toolRuntime;
        assert.isDefined(runtime);

        const execution = {
          threadId: String(codexThreadId),
          toolId: "shell" as const,
          toolCallId: "shell-tool-1",
          input: { command: "pwd" },
          approvalMode: "require-grant" as const,
        };

        const receiptsFiber = yield* controller.streamEvents.pipe(
          Stream.filter((event) => event.type === "tool.receipt"),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;
        yield* Effect.promise(() => runtime.execute(execution));
        const receipts = yield* Fiber.join(receiptsFiber);
        assert.deepEqual(
          [...receipts].map((event) => event.payload.phase),
          ["start", "success"],
        );
        assert.isTrue([...receipts].every((event) => event.payload.fatalToThread === false));
        yield* Effect.promise(() =>
          expect(runtime.execute(execution)).rejects.toThrow("Tool 'shell' requires approval."),
        );
        expect(mastra.session.permissions.setForTool).not.toHaveBeenCalledWith({
          toolName: "shell",
          policy: "allow",
        });
        expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
          toolCallId: "shell-tool-1",
          decision: "approve",
        });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "send-tool-1",
          toolName: "gmail_send_message",
          args: { to: "user@example.com" },
        } as AgentControllerEvent);
        yield* controller.respondToRequest({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("send-tool-1"),
          decision: "decline",
        });

        const duplicateResponseError = yield* controller
          .respondToRequest({
            threadId: codexThreadId,
            requestId: ApprovalRequestId.make("send-tool-1"),
            decision: "accept",
          })
          .pipe(Effect.flip);

        expect(duplicateResponseError.message).toContain("no longer active");
        expect(mastra.session.respondToToolApproval).toHaveBeenCalledTimes(2);
        expect(mastra.session.respondToToolApproval).toHaveBeenLastCalledWith({
          toolCallId: "send-tool-1",
          decision: "decline",
        });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "shell-tool-stale",
          toolName: "gmail_send_message",
          args: { to: "user@example.com" },
        } as AgentControllerEvent);
        mastra.emit({
          type: "tool_end",
          toolCallId: "shell-tool-stale",
          result: "cancelled",
          isError: true,
        } as AgentControllerEvent);

        const staleResponseError = yield* controller
          .respondToRequest({
            threadId: codexThreadId,
            requestId: ApprovalRequestId.make("shell-tool-stale"),
            decision: "accept",
          })
          .pipe(Effect.flip);

        expect(staleResponseError.message).toContain("no longer active");
        expect(mastra.session.respondToToolApproval).not.toHaveBeenCalledWith({
          toolCallId: "shell-tool-stale",
          decision: "approve",
        });
        yield* controller.interruptTurn({ threadId: codexThreadId });
        yield* Effect.promise(() =>
          expect(runtime.execute({ ...execution, toolCallId: "shell-tool-stale" })).rejects.toThrow(
            "Tool 'shell' requires approval.",
          ),
        );
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("records who answered an approval and the choice they made", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        assert.isDefined(controller.configureDelegation);
        yield* controller.configureDelegation({
          readSnapshot: async () => {
            throw new Error("No snapshot in this test.");
          },
          dispatch: async () => ({ sequence: 1 }),
        });
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "approval-required",
          botId: BotId.make("bot-mail"),
        });
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Email Ana." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "send-tool-ana",
          toolName: "gmail_send_message",
          args: { to: "ana@example.com" },
        } as AgentControllerEvent);

        const resolvedFiber = yield* controller.streamEvents.pipe(
          Stream.filter((event) => event.type === "request.resolved"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;
        yield* controller.respondToRequest({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("send-tool-ana"),
          decision: "acceptAlways",
          responder: {
            personId: AuthSessionId.make("person-ana"),
            displayName: "Ana",
            canWrite: true,
          },
        });
        const [resolved] = yield* Fiber.join(resolvedFiber);

        assert.strictEqual(resolved?.type, "request.resolved");
        expect(resolved?.payload).toMatchObject({
          decision: "acceptAlways",
          respondedBy: "Ana",
          outcome: "approved",
        });
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("resolves pending approvals when a turn or session ends", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "auto",
        });
        const events: ProviderRuntimeEvent[] = [];

        const eventsFiber = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;

        yield* controller.sendTurn({ threadId: codexThreadId, input: "Finish." });

        for (const requestId of ["finish-1", "finish-2"]) {
          mastra.emit({
            type: "tool_approval_required",
            toolCallId: requestId,
            toolName: "gmail_send_message",
            args: { to: "person@example.com" },
          } as AgentControllerEvent);
        }

        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        mastra.finishSend();
        yield* Effect.yieldNow;

        yield* controller.sendTurn({ threadId: codexThreadId, input: "Interrupt." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "interrupt-1",
          toolName: "gmail_send_message",
          args: { to: "person@example.com" },
        } as AgentControllerEvent);
        yield* controller.interruptTurn({ threadId: codexThreadId });
        yield* Effect.yieldNow;

        yield* controller.sendTurn({ threadId: codexThreadId, input: "Stop." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "stop-1",
          toolName: "gmail_send_message",
          args: { to: "person@example.com" },
        } as AgentControllerEvent);
        yield* controller.stopSession({ threadId: codexThreadId });
        yield* Effect.yieldNow;

        const resolved = events.filter((event) => event.type === "request.resolved");
        expect(resolved.map((event) => event.requestId)).toEqual([
          "finish-1",
          "finish-2",
          "interrupt-1",
          "stop-1",
        ]);

        for (const event of resolved) {
          expect(event.payload).toMatchObject({
            decision: "cancel",
            actor: "system",
            outcome: "cancelled",
          });
        }

        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("approves question tools without showing an approval request", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        const events: ProviderRuntimeEvent[] = [];

        const collector = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Ask me a question." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "question-1",
          toolName: "ask_user",
          args: {
            question: "Pick one.",
            options: [{ label: "First", description: "Choose the first option" }],
          },
        } as AgentControllerEvent);
        yield* Effect.yieldNow;

        expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
          toolCallId: "question-1",
          decision: "approve",
        });
        expect(events.some((event) => event.type === "request.opened")).toBe(false);

        mastra.emit({
          type: "tool_suspended",
          toolCallId: "question-1",
          toolName: "ask_user",
          args: {},
          suspendPayload: {
            question: "Pick one.",
            options: [{ label: "First", description: "Choose the first option" }],
            selectionMode: "single_select",
          },
        } as AgentControllerEvent);
        yield* Effect.yieldNow;

        expect(events).toContainEqual(
          expect.objectContaining({
            type: "user-input.requested",
            requestId: "question-1",
            payload: expect.objectContaining({
              questions: [
                expect.objectContaining({
                  question: "Pick one.",
                  options: [{ label: "First", description: "Choose the first option" }],
                }),
              ],
            }),
          }),
        );
        yield* Fiber.interrupt(collector);
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("keeps a suspended Mastra turn active until tool input resumes", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Ask for input." });
        mastra.emit({
          type: "tool_suspended",
          toolCallId: "tool-input-1",
          toolName: "ask_user",
          args: {},
          suspendPayload: {},
        } as AgentControllerEvent);
        mastra.emit({ type: "agent_end", reason: "suspended" } as AgentControllerEvent);
        mastra.finishSend();
        yield* Effect.yieldNow;

        const [waiting] = yield* controller.listSessions();
        assert.isDefined(waiting?.activeTurnId);

        yield* controller.respondToUserInput({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("tool-input-1"),
          answers: { "tool-input-1": "Continue" },
        });
        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);

        const [completed] = yield* controller.listSessions();
        assert.isUndefined(completed?.activeTurnId);
        expect(mastra.session.respondToToolSuspension).toHaveBeenCalledWith({
          toolCallId: "tool-input-1",
          resumeData: "Continue",
        });
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("rejects an OpenCode Go approval after the provider is disabled", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* controller.resolveEngine({
          threadId: openCodeGoThreadId,
          engine: { provider: String(openCodeGoInstanceId), model: "gpt-5.6-luna" },
          fallback: codexSelection,
          mode: "default",
          botConversation: true,
        });
        yield* controller.startSession(openCodeGoThreadId, {
          threadId: openCodeGoThreadId,
          provider: ProviderDriverKind.make("opencodeGo"),
          providerInstanceId: openCodeGoInstanceId,
          cwd: process.cwd(),
          modelSelection: { instanceId: openCodeGoInstanceId, model: "gpt-5.6-luna" },
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId: openCodeGoThreadId, input: "Run a tool." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "disabled-approval",
          toolName: "shell",
          args: { command: "pwd" },
        } as AgentControllerEvent);

        bridge.disableBeforeNextDispatchAdmission();

        const error = yield* controller
          .respondToRequest({
            threadId: openCodeGoThreadId,
            requestId: ApprovalRequestId.make("disabled-approval"),
            decision: "accept",
          })
          .pipe(Effect.flip);

        assert.equal(error._tag, "ProviderValidationError");
        expect(mastra.session.respondToToolApproval).not.toHaveBeenCalled();
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("rejects OpenCode Go user input after the provider is disabled", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* controller.resolveEngine({
          threadId: openCodeGoThreadId,
          engine: { provider: String(openCodeGoInstanceId), model: "gpt-5.6-luna" },
          fallback: codexSelection,
          mode: "default",
          botConversation: true,
        });
        yield* controller.startSession(openCodeGoThreadId, {
          threadId: openCodeGoThreadId,
          provider: ProviderDriverKind.make("opencodeGo"),
          providerInstanceId: openCodeGoInstanceId,
          cwd: process.cwd(),
          modelSelection: { instanceId: openCodeGoInstanceId, model: "gpt-5.6-luna" },
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId: openCodeGoThreadId, input: "Ask for input." });
        mastra.emit({
          type: "tool_suspended",
          toolCallId: "disabled-user-input",
          toolName: "ask_user",
          args: {},
          suspendPayload: {},
        } as AgentControllerEvent);

        bridge.disableBeforeNextDispatchAdmission();

        const error = yield* controller
          .respondToUserInput({
            threadId: openCodeGoThreadId,
            requestId: ApprovalRequestId.make("disabled-user-input"),
            answers: { "disabled-user-input": "Continue" },
          })
          .pipe(Effect.flip);

        assert.equal(error._tag, "ProviderValidationError");
        expect(mastra.session.respondToToolSuspension).not.toHaveBeenCalled();
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });
});
