import * as Predicate from "effect/Predicate";
import { BotId, CommandId, EventId, MessageId, ThreadId } from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { applyAuthenticatedCommandActor } from "./AuthenticatedCommand.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import {
  makeReadModel,
  makeBot,
  BOSS_ID,
  GROUP_ID,
  SPECIALIST_ID,
  makeGroup,
  makeGroupThread,
  startTurnCommand,
  NOW,
  decodeOrchestrationEvent,
  PERSON_ID,
  decodeClientCommand,
  applyCommand,
} from "./test-support/GroupDeciderFixtures.ts";

const groupTurnCommand = (botId: BotId) =>
  ({
    type: "thread.group-turn.start",
    commandId: CommandId.make(`cmd-group-turn-${botId}`),
    threadId: ThreadId.make("thread-group"),
    botId,
    messageId: MessageId.make("message-1"),
    input: "Please investigate.",
    attachments: [],
    createdAt: NOW,
  }) as const;

it.layer(NodeServices.layer)("group membership decider", (it) => {
  it.effect("records a person's group message without starting a turn", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
        ],
        groups: [makeGroup()],
        threads: [makeGroupThread()],
      });

      for (const command of [startTurnCommand(), startTurnCommand(SPECIALIST_ID)]) {
        const result = yield* decideOrchestrationCommand({ command, readModel });

        expect((Array.isArray(result) ? result : [result]).map((event) => event.type)).toEqual([
          "thread.message-sent",
        ]);
      }
    }),
  );

  it.effect("starts one bot's group turn with its own engine and the round's input", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel({
        bots: [
          makeBot({
            id: BOSS_ID,
            groupId: GROUP_ID,
            provider: "boss-provider",
            model: "boss-model",
          }),
          makeBot({
            id: SPECIALIST_ID,
            groupId: GROUP_ID,
            provider: "specialist-provider",
            model: "specialist-model",
          }),
        ],
        groups: [makeGroup()],
        threads: [makeGroupThread()],
      });

      const started = yield* applyCommand(readModel, groupTurnCommand(SPECIALIST_ID));

      expect(started.events.map((event) => event.type)).toEqual(["thread.turn-start-requested"]);
      expect(started.events[0]?.payload).toMatchObject({
        respondingBotId: SPECIALIST_ID,
        messageId: "message-1",
        modelSelection: { instanceId: "specialist-provider", model: "specialist-model" },
        groupInput: { text: "Please investigate.", attachments: [] },
      });
      expect(started.readModel.threads[0]?.respondingBotId).toBe(SPECIALIST_ID);
    }),
  );

  it.effect("refuses a group turn for a non-member or archived member", () =>
    Effect.gen(function* () {
      const outsiderId = BotId.make("bot-outsider");

      const base = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID, archivedAt: NOW }),
          makeBot({ id: outsiderId }),
        ],
        groups: [makeGroup()],
        threads: [makeGroupThread()],
      });

      const outsiderError = yield* decideOrchestrationCommand({
        command: groupTurnCommand(outsiderId),
        readModel: base,
      }).pipe(Effect.flip);

      const archivedError = yield* decideOrchestrationCommand({
        command: groupTurnCommand(SPECIALIST_ID),
        readModel: base,
      }).pipe(Effect.flip);

      if (
        !Predicate.isTagged(outsiderError, "OrchestrationCommandInvariantError") ||
        !Predicate.isTagged(archivedError, "OrchestrationCommandInvariantError")
      ) {
        throw new Error("Expected group turn invariant errors");
      }

      expect(outsiderError.detail).toContain("not a member");
      expect(archivedError.detail).toContain("archived");
    }),
  );

  it.effect("replays group.created events from before membership", () =>
    Effect.gen(function* () {
      const event = yield* decodeOrchestrationEvent({
        sequence: 1,
        eventId: EventId.make("event-old-group"),
        aggregateKind: "group",
        aggregateId: GROUP_ID,
        type: "group.created",
        occurredAt: NOW,
        commandId: CommandId.make("cmd-old-group"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-old-group"),
        metadata: {},
        payload: {
          groupId: GROUP_ID,
          name: "Legacy group",
          createdAt: NOW,
          updatedAt: NOW,
        },
      });

      const replayed = yield* projectEvent(createEmptyReadModel(NOW), event);

      expect(replayed.groups).toEqual([
        {
          id: GROUP_ID,
          name: "Legacy group",
          bossBotId: null,
          members: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
    }),
  );

  it.effect("records the authenticated sender of a client group message", () =>
    Effect.gen(function* () {
      const model = makeReadModel({
        bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
        groups: [makeGroup()],
        threads: [makeGroupThread()],
      });

      const decoded = yield* decodeClientCommand({
        type: "thread.turn.start",
        commandId: "cmd-message-mention",
        threadId: "thread-group",
        message: {
          messageId: "message-mention",
          role: "user",
          text: "@bot-specialist check the logs",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        respondingBotId: SPECIALIST_ID,
        // A client cannot claim to be someone else; the server sets the sender.
        senderPersonId: "person-forged",
        createdAt: NOW,
      });

      if (decoded.type !== "thread.turn.start") throw new Error("Expected a turn start");

      const sent = yield* applyCommand(
        model,
        applyAuthenticatedCommandActor(
          { ...decoded, message: { ...decoded.message, attachments: [] } },
          { personId: PERSON_ID, displayName: "Member", canManageGroups: false },
        ),
      );

      expect(sent.events.map((event) => event.type)).toEqual(["thread.message-sent"]);
      expect(sent.events[0]?.payload).toMatchObject({
        authorPersonId: PERSON_ID,
        text: "@bot-specialist check the logs",
      });
    }),
  );

  it.effect("attributes a server-authored group message to a named member bot", () =>
    Effect.gen(function* () {
      const outsiderId = BotId.make("bot-outsider");

      const base = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: outsiderId }),
        ],
        groups: [makeGroup()],
        threads: [{ ...makeGroupThread(), respondingBotId: BOSS_ID }],
      });

      const message = (botId: BotId, type: "delta" | "complete") =>
        type === "delta"
          ? ({
              type: "thread.message.assistant.delta",
              commandId: CommandId.make(`cmd-delta-${botId}`),
              threadId: ThreadId.make("thread-group"),
              messageId: MessageId.make("message-result"),
              delta: "Finished work for Boss: Research\n\nDone.",
              respondingBotId: botId,
              createdAt: NOW,
            } as const)
          : ({
              type: "thread.message.assistant.complete",
              commandId: CommandId.make(`cmd-complete-${botId}`),
              threadId: ThreadId.make("thread-group"),
              messageId: MessageId.make("message-result"),
              respondingBotId: botId,
              createdAt: NOW,
            } as const);

      const delta = yield* applyCommand(base, message(SPECIALIST_ID, "delta"));
      const complete = yield* applyCommand(delta.readModel, message(SPECIALIST_ID, "complete"));
      expect(complete.readModel.threads[0]?.messages).toEqual([
        expect.objectContaining({
          id: MessageId.make("message-result"),
          role: "assistant",
          respondingBotId: SPECIALIST_ID,
          turnId: null,
          streaming: false,
        }),
      ]);
      // The group's own responder is unchanged by an attributed message.
      expect(complete.readModel.threads[0]?.respondingBotId).toBe(BOSS_ID);

      const outsiderError = yield* decideOrchestrationCommand({
        command: message(outsiderId, "delta"),
        readModel: base,
      }).pipe(Effect.flip);

      expect(outsiderError._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects attributing a direct chat message to another bot", () =>
    Effect.gen(function* () {
      const base = makeReadModel({
        bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
        threads: [{ ...makeGroupThread(), groupId: null, botId: BOSS_ID }],
      });

      const command = {
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-direct-delta"),
        threadId: ThreadId.make("thread-group"),
        messageId: MessageId.make("message-direct"),
        delta: "Hello",
        createdAt: NOW,
      } as const;

      const error = yield* decideOrchestrationCommand({
        command: { ...command, respondingBotId: SPECIALIST_ID },
        readModel: base,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      const own = yield* applyCommand(base, { ...command, respondingBotId: BOSS_ID });
      expect(own.readModel.threads[0]?.messages[0]?.respondingBotId).toBe(BOSS_ID);
    }),
  );
});
