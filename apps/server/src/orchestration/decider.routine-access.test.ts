import {
  AuthSessionId,
  BotId,
  CommandId,
  EventId,
  ProjectId,
  RoutineId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { makeBot, makeThread, NOW } from "./test-support/delegation-decider-fixtures.ts";

const BOT_ID = BotId.make("bot-1");

const ANA = AuthSessionId.make("user-ana");

const BEN = AuthSessionId.make("user-ben");

const PROJECT = ProjectId.make("project-1");

const ANA_CHAT = ThreadId.make("thread-ana");

const BEN_CHAT = ThreadId.make("thread-ben");

const privateChat = (id: ThreadId, createdBy: AuthSessionId) => ({
  ...makeThread(id, BOT_ID),
  createdBy,
  visibility: "user" as const,
});

const draft = (
  fields: Partial<Extract<OrchestrationCommand, { type: "routine.draft" }>> = {},
): Extract<OrchestrationCommand, { type: "routine.draft" }> => ({
  type: "routine.draft",
  commandId: CommandId.make("command-routine-draft"),
  routineId: RoutineId.make("routine-new"),
  botId: BOT_ID,
  targetThreadId: BEN_CHAT,
  threadMode: "target",
  job: "Daily brief",
  procedure: "Summarize this chat.",
  schedule: { kind: "daily", time: "09:00" },
  timezone: "UTC",
  skillAssignmentIds: [],
  connectorDependencies: [],
  projectId: PROJECT,
  sandbox: "local",
  approvalPolicy: "approval-required",
  delegateToBotId: null,
  createdBy: ANA,
  visibility: "organization",
  createdAt: NOW,
  ...fields,
});

/** Ana's private routine posts in her private chat; Ben has a chat of his own. */
const setup = Effect.gen(function* () {
  const model: OrchestrationReadModel = {
    ...createEmptyReadModel(NOW),
    bots: [makeBot(BOT_ID)],
    threads: [privateChat(ANA_CHAT, ANA), privateChat(BEN_CHAT, BEN)],
  };

  const created = yield* decideOrchestrationCommand({
    command: {
      type: "routine.create-approved",
      commandId: CommandId.make("command-routine-create"),
      routineId: RoutineId.make("routine-ana"),
      botId: BOT_ID,
      targetThreadId: ANA_CHAT,
      threadMode: "target",
      createdBy: ANA,
      visibility: "user",
      job: "Ana's brief",
      procedure: "Summarize this chat.",
      schedule: { kind: "daily", time: "09:00" },
      timezone: "UTC",
      skillAssignmentIds: [],
      connectorDependencies: [],
      projectId: PROJECT,
      sandbox: "local",
      approvalPolicy: "approval-required",
      delegateToBotId: null,
      createdAt: NOW,
    },
    readModel: model,
  });

  const event = Array.isArray(created) ? created[0] : created;

  return yield* projectEvent(model, {
    ...event,
    sequence: 1,
    eventId: EventId.make("event-routine-ana"),
  });
});

const decideAs = (
  personId: AuthSessionId,
  command: OrchestrationCommand,
  readModel: OrchestrationReadModel,
) =>
  decideOrchestrationCommand({
    command,
    readModel,
    actor: { personId, canManageGroups: false },
  });

const firstEvent = <Event>(result: Event | ReadonlyArray<Event>) =>
  Array.isArray(result) ? (result[0] as Event) : (result as Event);

it.layer(NodeServices.layer)("routine access", (it) => {
  it.effect("keeps an Only me routine to the person who set it up", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;

      const pause = {
        type: "routine.pause",
        commandId: CommandId.make("command-routine-pause"),
        routineId: RoutineId.make("routine-ana"),
        reason: "Paused by the user.",
        createdAt: NOW,
      } as const;

      const refused = yield* Effect.flip(decideAs(BEN, pause, readModel));

      expect(refused.message).toContain("private to the person who set it up");
      expect(firstEvent(yield* decideAs(ANA, pause, readModel)).type).toBe("routine.paused");
    }),
  );

  it.effect("records the person who drafts a routine as its creator", () =>
    Effect.gen(function* () {
      const event = firstEvent(yield* decideAs(BEN, draft(), yield* setup));

      expect(event.type).toBe("routine.drafted");
      expect(event.payload).toMatchObject({ routine: { createdBy: BEN } });
    }),
  );

  it.effect("refuses a draft into a chat the person cannot see", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideAs(BEN, draft({ targetThreadId: ANA_CHAT }), yield* setup),
      );

      expect(error.message).toContain("needs a chat you can see");
    }),
  );

  it.effect("refuses a draft with more permissions than its chat", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideAs(BEN, draft({ approvalPolicy: "full-access" }), yield* setup),
      );

      expect(error.message).toContain("runs with its chat's permissions");
    }),
  );
});
