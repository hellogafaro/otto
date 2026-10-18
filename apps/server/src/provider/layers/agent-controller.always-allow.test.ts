import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  ApprovalRequestId,
  AuthSessionId,
  BotId,
  ProviderDriverKind,
  type OrchestrationCommand,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { assert, describe, expect, vi } from "vite-plus/test";
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

/**
 * Starts a turn for bot-ops whose saved rules are the ones its Always allow answers added,
 * minus any the test removes from `saved`.
 */
const startBotTurn = (mastra: ReturnType<typeof mastraHarnessFixture>) =>
  Effect.gen(function* () {
    const controller = yield* AgentController;
    const events: ProviderRuntimeEvent[] = [];
    const saved: OrchestrationCommand[] = [];
    yield* controller.streamEvents.pipe(
      Stream.runForEach((event) => Effect.sync(() => events.push(event))),
      Effect.forkChild({ startImmediately: true }),
    );
    assert.isDefined(controller.configureDelegation);
    yield* controller.configureDelegation({
      readSnapshot: async () => {
        throw new Error("No snapshot in this test.");
      },
      readBot: async () => ({
        alwaysAllowed: saved.flatMap((command) =>
          command.type === "bot.update" && command.alwaysAllow ? [command.alwaysAllow] : [],
        ),
      }),
      dispatch: async (command) => {
        saved.push(command);

        return { sequence: saved.length };
      },
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

    const ask = (toolCallId: string, command: string) =>
      mastra.emit({
        type: "tool_approval_required",
        toolCallId,
        toolName: "shell",
        args: { command },
      } as AgentControllerEvent);

    const allowAlways = (toolCallId: string) =>
      controller.respondToRequest({
        threadId: codexThreadId,
        requestId: ApprovalRequestId.make(toolCallId),
        decision: "acceptAlways",
        responder: {
          personId: AuthSessionId.make("person-ana"),
          displayName: "Ana",
          canWrite: true,
        },
      });

    return { events, saved, ask, allowAlways };
  });

describe("AgentControllerLive Always allow", () => {
  it.effect("stops a removed rule on the next call of a running session", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { events, saved, ask, allowAlways } = yield* startBotTurn(mastra);
        ask("ls-1", "ls");
        yield* Effect.yieldNow;
        yield* allowAlways("ls-1");

        ask("ls-2", "ls -la");
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
              toolCallId: "ls-2",
              decision: "approve",
            }),
          ),
        );

        // The owner removes the rule in bot settings while the session keeps running.
        saved.length = 0;
        ask("ls-3", "ls -a");
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(events).toContainEqual(
              expect.objectContaining({ type: "request.opened", requestId: "ls-3" }),
            ),
          ),
        );
        expect(mastra.session.respondToToolApproval).not.toHaveBeenCalledWith({
          toolCallId: "ls-3",
          decision: "approve",
        });
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("lets a delete-only rule through only calls that just delete", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { events, ask, allowAlways } = yield* startBotTurn(mastra);
        ask("rm-1", "rm ./scratch.txt");
        yield* Effect.yieldNow;
        yield* allowAlways("rm-1");

        ask("rm-2", "rm ./other.txt");
        ask("rm-push", "rm ./scratch.txt; git push origin main");
        ask("rm-newline-push", "rm ./scratch.txt\ngit push origin main");

        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
              toolCallId: "rm-2",
              decision: "approve",
            }),
          ),
        );

        for (const requestId of ["rm-push", "rm-newline-push"]) {
          // A chained command asks every time and cannot be always allowed.
          yield* Effect.promise(() =>
            vi.waitFor(() =>
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
              ),
            ),
          );
          expect(mastra.session.respondToToolApproval).not.toHaveBeenCalledWith({
            toolCallId: requestId,
            decision: "approve",
          });
        }

        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("offers and keeps Always allow for an Otto tool's own intent", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { events, saved, allowAlways } = yield* startBotTurn(mastra);

        const generate = (toolCallId: string) =>
          mastra.emit({
            type: "tool_approval_required",
            toolCallId,
            toolName: "image_create",
            args: { operation: "generate", prompt: "A red kite" },
          } as AgentControllerEvent);

        generate("image-1");
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(events).toContainEqual(
              expect.objectContaining({
                type: "request.opened",
                requestId: "image-1",
                payload: expect.objectContaining({
                  options: [
                    { decision: "decline", label: "Never" },
                    { decision: "acceptAlways", label: "Always allow" },
                    { decision: "accept", label: "Allow once" },
                  ],
                }),
              }),
            ),
          ),
        );
        yield* allowAlways("image-1");
        expect(saved).toContainEqual(
          expect.objectContaining({
            type: "bot.update",
            alwaysAllow: expect.objectContaining({ toolName: "image_create", action: null }),
          }),
        );

        generate("image-2");
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
              toolCallId: "image-2",
              decision: "approve",
            }),
          ),
        );
        mastra.finishSend();
      }),
      bridge.service,
      mastra.factory,
    );
  });
});
