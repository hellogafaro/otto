import {
  type AuthSessionId,
  BotId,
  CommandId,
  PositiveInt,
  type Routine,
  RoutineId,
  RoutineTimeZone,
  ThreadId,
  type OttoCreateRoutineInput,
  type OttoUpdateRoutineInput,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ComposioService } from "../composio/composio-service.ts";
import { canSeeRoutine, chatPeople } from "../orchestration/group-visibility.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";

const decodeRoutineTimeZone = Schema.decodeUnknownEffect(RoutineTimeZone);

export interface RoutineApprovedResult {
  readonly routineId: RoutineId;
  readonly sequence: number;
  readonly status: "enabled";
}

export interface RoutinesDeletedResult {
  readonly routineIds: ReadonlyArray<RoutineId>;
  readonly sequences: ReadonlyArray<number>;
  readonly status: "deleted";
}

export interface RoutineUpdatedResult {
  readonly routineId: RoutineId;
  readonly status: "updated";
  readonly enabled: boolean;
}

export interface RoutinePausedResult {
  readonly routineId: RoutineId;
  readonly status: "paused" | "resumed";
}

export type OttoRoutineStatus = Pick<Routine, "id" | "enabled"> & {
  readonly name: string;
  readonly lifecycle: Exclude<Routine["lifecycle"], "deleted">;
};

/** Otto: A bot's live routines that every person in its chat may see. */
export function routineStatusesForBot(
  routines: ReadonlyArray<Routine>,
  botId: BotId,
  people: ReadonlyArray<AuthSessionId>,
): ReadonlyArray<OttoRoutineStatus> {
  return routines.flatMap((routine) =>
    routine.botId === botId &&
    routine.lifecycle !== "deleted" &&
    routine.deletedAt === null &&
    people.every((personId) => canSeeRoutine(routine, personId))
      ? [
          {
            id: routine.id,
            name: routine.job,
            enabled: routine.enabled,
            lifecycle: routine.lifecycle,
          },
        ]
      : [],
  );
}

export class RoutineDraftError extends Schema.TaggedErrorClass<RoutineDraftError>()(
  "RoutineDraftError",
  { message: Schema.String },
) {}

export interface RoutineDraftDispatcherShape {
  readonly createApprovedForThread: (
    threadId: ThreadId,
    timezone: string,
    input: OttoCreateRoutineInput,
  ) => Effect.Effect<RoutineApprovedResult, RoutineDraftError>;
  readonly listForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<OttoRoutineStatus>, RoutineDraftError>;
  readonly deleteForThread: (
    threadId: ThreadId,
    routineIds: ReadonlyArray<RoutineId>,
  ) => Effect.Effect<RoutinesDeletedResult, RoutineDraftError>;
  readonly updateForThread: (
    threadId: ThreadId,
    routineId: RoutineId,
    input: OttoUpdateRoutineInput,
  ) => Effect.Effect<RoutineUpdatedResult, RoutineDraftError>;
  readonly setPausedForThread: (
    threadId: ThreadId,
    routineId: RoutineId,
    paused: boolean,
  ) => Effect.Effect<RoutinePausedResult, RoutineDraftError>;
}

export class RoutineDraftDispatcher extends Context.Service<
  RoutineDraftDispatcher,
  RoutineDraftDispatcherShape
>()("@otto/server/routines/routine-draft-dispatcher/RoutineDraftDispatcher") {}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const composio = yield* Effect.serviceOption(ComposioService);
  const decodeTimezone = decodeRoutineTimeZone;
  const fail = (message: string) => new RoutineDraftError({ message });

  const createApprovedForThread: RoutineDraftDispatcherShape["createApprovedForThread"] = (
    threadId,
    timezone,
    input,
  ) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(yield* snapshots.getThreadDetailById(threadId));

      if (!thread || thread.archivedAt !== null) {
        return yield* fail("The current chat is unavailable.");
      }

      const botId = thread.respondingBotId ?? thread.botId;

      if (botId === null || botId === undefined) {
        return yield* fail("Routines can only be created from a bot chat.");
      }

      const decodedTimezone = yield* decodeTimezone(timezone).pipe(
        Effect.mapError(() => fail("The current device timezone is invalid.")),
      );

      const snapshot = yield* snapshots.getShellSnapshot();

      const bot = snapshot.bots.find(
        (candidate) => candidate.id === botId && candidate.archivedAt === null,
      );

      if (!bot) return yield* fail("The current bot is unavailable.");

      const requestedSkills = new Set((input.skillNames ?? []).map((name) => name.toLowerCase()));

      const skillAssignmentIds = (snapshot.skillAssignments ?? [])
        .filter(
          (assignment) =>
            assignment.botId === botId && requestedSkills.has(assignment.name.toLowerCase()),
        )
        .map((assignment) => assignment.id);

      if (skillAssignmentIds.length !== requestedSkills.size) {
        return yield* fail("Assign the requested skills to this bot first.");
      }

      const requestedConnectors = new Set(
        (input.connectorNames ?? []).map((name) => name.toLowerCase()),
      );

      const connectorDependencies = (snapshot.mcpServers ?? [])
        .filter((server) => server.enabled && requestedConnectors.has(server.name.toLowerCase()))
        .map((server) => server.id);

      if (connectorDependencies.length !== requestedConnectors.size) {
        return yield* fail("Connect the requested plugin first.");
      }

      if ((input.schedule === undefined) === (input.trigger === undefined)) {
        return yield* fail("Give the routine either a schedule or an app event, not both.");
      }

      // Otto: The routine is its chat starter's, so the account it watches must be one they
      // see and the bot may use.
      const trigger =
        input.trigger === undefined
          ? undefined
          : Option.isNone(composio)
            ? yield* fail("App events are not available on this server.")
            : yield* composio.value
                .prepareTrigger(
                  input.trigger,
                  {
                    botId,
                    ownerPersonId: bot.owner?.kind === "person" ? bot.owner.personId : null,
                  },
                  thread.createdBy ?? null,
                )
                .pipe(Effect.mapError((error) => fail(error.message)));

      const uuid = yield* crypto.randomUUIDv4;
      const now = DateTime.formatIso(yield* DateTime.now);
      const routineId = RoutineId.make(uuid);

      yield* engine.dispatch({
        type: "routine.create-approved",
        commandId: CommandId.make(`agent:routine.create-approved:${uuid}`),
        routineId,
        botId,
        targetThreadId: threadId,
        // Otto: A group chat has no single bot to post as, so its routines get their own chat.
        threadMode:
          thread.groupId == null
            ? (input.threadMode ?? "target")
            : input.threadMode === "per-run"
              ? "per-run"
              : "single",
        job: input.name,
        procedure: input.instructions,
        // Otto: An app routine never reads its schedule; it keeps the default daily one.
        schedule: input.schedule ?? { kind: "daily", time: "09:00" },
        timezone: decodedTimezone,
        ...(trigger !== undefined ? { trigger } : {}),
        skillAssignmentIds,
        connectorDependencies,
        projectId: thread.projectId,
        sandbox: "local",
        approvalPolicy: thread.runtimeMode,
        delegateToBotId: null,
        // Otto: A routine belongs to whoever started its chat and is seen as that chat is.
        createdBy: thread.createdBy ?? null,
        visibility: thread.groupId == null ? (thread.visibility ?? "organization") : "organization",
        createdAt: now,
      });

      // The user's approval is the go-ahead, so the routine starts on its schedule
      // instead of waiting, paused, for a second switch in the routines list.
      const enabled = yield* engine.dispatch({
        type: "routine.enable",
        commandId: CommandId.make(`agent:routine.enable:${uuid}`),
        routineId,
        createdAt: now,
      });

      return { routineId, sequence: enabled.sequence, status: "enabled" as const };
    }).pipe(
      Effect.mapError((cause) =>
        isRoutineDraftError(cause)
          ? cause
          : fail(cause instanceof Error ? cause.message : String(cause)),
      ),
    );

  const listForThread: RoutineDraftDispatcherShape["listForThread"] = (threadId) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(yield* snapshots.getThreadDetailById(threadId));

      if (!thread || thread.archivedAt !== null) {
        return yield* fail("The current chat is unavailable.");
      }

      const botId = thread.respondingBotId ?? thread.botId;

      if (botId === null || botId === undefined) {
        return yield* fail("Routines can only be inspected from a bot chat.");
      }

      const snapshot = yield* snapshots.getShellSnapshot();

      const bot = snapshot.bots.find(
        (candidate) => candidate.id === botId && candidate.archivedAt === null,
      );

      if (!bot) return yield* fail("The current bot is unavailable.");

      return routineStatusesForBot(
        snapshot.routines ?? [],
        botId,
        chatPeople(thread, snapshot.groups),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isRoutineDraftError(cause)
          ? cause
          : fail(cause instanceof Error ? cause.message : String(cause)),
      ),
    );

  const deleteForThread: RoutineDraftDispatcherShape["deleteForThread"] = (threadId, routineIds) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(yield* snapshots.getThreadDetailById(threadId));

      if (!thread || thread.archivedAt !== null) {
        return yield* fail("The current chat is unavailable.");
      }

      const botId = thread.respondingBotId ?? thread.botId;

      if (botId === null || botId === undefined) {
        return yield* fail("Routines can only be deleted from a bot chat.");
      }

      const snapshot = yield* snapshots.getShellSnapshot();

      const bot = snapshot.bots.find(
        (candidate) => candidate.id === botId && candidate.archivedAt === null,
      );

      if (!bot) return yield* fail("The current bot is unavailable.");

      const uniqueRoutineIds = [...new Set(routineIds)];

      if (uniqueRoutineIds.length === 0) {
        return yield* fail("Select at least one routine to delete.");
      }

      const availableRoutineIds = new Set(
        routineStatusesForBot(
          snapshot.routines ?? [],
          botId,
          chatPeople(thread, snapshot.groups),
        ).map((routine) => routine.id),
      );

      if (uniqueRoutineIds.some((routineId) => !availableRoutineIds.has(routineId))) {
        return yield* fail("One or more routines are unavailable.");
      }

      const createdAt = DateTime.formatIso(yield* DateTime.now);

      const results = yield* Effect.forEach(uniqueRoutineIds, (routineId) =>
        Effect.gen(function* () {
          const uuid = yield* crypto.randomUUIDv4;

          return yield* engine.dispatch({
            type: "routine.delete",
            commandId: CommandId.make(`agent:routine.delete:${uuid}`),
            routineId,
            createdAt,
          });
        }),
      );

      return {
        routineIds: uniqueRoutineIds,
        sequences: results.map((result) => result.sequence),
        status: "deleted" as const,
      };
    }).pipe(
      Effect.mapError((cause) =>
        isRoutineDraftError(cause)
          ? cause
          : fail(cause instanceof Error ? cause.message : String(cause)),
      ),
    );

  /**
   * The live routine a bot chat may change: owned by the chat's bot, not deleted, and seen
   * by everyone in the chat.
   */
  const ownedRoutine = (threadId: ThreadId, routineId: RoutineId) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(yield* snapshots.getThreadDetailById(threadId));

      if (!thread || thread.archivedAt !== null) {
        return yield* fail("The current chat is unavailable.");
      }

      const botId = thread.respondingBotId ?? thread.botId;

      if (botId === null || botId === undefined) {
        return yield* fail("Routines can only be changed from a bot chat.");
      }

      const snapshot = yield* snapshots.getShellSnapshot();

      const people = chatPeople(thread, snapshot.groups);

      const routine = (snapshot.routines ?? []).find(
        (candidate) =>
          candidate.id === routineId &&
          candidate.botId === botId &&
          candidate.lifecycle !== "deleted" &&
          candidate.deletedAt === null &&
          people.every((personId) => canSeeRoutine(candidate, personId)),
      );

      if (!routine) return yield* fail("That routine is unavailable.");

      return routine;
    });

  const commandId = (type: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`agent:${type}:${uuid}`)));

  const updateForThread: RoutineDraftDispatcherShape["updateForThread"] = (
    threadId,
    routineId,
    input,
  ) =>
    Effect.gen(function* () {
      const routine = yield* ownedRoutine(threadId, routineId);
      const createdAt = DateTime.formatIso(yield* DateTime.now);

      yield* engine.dispatch({
        type: "routine.draft",
        commandId: yield* commandId("routine.draft"),
        routineId,
        botId: routine.botId,
        targetThreadId: routine.targetThreadId,
        threadMode: routine.threadMode,
        job: input.name ?? routine.job,
        procedure: input.instructions ?? routine.procedure,
        schedule: input.schedule ?? routine.schedule,
        timezone: routine.timezone,
        // Otto: A new schedule replaces an app event; otherwise the routine keeps its trigger.
        ...(input.schedule === undefined && routine.trigger !== undefined
          ? { trigger: routine.trigger }
          : {}),
        skillAssignmentIds: routine.skillAssignmentIds,
        connectorDependencies: routine.connectorDependencies,
        projectId: routine.projectId,
        sandbox: routine.sandbox,
        approvalPolicy: routine.approvalPolicy,
        delegateToBotId: routine.delegateToBotId,
        createdBy: routine.createdBy,
        visibility: routine.visibility,
        expectedProcedureVersion: routine.procedureVersion,
        createdAt,
      });

      // The user confirmed the change in chat, so it is approved as saved and a
      // routine that was running on its schedule keeps running.
      yield* engine.dispatch({
        type: "routine.approve",
        commandId: yield* commandId("routine.approve"),
        routineId,
        procedureVersion: PositiveInt.make(routine.procedureVersion + 1),
        createdAt,
      });

      if (routine.enabled) {
        yield* engine.dispatch({
          type: "routine.enable",
          commandId: yield* commandId("routine.enable"),
          routineId,
          createdAt,
        });
      }

      return { routineId, status: "updated" as const, enabled: routine.enabled };
    }).pipe(
      Effect.mapError((cause) =>
        isRoutineDraftError(cause)
          ? cause
          : fail(cause instanceof Error ? cause.message : String(cause)),
      ),
    );

  const setPausedForThread: RoutineDraftDispatcherShape["setPausedForThread"] = (
    threadId,
    routineId,
    paused,
  ) =>
    Effect.gen(function* () {
      yield* ownedRoutine(threadId, routineId);
      const createdAt = DateTime.formatIso(yield* DateTime.now);

      yield* paused
        ? engine.dispatch({
            type: "routine.pause",
            commandId: yield* commandId("routine.pause"),
            routineId,
            reason: "Paused from chat.",
            createdAt,
          })
        : engine.dispatch({
            type: "routine.enable",
            commandId: yield* commandId("routine.enable"),
            routineId,
            createdAt,
          });

      return { routineId, status: paused ? ("paused" as const) : ("resumed" as const) };
    }).pipe(
      Effect.mapError((cause) =>
        isRoutineDraftError(cause)
          ? cause
          : fail(cause instanceof Error ? cause.message : String(cause)),
      ),
    );

  return {
    createApprovedForThread,
    listForThread,
    deleteForThread,
    updateForThread,
    setPausedForThread,
  } satisfies RoutineDraftDispatcherShape;
});

export const RoutineDraftDispatcherLive = Layer.effect(RoutineDraftDispatcher, make);

const isRoutineDraftError = Schema.is(RoutineDraftError);
