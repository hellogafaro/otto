import * as NodeOS from "node:os";
import type { OrchestrationBot, OrchestrationEvent, ThreadId } from "@otto/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { AgentController } from "../provider/services/agent-controller.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { TextGeneration } from "../text-generation/text-generation.ts";
import { chatMemory, Memories, TEAM_MEMORY } from "./memories.ts";

/** How long a chat stays quiet before its new messages are reviewed. */
export const MEMORY_REVIEW_QUIET = "2 minutes";

const MESSAGE_CHARS = 2_000;

const TRANSCRIPT_CHARS = 24_000;

/** Prompts people never see, such as routine runs and a new bot's introduction. */
const HIDDEN_PROMPT = /^(routine|intro):/;

/** The newest messages that fit, oldest first, each as "Name: text". */
export function memoryTranscript(
  messages: ReadonlyArray<{ readonly speaker: string; readonly text: string }>,
): string {
  const lines: string[] = [];
  let length = 0;

  for (const message of messages.toReversed()) {
    const text = message.text.trim().replace(/\s+/g, " ");
    const line = `${message.speaker}: ${text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS)}…` : text}`;

    if (length + line.length > TRANSCRIPT_CHARS) break;
    lines.unshift(line);
    length += line.length + 1;
  }

  return lines.join("\n");
}

/**
 * Otto: keeps memory up to date on its own. When a chat goes quiet, its new messages and the
 * memory it can see go to the chat's own model, which adds, rewords, confirms or deletes lines
 * of the memory the chat learns into.
 */
const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const settings = yield* ServerSettingsService;
  const textGeneration = yield* TextGeneration;
  const memories = yield* Memories;
  const agentController = yield* AgentController;
  const pending = yield* FiberMap.make<ThreadId>();

  const review = Effect.fn("MemoryReview.review")(function* (threadId: ThreadId) {
    const current = yield* settings.getSettings;

    if (!current.memory.enabled) return;

    const thread = Option.getOrUndefined(
      yield* query.getThreadDetailById(threadId, { activityKinds: [] }),
    );

    if (!thread) return;

    const group =
      thread.groupId != null && query.getGroupById
        ? Option.getOrUndefined(yield* query.getGroupById(thread.groupId))
        : undefined;

    const memory = chatMemory(thread, group);
    const learn = memory?.learn;

    if (!memory || !learn) return;
    const since = (yield* memories.reviewedThrough(threadId)) ?? "";

    const messages = thread.messages.filter(
      (message) =>
        !message.streaming &&
        !HIDDEN_PROMPT.test(message.id) &&
        message.createdAt > since &&
        message.role !== "system" &&
        message.text.trim().length > 0,
    );

    const last = messages.at(-1);

    if (!last) return;

    // Only what people say is worth remembering; a bot talking to itself is not reviewed.
    if (!messages.some((message) => message.role === "user")) {
      return yield* memories.markReviewed(threadId, last.createdAt);
    }

    const bots = new Map<string, OrchestrationBot>();

    for (const botId of new Set(messages.flatMap((message) => message.respondingBotId ?? []))) {
      const bot = query.getBotById
        ? Option.getOrUndefined(yield* query.getBotById(botId))
        : undefined;

      if (bot) bots.set(botId, bot);
    }

    const reviewer = bots.get(
      thread.botId ??
        messages.findLast((message) => message.respondingBotId)?.respondingBotId ??
        "",
    );

    // The bot that answered in this chat reviews it, on the model it answers with.
    const { modelSelection } = yield* agentController.resolveEngine({
      threadId,
      engine: reviewer?.engine ?? null,
      fallback: thread.modelSelection,
      mode: "default",
      botConversation: true,
    });

    const transcript = memoryTranscript(
      messages.map((message) => ({
        speaker:
          message.role === "user"
            ? (message.authorDisplayName ?? "Someone")
            : `${(message.respondingBotId && bots.get(message.respondingBotId)?.name) || "Assistant"} (assistant)`,
        text: message.text,
      })),
    );

    const lines = yield* memories.read(memory);

    const project = memory.projectId
      ? Option.getOrUndefined(yield* query.getProjectShellById(memory.projectId))
      : undefined;

    const { changes } = yield* textGeneration.generateMemoryReview({
      cwd: NodeOS.tmpdir(),
      memory: lines
        .map(
          (line) =>
            `- [${line.id}] ${line.text}${line.resource === learn ? (line.editedBy ? " (written by a person)" : "") : " (read-only)"}`,
        )
        .join("\n"),
      transcript,
      today: DateTime.formatIso(yield* DateTime.now).slice(0, 10),
      learner: learn === TEAM_MEMORY ? "team" : "person",
      project: project?.title ?? null,
      modelSelection,
    });

    const result = yield* memories.applyReview({ memory: { ...memory, learn }, threadId, changes });

    yield* memories.markReviewed(threadId, last.createdAt);

    if (changes.length > 0) {
      yield* Effect.logDebug("memory review applied", { threadId, ...result });
    }
  });

  const schedule = (event: OrchestrationEvent) =>
    event.type === "thread.message-sent" && !event.payload.streaming
      ? FiberMap.run(
          pending,
          event.payload.threadId,
          Effect.sleep(MEMORY_REVIEW_QUIET).pipe(
            Effect.andThen(review(event.payload.threadId)),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("memory review failed", {
                    threadId: event.payload.threadId,
                    cause: Cause.pretty(cause),
                  }),
            ),
          ),
        ).pipe(Effect.asVoid)
      : Effect.void;

  yield* Effect.forkScoped(Stream.runForEach(engine.streamDomainEvents, schedule));

  return { review };
});

export const MemoryReviewLive = Layer.effectDiscard(make);
