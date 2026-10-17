import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import { ProviderDriverKind, type ProviderRuntimeEvent, TaskId } from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";
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

const startCodex = Effect.gen(function* () {
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

  return { controller, events, eventsFiber };
});

const turnEvents = (events: ReadonlyArray<ProviderRuntimeEvent>, type: string) =>
  events.flatMap((event) => (event.type === type ? [event.turnId] : []));

describe("AgentControllerLive signals", () => {
  it.effect("adds a message to the running turn without starting another", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { controller, events, eventsFiber } = yield* startCodex;
        const first = yield* controller.sendTurn({ threadId: codexThreadId, input: "Plan a trip" });
        mastra.setRunId("run-1");

        const signalled = yield* controller.signalTurn({
          threadId: codexThreadId,
          input: "Use Madrid instead",
        });

        expect(signalled).toBe(true);
        expect(mastra.sendSignal).toHaveBeenCalledWith(
          { type: "user", contents: "Use Madrid instead" },
          { requireDelivery: true },
        );
        expect(mastra.sendMessage).toHaveBeenCalledTimes(1);

        mastra.setRunId(null);
        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        yield* Effect.yieldNow;
        expect(turnEvents(events, "turn.started")).toEqual([first.turnId]);
        expect(turnEvents(events, "turn.completed")).toEqual([first.turnId]);
        expect(mastra.sendMessage).toHaveBeenCalledTimes(1);
        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("wakes an idle bot with a task event and adds a later one to its run", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    const wake = (commentId: string) =>
      ({
        type: "commented",
        taskId: TaskId.make("task-launch"),
        by: { key: "person:ada", name: "Ada" },
        commentId,
        reason: "mention",
        text: "@Nova is this ready?",
      }) as const;

    const comment = (commentId: string) => ({
      type: "notification",
      tagName: "comment",
      contents: "@Nova is this ready?",
      attributes: expect.objectContaining({ comment_id: commentId, author: "Ada" }),
    });

    return provideController(
      Effect.gen(function* () {
        const { controller, events, eventsFiber } = yield* startCodex;

        const first = yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "@Nova is this ready?",
          taskWake: wake("c-1"),
        });

        yield* Effect.promise(() =>
          vi.waitFor(() => expect(mastra.queueSignal).toHaveBeenCalled()),
        );
        expect(mastra.queueSignal).toHaveBeenCalledWith(expect.objectContaining(comment("c-1")));
        expect(mastra.sendMessage).not.toHaveBeenCalled();

        mastra.setRunId("run-1");
        expect(
          yield* controller.signalTurn({
            threadId: codexThreadId,
            input: "@Nova is this ready?",
            taskWake: wake("c-2"),
          }),
        ).toBe(true);
        expect(mastra.sendSignal).toHaveBeenCalledWith(expect.objectContaining(comment("c-2")), {
          requireDelivery: true,
        });

        mastra.setRunId(null);
        mastra.finishSend();
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(turnEvents(events, "turn.completed")).toEqual([first.turnId])),
        );
        expect(turnEvents(events, "turn.started")).toEqual([first.turnId]);
        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("declines a signal when no run can read it", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { controller, eventsFiber } = yield* startCodex;
        const signal = { threadId: codexThreadId, input: "Are you there?" };

        expect(yield* controller.signalTurn(signal)).toBe(false);

        yield* controller.sendTurn({ threadId: codexThreadId, input: "Plan a trip" });
        expect(yield* controller.signalTurn(signal)).toBe(false);

        mastra.setRunId("run-1");
        mastra.emit({ type: "agent_end", reason: "suspended" } as AgentControllerEvent);
        yield* Effect.yieldNow;
        expect(yield* controller.signalTurn(signal)).toBe(false);
        expect(mastra.sendSignal).not.toHaveBeenCalled();
        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
    );
  });

  it.effect("sends attached files with the signal", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-signal-image-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "image-1.png"), "image");

    return provideController(
      Effect.gen(function* () {
        const { controller, eventsFiber } = yield* startCodex;
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Plan a trip" });
        mastra.setRunId("run-1");

        yield* controller.signalTurn({
          threadId: codexThreadId,
          input: "This one",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "hotel.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        });

        expect(mastra.sendSignal).toHaveBeenCalledWith(
          {
            type: "user",
            contents: [
              {
                type: "text",
                text: `This one\n\n[Attached image "hotel.png" is saved at: ${NodePath.join(attachmentsDir, "image-1.png")}]`,
              },
              { type: "file", data: "aW1hZ2U=", mediaType: "image/png", filename: "hotel.png" },
            ],
          },
          { requireDelivery: true },
        );
        yield* Fiber.interrupt(eventsFiber);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("inlines a text file, which models only take as text", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-signal-text-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "file-1.txt"), "Codename: ```HERON```");

    return provideController(
      Effect.gen(function* () {
        const { controller, eventsFiber } = yield* startCodex;
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Plan a trip" });
        mastra.setRunId("run-1");

        yield* controller.signalTurn({
          threadId: codexThreadId,
          input: "Use this",
          attachments: [
            {
              type: "file",
              id: "file-1",
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 21,
            },
          ],
        });

        expect(mastra.sendSignal).toHaveBeenCalledWith(
          {
            type: "user",
            contents: [
              "Use this",
              `[Attached file "notes.txt" is saved at: ${NodePath.join(attachmentsDir, "file-1.txt")}]`,
              "[File: notes.txt]\n````\nCodename: ```HERON```\n````",
            ].join("\n\n"),
          },
          { requireDelivery: true },
        );
        yield* Fiber.interrupt(eventsFiber);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("shows a run Mastra starts for a late signal as its own turn", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        const { controller, events, eventsFiber } = yield* startCodex;
        const first = yield* controller.sendTurn({ threadId: codexThreadId, input: "Plan a trip" });
        mastra.emit({ type: "agent_start" } as AgentControllerEvent);
        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        yield* Effect.yieldNow;

        mastra.emit({ type: "agent_start" } as AgentControllerEvent);
        yield* Effect.yieldNow;
        const started = turnEvents(events, "turn.started");
        expect(started).toHaveLength(2);
        expect(started[0]).toBe(first.turnId);
        expect(started[1]).not.toBe(first.turnId);

        mastra.emit({ type: "agent_end", reason: "complete" } as AgentControllerEvent);
        yield* Effect.yieldNow;
        expect(turnEvents(events, "turn.completed")).toEqual(started);
        expect(mastra.sendMessage).toHaveBeenCalledTimes(1);
        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
    );
  });
});
