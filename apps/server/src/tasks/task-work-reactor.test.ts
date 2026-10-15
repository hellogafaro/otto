import { it } from "@effect/vitest";
import {
  AuthSessionId,
  BotId,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationTask,
  ProjectId,
  TaskId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import {
  NOW,
  makeBot,
  makeReadModel,
} from "../orchestration/test-support/group-decider-fixtures.ts";
import {
  commentText,
  makeTaskWorkReactor,
  mentionedBots,
  taskChatId,
} from "./task-work-reactor.ts";

const NOVA = BotId.make("bot-nova");

const ADA = AuthSessionId.make("user-ada");

const task: OrchestrationTask = {
  id: TaskId.make("task-launch"),
  projectId: ProjectId.make("project-launch"),
  title: "Draft the launch post",
  description: "",
  owner: null,
  assignees: [],
  resources: [],
  dueDate: null,
  status: "pending",
  timeEntries: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const chat = taskChatId(task.id, NOVA);

const harness = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<OrchestrationEvent>();
  const dispatched: OrchestrationCommand[] = [];
  let sequence = 0;

  const readModel = {
    ...makeReadModel({ bots: [makeBot({ id: NOVA, provider: "codex", model: "gpt-test" })] }),
    tasks: [task],
  };

  const engine = Layer.mock(OrchestrationEngineService)({
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);

        return { sequence };
      }),
    subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
  });

  const projection = Layer.mock(ProjectionSnapshotQuery)({
    getCommandReadModel: () => Effect.succeed(readModel),
    getThreadShellById: () => Effect.succeed(Option.none()),
  });

  const reactor = yield* Effect.provide(
    makeTaskWorkReactor(() =>
      Effect.succeed([{ userId: ADA, displayName: "Ada", email: "ada@example.test" }]),
    ),
    Layer.mergeAll(engine, projection),
  );

  yield* reactor.start();

  const publish = (type: OrchestrationEvent["type"], payload: OrchestrationEvent["payload"]) =>
    Effect.gen(function* () {
      sequence += 1;

      yield* PubSub.publish(events, {
        sequence,
        eventId: EventId.make(`event-${sequence}`),
        aggregateKind: "task",
        aggregateId: task.id,
        occurredAt: NOW,
        commandId: CommandId.make(`command-${sequence}`),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type,
        payload,
        // SAFETY: Each call pairs a type with its own payload shape.
      } as OrchestrationEvent);

      yield* Effect.yieldNow;
      yield* reactor.drain;
    });

  const session = (status: OrchestrationSession["status"]) =>
    publish("thread.session-set", {
      threadId: chat,
      session: {
        threadId: chat,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });

  const reply = (text: string) =>
    publish("thread.message-sent", {
      threadId: chat,
      messageId: MessageId.make(`reply-${text.length}`),
      role: "assistant",
      text,
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: NOW,
      updatedAt: NOW,
    });

  return { dispatched, publish, session, reply };
});

const ofType = <T extends OrchestrationCommand["type"]>(
  commands: ReadonlyArray<OrchestrationCommand>,
  type: T,
) =>
  commands.filter(
    (command): command is Extract<OrchestrationCommand, { type: T }> => command.type === type,
  );

describe("TaskWorkReactor", () => {
  it.effect("starts the assigned bot in its task chat and posts its reply on the task", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dispatched, publish, session, reply } = yield* harness;

        yield* publish("task.updated", {
          task: { ...task, assignees: [{ kind: "bot", botId: NOVA }] },
          actor: { type: "person", id: ADA },
          changes: { assignees: { from: [], to: [{ kind: "bot", botId: NOVA }] } },
        });

        expect(ofType(dispatched, "thread.create")).toMatchObject([
          { threadId: chat, botId: NOVA, projectId: task.projectId, createdBy: ADA },
        ]);

        expect(ofType(dispatched, "thread.turn.start")[0]?.message.text).toContain(
          `Ada assigned you the task "Draft the launch post" (taskId: ${task.id})`,
        );

        yield* session("running");
        yield* reply("I'll read the task first.");
        yield* reply("Drafted it <in> the Library.");
        yield* session("ready");

        expect(ofType(dispatched, "task.comment.add")).toMatchObject([
          {
            taskId: task.id,
            content: "Drafted it &lt;in&gt; the Library.",
            by: { type: "bot", id: NOVA },
          },
        ]);
      }),
    ),
  );

  it.effect("answers a person's @mention but not a bot's, and not a bot assigning itself", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { dispatched, publish } = yield* harness;

        const mention = `Can you check this, <mention type="bot" id="${NOVA}">Nova</mention>?`;

        const comment = (
          actor: { type: "person"; id: AuthSessionId } | { type: "bot"; id: BotId },
        ) =>
          publish("task.commented", {
            task,
            comment: { id: "comment-1", content: mention, fileIds: [], actor, createdAt: NOW },
          });

        yield* comment({ type: "bot", id: NOVA });

        yield* publish("task.created", {
          task: { ...task, assignees: [{ kind: "bot", botId: NOVA }] },
          actor: { type: "bot", id: NOVA },
        });

        expect(dispatched).toEqual([]);

        yield* comment({ type: "person", id: ADA });

        expect(ofType(dispatched, "thread.turn.start")[0]?.message.text).toContain(
          'Ada mentioned you in a comment on the task "Draft the launch post"',
        );

        expect(ofType(dispatched, "thread.turn.start")[0]?.message.text).toContain(
          "Can you check this, @Nova?",
        );
      }),
    ),
  );
});

it("reads mentions and turns a comment into plain text", () => {
  const content =
    'Hi <mention type="bot" id="bot-a">A</mention> &amp; <mention type="person" id="p">P</mention> &lt;3';

  expect(mentionedBots(content)).toEqual(["bot-a"]);
  expect(commentText(content)).toBe("Hi @A & @P <3");
});
