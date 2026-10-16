import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import { ProviderDriverKind, type ProviderRuntimeEvent } from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import { AgentController } from "../services/agent-controller.ts";
import {
  codexInstanceId,
  codexSelection,
  codexThreadId,
} from "./test-support/agent-controller-fixtures.ts";
import { assistantMessage, mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";

describe("AgentControllerLive stream retry", () => {
  it.effect("publishes a retried answer once", () => {
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

        const events: ProviderRuntimeEvent[] = [];

        const eventsFiber = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Fetch the page." });
        // Mastra streams into one live message and keeps the failed attempt's part.
        const live = assistantMessage("I'll fetch the page and check");
        mastra.emitMessage(live);
        mastra.harnessOptions[0]?.onStreamRetry?.(String(codexThreadId));
        live.content.parts.push({ type: "text", text: "I'll fetch the page and check its title." });
        mastra.emitMessage(live);
        mastra.emitMessage(live, { end: true });
        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        mastra.finishSend();
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(eventsFiber);

        assert.equal(
          events
            .flatMap((event) => (event.type === "content.delta" ? [event.payload.delta] : []))
            .join(""),
          "I'll fetch the page and check its title.",
        );
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("never publishes a group bot's NO_REPLY pass", () => {
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

        const events: ProviderRuntimeEvent[] = [];

        const eventsFiber = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Anyone?" });
        const pass = assistantMessage(" NO_REPLY\n");
        mastra.emitMessage(pass);
        mastra.emitMessage(pass, { end: true });
        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        mastra.finishSend();
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(eventsFiber);

        assert.deepEqual(
          events.filter(
            (event) =>
              event.type === "content.delta" ||
              (event.type === "item.started" && event.payload.itemType === "assistant_message"),
          ),
          [],
        );
        assert.isTrue(events.some((event) => event.type === "turn.completed"));
      }),
      bridge.service,
      mastra.factory,
    );
  });
});
