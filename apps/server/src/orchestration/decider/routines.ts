import * as Match from "effect/Match";
import {
  canSeeDirectChat,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type Routine,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../errors.ts";
import { canSeeThread } from "../group-visibility.ts";
import type { OrchestrationDispatchActor } from "../services/orchestration-engine.ts";
import { nextScheduledFor } from "../../routines/schedule.ts";
import { withEventBase, type DecideOrchestrationCommandResult } from "./event-base.ts";

export const decideRoutines = Effect.fn("decideRoutines")(function* ({
  command,
  readModel,
  actor,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    {
      type:
        | "routine.create-approved"
        | "routine.draft"
        | "routine.approve"
        | "routine.enable"
        | "routine.pause"
        | "routine.update"
        | "routine.run"
        | "routine.run.scheduled"
        | "routine.run.start"
        | "routine.run.block"
        | "routine.run.fail"
        | "routine.run.complete"
        | "routine.run.cancel"
        | "routine.delete"
        | "routine.skill.assign"
        | "routine.skill.unassign";
    }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  const refuse = (detail: string) =>
    new OrchestrationCommandInvariantError({ commandType: command.type, detail });

  // Otto: A person acts only on routines they can see: a Team routine is everyone's, an
  // Only me routine its creator's. Server work carries no actor and is trusted.
  const existingRoutine =
    "routineId" in command
      ? (readModel.routines ?? []).find((routine) => routine.id === command.routineId)
      : undefined;

  if (
    actor !== undefined &&
    existingRoutine !== undefined &&
    !canSeeDirectChat(existingRoutine, { kind: "person", personId: actor.personId })
  ) {
    return yield* refuse("This routine is private to the person who set it up.");
  }

  // Otto: A person's draft posts only into a chat they can see, as that chat's bot, with
  // that chat's permissions; who set the routine up and who sees it stay the creator's.
  const requireClientDraft = Effect.fnUntraced(function* (
    draft: Extract<OrchestrationCommand, { type: "routine.draft" }>,
    existing: Routine | undefined,
    personId: NonNullable<typeof actor>["personId"],
  ) {
    const target = readModel.threads.find((thread) => thread.id === draft.targetThreadId);

    if (
      target === undefined ||
      target.deletedAt !== null ||
      target.archivedAt !== null ||
      !canSeeThread(target, readModel.groups, personId)
    ) {
      return yield* refuse("A routine needs a chat you can see.");
    }

    if (!readModel.bots.some((bot) => bot.id === draft.botId && bot.archivedAt === null)) {
      return yield* refuse("The routine's bot is unavailable.");
    }

    if (
      draft.threadMode === "target" &&
      (target.botId !== draft.botId || target.projectId !== draft.projectId)
    ) {
      return yield* refuse("A routine that posts in its chat runs as that chat's bot and project.");
    }

    if (draft.approvalPolicy !== target.runtimeMode) {
      return yield* refuse("A routine runs with its chat's permissions.");
    }

    if (draft.delegateToBotId !== (existing?.delegateToBotId ?? null)) {
      return yield* refuse("A routine's helper bot cannot be changed here.");
    }

    if (
      existing !== undefined &&
      draft.visibility !== existing.visibility &&
      existing.createdBy !== personId
    ) {
      return yield* refuse("Only the person who set up this routine can change who sees it.");
    }
  });

  switch (command.type) {
    case "routine.create-approved": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' already exists.`,
        });
      }

      const routine = {
        id: command.routineId,
        botId: command.botId,
        targetThreadId: command.targetThreadId,
        threadMode: command.threadMode,
        job: command.job,
        procedure: command.procedure,
        schedule: command.schedule,
        timezone: command.timezone,
        skillAssignmentIds: command.skillAssignmentIds,
        connectorDependencies: command.connectorDependencies,
        projectId: command.projectId,
        sandbox: command.sandbox,
        approvalPolicy: command.approvalPolicy,
        delegateToBotId: command.delegateToBotId,
        createdBy: command.createdBy,
        visibility: command.visibility,
        procedureVersion: 1,
        approvalVersion: 1,
        enabled: false as const,
        lifecycle: "approved" as const,
        nextRunAt: null,
        lastRunAt: null,
        latestResult: null,
        latestFailure: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
        deletedAt: null,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.approved",
        payload: { routine },
      };
    }

    case "routine.draft": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing?.lifecycle === "deleted") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' is deleted.`,
        });
      }

      if (
        existing !== undefined &&
        command.expectedProcedureVersion !== undefined &&
        command.expectedProcedureVersion !== existing.procedureVersion
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' procedure version changed.`,
        });
      }

      const procedureVersion = (existing?.procedureVersion ?? 0) + 1;

      if (actor !== undefined) yield* requireClientDraft(command, existing, actor.personId);

      const routine = {
        id: command.routineId,
        botId: command.botId,
        targetThreadId: command.targetThreadId,
        threadMode: command.threadMode,
        job: command.job,
        procedure: command.procedure,
        schedule: command.schedule,
        timezone: command.timezone,
        skillAssignmentIds: command.skillAssignmentIds,
        connectorDependencies: command.connectorDependencies,
        projectId: command.projectId,
        sandbox: command.sandbox,
        approvalPolicy: command.approvalPolicy,
        delegateToBotId: command.delegateToBotId,
        createdBy:
          actor === undefined ? command.createdBy : (existing?.createdBy ?? actor.personId),
        visibility: command.visibility,
        procedureVersion,
        approvalVersion: null,
        enabled: false as const,
        lifecycle: "draft" as const,
        nextRunAt: null,
        lastRunAt: existing?.lastRunAt ?? null,
        latestResult: existing?.latestResult ?? null,
        latestFailure: existing?.latestFailure ?? null,
        createdAt: existing?.createdAt ?? command.createdAt,
        updatedAt: command.createdAt,
        deletedAt: null,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.drafted",
        payload: { routine },
      };
    }

    case "routine.approve": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (
        existing === undefined ||
        existing.lifecycle === "deleted" ||
        existing.procedureVersion !== command.procedureVersion
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' cannot approve procedure version ${command.procedureVersion}.`,
        });
      }

      const routine = {
        ...existing,
        approvalVersion: existing.procedureVersion,
        enabled: false,
        lifecycle: "approved" as const,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.approved",
        payload: { routine },
      };
    }

    case "routine.enable": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (
        existing === undefined ||
        existing.lifecycle === "deleted" ||
        existing.approvalVersion !== existing.procedureVersion
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' requires approval before enable.`,
        });
      }

      const routine = {
        ...existing,
        enabled: true,
        lifecycle: "enabled" as const,
        nextRunAt: nextScheduledFor(
          existing.schedule,
          existing.timezone,
          Date.parse(command.createdAt),
        ),
        latestFailure: null,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.enabled",
        payload: { routine },
      };
    }

    case "routine.pause": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined || existing.lifecycle === "deleted") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
        });
      }

      const routine = {
        ...existing,
        enabled: false,
        lifecycle: "paused" as const,
        nextRunAt: null,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.paused",
        payload: { routine },
      };
    }

    case "routine.update": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined || existing.lifecycle === "deleted") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
        });
      }

      // Otto: Who sees a routine is its creator's call.
      if (
        command.visibility !== undefined &&
        (existing.createdBy == null || existing.createdBy !== command.by)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only the person who set up this routine can change who sees it.",
        });
      }

      const threadMode = command.threadMode ?? existing.threadMode;
      const target = readModel.threads.find((thread) => thread.id === existing.targetThreadId);

      // Otto: The routine's chat is a live chat with its bot; posting into it puts the
      // routine in that chat's project, so only routines that start chats pick a project.
      if (
        threadMode === "target" &&
        (target === undefined ||
          target.deletedAt !== null ||
          target.archivedAt !== null ||
          target.botId !== existing.botId)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' needs a live chat with its bot.`,
        });
      }

      const projectId =
        threadMode === "target" && target !== undefined
          ? target.projectId
          : (command.projectId ?? existing.projectId);

      if (
        !readModel.projects.some(
          (project) => project.id === projectId && project.deletedAt === null,
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${projectId}' does not exist.`,
        });
      }

      const schedule = command.schedule ?? existing.schedule;
      const timezone = command.timezone ?? existing.timezone;

      const routine = {
        ...existing,
        job: command.job ?? existing.job,
        threadMode,
        projectId,
        schedule,
        timezone,
        nextRunAt:
          existing.enabled && (command.schedule !== undefined || command.timezone !== undefined)
            ? nextScheduledFor(schedule, timezone, Date.parse(command.createdAt))
            : existing.nextRunAt,
        visibility: command.visibility ?? existing.visibility,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.updated",
        payload: { routine },
      };
    }

    case "routine.run":
    case "routine.run.scheduled": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined || existing.lifecycle === "deleted") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
        });
      }

      if (command.type === "routine.run.scheduled" && !existing.enabled) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' is not enabled.`,
        });
      }

      if (command.trigger !== "dry-run" && existing.approvalVersion !== existing.procedureVersion) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' procedure approval is stale.`,
        });
      }

      if ((readModel.routineRuns ?? []).some((run) => run.id === command.runId)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' already exists.`,
        });
      }

      const runBase = {
        id: command.runId,
        routineId: command.routineId,
        procedureVersion: existing.procedureVersion,
        status: "queued" as const,
        result: null,
        failure: null,
        usageRef: null,
        threadRef: null,
        startedAt: null,
        completedAt: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      const run =
        command.type === "routine.run.scheduled"
          ? {
              ...runBase,
              trigger: command.trigger,
              scheduledFor: command.scheduledFor,
            }
          : { ...runBase, trigger: command.trigger, scheduledFor: null };

      const routine = {
        ...existing,
        lifecycle: "running" as const,
        lastRunAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.running",
        payload: { routine, run },
      };
    }

    case "routine.run.start":
    case "routine.run.block":
    case "routine.run.fail":
    case "routine.run.complete":
    case "routine.run.cancel": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      const existingRun = (readModel.routineRuns ?? []).find((run) => run.id === command.runId);

      if (existing === undefined || existing.lifecycle === "deleted" || existingRun === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' does not exist.`,
        });
      }

      // A run canceled or settled before it started stays ended, and a
      // cancellation never overwrites a run that already ended.
      if (
        (command.type === "routine.run.start" || command.type === "routine.run.cancel") &&
        existingRun.status !== "queued" &&
        existingRun.status !== "waiting-for-approval" &&
        existingRun.status !== "running"
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' already ended with status '${existingRun.status}'.`,
        });
      }

      const occurredAt =
        command.type === "routine.run.start" ? command.startedAt : command.createdAt;

      const run = Match.value(command).pipe(
        Match.when({ type: "routine.run.start" }, (command) => ({
          ...existingRun,
          status: "running" as const,
          threadRef: command.threadRef,
          startedAt: command.startedAt,
          updatedAt: command.startedAt,
        })),
        Match.when({ type: "routine.run.block" }, (command) => ({
          ...existingRun,
          status: "blocked" as const,
          failure: command.failure,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.when({ type: "routine.run.fail" }, (command) => ({
          ...existingRun,
          status: "failed" as const,
          failure: command.failure,
          usageRef: command.usageRef,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.when({ type: "routine.run.complete" }, (command) => ({
          ...existingRun,
          status: "completed" as const,
          result: command.result,
          usageRef: command.usageRef,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.orElse((command) => ({
          ...existingRun,
          status: "canceled" as const,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
      );

      const terminal = command.type !== "routine.run.start";

      const blockedOrFailed =
        command.type === "routine.run.block" || command.type === "routine.run.fail";

      // Otto: A failed run is recorded on its routine, which keeps its schedule; a failed
      // scheduled run moves the next run to the following slot.
      const routine = {
        ...existing,
        lifecycle: Match.value(command).pipe(
          Match.when({ type: "routine.run.start" }, (_command) => "running" as const),
          Match.when({ type: "routine.run.block" }, (_command) => "blocked" as const),
          Match.when({ type: "routine.run.fail" }, (_command) => "failed" as const),
          Match.orElse((command) =>
            command.type === "routine.run.complete" && existing.enabled
              ? ("enabled" as const)
              : command.type === "routine.run.complete"
                ? ("completed" as const)
                : existing.enabled
                  ? ("enabled" as const)
                  : ("paused" as const),
          ),
        ),
        nextRunAt: Match.value(command).pipe(
          Match.when({ type: "routine.run.complete" }, (command) => command.nextRunAt),
          Match.orElse((_command) =>
            blockedOrFailed && existing.enabled && existingRun.scheduledFor !== null
              ? nextScheduledFor(existing.schedule, existing.timezone, Date.parse(occurredAt))
              : existing.nextRunAt,
          ),
        ),
        lastRunAt: terminal ? occurredAt : existing.lastRunAt,
        latestResult:
          command.type === "routine.run.complete" ? command.result : existing.latestResult,
        latestFailure:
          command.type === "routine.run.block" || command.type === "routine.run.fail"
            ? command.failure
            : existing.latestFailure,
        updatedAt: occurredAt,
      };

      const type = Match.value(command).pipe(
        Match.when({ type: "routine.run.start" }, (_command) => "routine.running" as const),
        Match.when({ type: "routine.run.block" }, (_command) => "routine.blocked" as const),
        Match.when({ type: "routine.run.fail" }, (_command) => "routine.failed" as const),
        Match.when({ type: "routine.run.complete" }, (_command) => "routine.completed" as const),
        Match.orElse((_command) => "routine.run-canceled" as const),
      );

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt,
          commandId: command.commandId,
        })),
        type,
        payload: { routine, run },
      };
    }

    case "routine.delete": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
        });
      }

      const routine = {
        ...existing,
        enabled: false,
        lifecycle: "deleted" as const,
        nextRunAt: null,
        updatedAt: command.createdAt,
        deletedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.deleted",
        payload: { routine },
      };
    }

    case "routine.skill.assign": {
      if (
        (readModel.skillAssignments ?? []).some(
          (assignment) => assignment.id === command.assignmentId,
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Skill assignment '${command.assignmentId}' already exists.`,
        });
      }

      const assignment = {
        id: command.assignmentId,
        botId: command.botId,
        skillId: command.skillId,
        name: command.name,
        description: command.description,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "skill-assignment",
          aggregateId: command.assignmentId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "skill-assignment.assigned",
        payload: { assignment },
      };
    }

    case "routine.skill.unassign": {
      const assignment = (readModel.skillAssignments ?? []).find(
        (entry) => entry.id === command.assignmentId && entry.botId === command.botId,
      );

      if (assignment === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Skill assignment '${command.assignmentId}' does not exist.`,
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "skill-assignment",
          aggregateId: command.assignmentId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "skill-assignment.unassigned",
        payload: {
          assignmentId: command.assignmentId,
          botId: command.botId,
          removedAt: command.createdAt,
        },
      };
    }
  }
});
