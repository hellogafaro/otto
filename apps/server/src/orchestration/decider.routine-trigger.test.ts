import {
  AuthSessionId,
  BotId,
  CommandId,
  EventId,
  ProjectId,
  RoutineId,
  RoutineRunId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type RoutineAppTrigger,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { makeBot, makeThread, NOW } from "./test-support/delegation-decider-fixtures.ts";

const BOT_ID = BotId.make("bot-1");

const ROUTINE_ID = RoutineId.make("routine-1");

const HOME = ProjectId.make("project-1");

const ANA = AuthSessionId.make("user-ana");

const gmail: RoutineAppTrigger = {
  type: "app",
  app: "gmail",
  event: "GMAIL_NEW_GMAIL_MESSAGE",
  title: "New Gmail message",
  connectionId: "gmail-ana",
  config: { labelIds: ["INBOX"] },
  triggerId: null,
};

let sequence = 10;

const apply = (
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
  actor?: { readonly personId: AuthSessionId; readonly canManageGroups: boolean },
) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({
      command,
      readModel,
      ...(actor ? { actor } : {}),
    });

    const event = (Array.isArray(result) ? result[0] : result) as Omit<
      OrchestrationEvent,
      "sequence"
    >;

    sequence += 1;

    return {
      event,
      readModel: yield* projectEvent(readModel, {
        ...event,
        sequence,
        eventId: EventId.make(`event-${sequence}`),
      } as OrchestrationEvent),
    };
  });

const setup = Effect.gen(function* () {
  let model = yield* projectEvent(createEmptyReadModel(NOW), {
    sequence: 1,
    eventId: EventId.make("event-project"),
    aggregateKind: "project",
    aggregateId: HOME,
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make("command-project"),
    causationEventId: null,
    correlationId: CommandId.make("command-project"),
    metadata: {},
    payload: {
      projectId: HOME,
      title: "Home",
      workspaceRoot: "/tmp/home",
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  model = {
    ...model,
    bots: [makeBot(BOT_ID)],
    threads: [{ ...makeThread(ThreadId.make("thread-1"), BOT_ID), createdBy: ANA }],
  };

  const created = yield* apply(model, {
    type: "routine.create-approved",
    commandId: CommandId.make("command-routine-create"),
    routineId: ROUTINE_ID,
    botId: BOT_ID,
    targetThreadId: ThreadId.make("thread-1"),
    threadMode: "target",
    createdBy: ANA,
    visibility: "organization",
    job: "Invoice triage",
    procedure: "File each invoice email.",
    schedule: { kind: "daily", time: "09:00" },
    timezone: "America/New_York",
    trigger: gmail,
    skillAssignmentIds: [],
    connectorDependencies: [],
    projectId: HOME,
    sandbox: "local",
    approvalPolicy: "approval-required",
    delegateToBotId: null,
    createdAt: NOW,
  });

  return (yield* apply(created.readModel, {
    type: "routine.enable",
    commandId: CommandId.make("command-routine-enable"),
    routineId: ROUTINE_ID,
    createdAt: NOW,
  })).readModel;
});

const routineIn = (readModel: OrchestrationReadModel) =>
  readModel.routines?.find((routine) => routine.id === ROUTINE_ID);

const bind = (triggerId: string | null) =>
  ({
    type: "routine.trigger.bind",
    commandId: CommandId.make(`command-bind-${triggerId}`),
    routineId: ROUTINE_ID,
    triggerId,
    createdAt: NOW,
  }) as const;

const draft = (
  readModel: OrchestrationReadModel,
  trigger: RoutineAppTrigger,
): Extract<OrchestrationCommand, { type: "routine.draft" }> => {
  const routine = routineIn(readModel)!;

  return {
    type: "routine.draft",
    commandId: CommandId.make(`command-draft-${trigger.event}`),
    routineId: ROUTINE_ID,
    botId: routine.botId,
    targetThreadId: routine.targetThreadId,
    threadMode: routine.threadMode,
    job: routine.job,
    procedure: "File each invoice email, then label it.",
    schedule: routine.schedule,
    timezone: routine.timezone,
    trigger,
    skillAssignmentIds: [],
    connectorDependencies: [],
    projectId: routine.projectId,
    sandbox: routine.sandbox,
    approvalPolicy: routine.approvalPolicy,
    delegateToBotId: null,
    createdBy: routine.createdBy,
    visibility: routine.visibility,
    createdAt: NOW,
  };
};

it.layer(NodeServices.layer)("app routine decider", (it) => {
  it.effect("enables an app routine without a next run", () =>
    Effect.gen(function* () {
      const routine = routineIn(yield* setup);

      expect(routine?.enabled).toBe(true);
      expect(routine?.nextRunAt).toBeNull();
      expect(routine?.trigger).toEqual(gmail);
    }),
  );

  it.effect("records the app's trigger id on the routine", () =>
    Effect.gen(function* () {
      const { event, readModel } = yield* apply(yield* setup, bind("trigger-1"));

      expect(event.type).toBe("routine.updated");
      expect(routineIn(readModel)?.trigger).toEqual({ ...gmail, triggerId: "trigger-1" });
    }),
  );

  it.effect("keeps the trigger id only when a redraft keeps the same app event", () =>
    Effect.gen(function* () {
      const bound = (yield* apply(yield* setup, bind("trigger-1"))).readModel;

      const same = yield* apply(bound, draft(bound, gmail));
      expect(routineIn(same.readModel)?.trigger).toEqual({ ...gmail, triggerId: "trigger-1" });

      const other = yield* apply(
        bound,
        draft(bound, { ...gmail, event: "GMAIL_NEW_LABEL", triggerId: "trigger-1" }),
      );

      expect(routineIn(other.readModel)?.trigger).toEqual({
        ...gmail,
        event: "GMAIL_NEW_LABEL",
        triggerId: null,
      });
    }),
  );

  it.effect("refuses an app event change from the app", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;

      const refused = yield* Effect.flip(
        apply(readModel, draft(readModel, { ...gmail, connectionId: "gmail-ben" }), {
          personId: ANA,
          canManageGroups: false,
        }),
      );

      expect(refused.message).toContain("A routine's app event cannot be changed here.");
    }),
  );

  it.effect("starts an app run with no scheduled time", () =>
    Effect.gen(function* () {
      const runId = RoutineRunId.make("routine:routine-1:app:msg_1");

      const { readModel } = yield* apply(yield* setup, {
        type: "routine.run.scheduled",
        commandId: CommandId.make("command-run-app"),
        routineId: ROUTINE_ID,
        runId,
        trigger: "app",
        scheduledFor: null,
        createdAt: NOW,
      });

      expect(readModel.routineRuns?.find((run) => run.id === runId)).toMatchObject({
        trigger: "app",
        scheduledFor: null,
        status: "queued",
      });
    }),
  );
});
