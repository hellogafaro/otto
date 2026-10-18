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
import { makeThread, NOW } from "./test-support/delegation-decider-fixtures.ts";

const BOT_ID = BotId.make("bot-1");

const ROUTINE_ID = RoutineId.make("routine-1");

const HOME = ProjectId.make("project-1");

const OTHER = ProjectId.make("project-2");

const ANA = AuthSessionId.make("user-ana");

const withProject = (model: OrchestrationReadModel, projectId: ProjectId, sequence: number) =>
  projectEvent(model, {
    sequence,
    eventId: EventId.make(`event-${projectId}`),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make(`command-${projectId}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-${projectId}`),
    metadata: {},
    payload: {
      projectId,
      title: projectId,
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

const setup = Effect.gen(function* () {
  let model = yield* withProject(createEmptyReadModel(NOW), HOME, 1);
  model = yield* withProject(model, OTHER, 2);

  model = {
    ...model,
    threads: [makeThread(ThreadId.make("thread-1"), BOT_ID)],
  };

  const created = yield* decideOrchestrationCommand({
    command: {
      type: "routine.create-approved",
      commandId: CommandId.make("command-routine-create"),
      routineId: ROUTINE_ID,
      botId: BOT_ID,
      targetThreadId: ThreadId.make("thread-1"),
      threadMode: "target",
      createdBy: ANA,
      visibility: "organization",
      job: "Daily brief",
      procedure: "Summarize this chat.",
      schedule: { kind: "daily", time: "09:00" },
      timezone: "America/New_York",
      skillAssignmentIds: [],
      connectorDependencies: [],
      projectId: HOME,
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
    sequence: 3,
    eventId: EventId.make("event-routine-created"),
  });
});

type RoutineUpdate = Extract<OrchestrationCommand, { readonly type: "routine.update" }>;

const routineUpdate = (
  fields: Pick<
    RoutineUpdate,
    "job" | "threadMode" | "projectId" | "visibility" | "by" | "schedule" | "timezone"
  >,
): RoutineUpdate => ({
  type: "routine.update",
  commandId: CommandId.make("command-routine-update"),
  routineId: ROUTINE_ID,
  ...fields,
  createdAt: "2026-08-31T13:00:00.000Z",
});

const update = (readModel: OrchestrationReadModel, fields: Parameters<typeof routineUpdate>[0]) =>
  decideOrchestrationCommand({ command: routineUpdate(fields), readModel }).pipe(
    Effect.map((result) => (Array.isArray(result) ? result[0] : result)),
  );

it.layer(NodeServices.layer)("routine.update decider", (it) => {
  it.effect("renames a routine without touching its approval", () =>
    Effect.gen(function* () {
      const event = yield* update(yield* setup, { job: "Morning brief" });

      expect(event?.type).toBe("routine.updated");
      expect(event?.payload).toMatchObject({
        routine: { job: "Morning brief", procedureVersion: 1, approvalVersion: 1 },
      });
    }),
  );

  it.effect("starts a new chat each run in the chosen project", () =>
    Effect.gen(function* () {
      const event = yield* update(yield* setup, { threadMode: "per-run", projectId: OTHER });

      expect(event?.payload).toMatchObject({
        routine: { targetThreadId: "thread-1", projectId: OTHER, threadMode: "per-run" },
      });
    }),
  );

  it.effect("returns to its one chat and that chat's project", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;
      const perRun = yield* update(readModel, { threadMode: "per-run", projectId: OTHER });

      if (perRun === undefined) return expect.unreachable();

      const moved = yield* projectEvent(readModel, {
        ...perRun,
        sequence: 4,
        eventId: EventId.make("event-routine-per-run"),
      });

      const event = yield* update(moved, { threadMode: "target" });

      expect(event?.payload).toMatchObject({
        routine: { targetThreadId: "thread-1", projectId: HOME, threadMode: "target" },
      });
    }),
  );

  it.effect("refuses one chat once that chat is archived, and an unknown project", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;

      const archived = {
        ...readModel,
        threads: readModel.threads.map((thread) => ({ ...thread, archivedAt: NOW })),
      };

      const noChat = yield* decideOrchestrationCommand({
        command: routineUpdate({ threadMode: "target" }),
        readModel: archived,
      }).pipe(Effect.flip);

      expect(String(noChat)).toContain("needs a live chat with its bot");

      const unknownProject = yield* decideOrchestrationCommand({
        command: routineUpdate({
          threadMode: "per-run",
          projectId: ProjectId.make("project-missing"),
        }),
        readModel,
      }).pipe(Effect.flip);

      expect(String(unknownProject)).toContain("does not exist");
    }),
  );
  it.effect("lets only the person who set it up change who sees it", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;
      const event = yield* update(readModel, { visibility: "user", by: ANA });

      expect(event?.payload).toMatchObject({ routine: { visibility: "user", createdBy: ANA } });

      const other = yield* decideOrchestrationCommand({
        command: routineUpdate({ visibility: "user", by: AuthSessionId.make("user-ben") }),
        readModel,
      }).pipe(Effect.flip);

      expect(String(other)).toContain("Only the person who set up this routine");
    }),
  );

  it.effect("moves the next run to the new schedule and timezone", () =>
    Effect.gen(function* () {
      const readModel = yield* setup;

      const enabled = {
        ...readModel,
        routines: (readModel.routines ?? []).map((routine) => ({
          ...routine,
          enabled: true,
          lifecycle: "enabled" as const,
          nextRunAt: "2026-09-01T13:00:00.000Z",
        })),
      };

      const event = yield* update(enabled, {
        schedule: { kind: "weekdays", time: "07:30" },
        timezone: "Europe/Madrid",
      });

      expect(event?.payload).toMatchObject({
        routine: {
          schedule: { kind: "weekdays", time: "07:30" },
          timezone: "Europe/Madrid",
          nextRunAt: "2026-09-01T05:30:00.000Z",
          procedureVersion: 1,
          approvalVersion: 1,
        },
      });

      const off = yield* update(readModel, { schedule: { kind: "daily", time: "07:30" } });

      expect(off?.payload).toMatchObject({
        routine: { schedule: { kind: "daily", time: "07:30" }, nextRunAt: null },
      });
    }),
  );
});
