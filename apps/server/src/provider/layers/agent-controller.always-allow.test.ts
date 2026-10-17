import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  ApprovalRequestId,
  AuthSessionId,
  BotId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { assert, describe, expect } from "vite-plus/test";
import { AgentController } from "../services/agent-controller.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive Always allow", () => {
  it.effect("lets a delete-only rule through only calls that just delete", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        const events: ProviderRuntimeEvent[] = [];
        yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );
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
          botId: BotId.make("bot-ops"),
        });
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Tidy up." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "rm-1",
          toolName: "shell",
          args: { command: "rm ./scratch.txt" },
        } as AgentControllerEvent);
        yield* Effect.yieldNow;
        yield* controller.respondToRequest({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("rm-1"),
          decision: "acceptAlways",
          responder: {
            personId: AuthSessionId.make("person-ana"),
            displayName: "Ana",
            canWrite: true,
          },
        });

        for (const [toolCallId, command] of [
          ["rm-2", "rm ./other.txt"],
          ["rm-push", "rm ./scratch.txt; git push origin main"],
          ["rm-newline-push", "rm ./scratch.txt\ngit push origin main"],
        ] as const) {
          mastra.emit({
            type: "tool_approval_required",
            toolCallId,
            toolName: "shell",
            args: { command },
          } as AgentControllerEvent);
        }

        yield* Effect.yieldNow;

        expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
          toolCallId: "rm-2",
          decision: "approve",
        });

        for (const requestId of ["rm-push", "rm-newline-push"]) {
          expect(mastra.session.respondToToolApproval).not.toHaveBeenCalledWith({
            toolCallId: requestId,
            decision: "approve",
          });
          // A chained command asks every time and cannot be always allowed.
          expect(events).toContainEqual(
            expect.objectContaining({
              type: "request.opened",
              requestId,
              payload: expect.objectContaining({
                options: [
                  { decision: "decline", label: "Never" },
                  { decision: "accept", label: "Allow once" },
                ],
              }),
            }),
          );
        }

        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });
});
