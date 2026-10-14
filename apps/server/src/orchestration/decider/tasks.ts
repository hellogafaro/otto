import {
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type TaskChanges,
  type WorkParticipant,
  workParticipantKey,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import {
  requireActiveProject,
  requireTask,
  requireTaskAbsent,
  requireWorkParticipants,
} from "../commandInvariants.ts";
import { withEventBase, nowIso, type DecideOrchestrationCommandResult } from "./eventBase.ts";

const uniqueParticipants = (participants: ReadonlyArray<WorkParticipant>) => [
  ...new Map(
    participants.map((participant) => [
      participant.kind === "bot" ? `bot:${participant.botId}` : `person:${participant.personId}`,
      participant,
    ]),
  ).values(),
];

const actorFields = (actor: OrchestrationDispatchActor | undefined) =>
  actor === undefined ? {} : { actor: { type: "person" as const, id: actor.personId } };

const participantsKey = (participants: ReadonlyArray<WorkParticipant>) =>
  participants.map(workParticipantKey).join(",");

/** The fields an update actually changed; an empty object when it changed nothing. */
export function taskChanges(before: OrchestrationTask, after: OrchestrationTask): TaskChanges {
  const ownerKey = (task: OrchestrationTask) =>
    task.owner === null ? null : workParticipantKey(task.owner);

  return {
    ...(before.title !== after.title ? { title: { from: before.title, to: after.title } } : {}),
    ...(before.status !== after.status
      ? { status: { from: before.status, to: after.status } }
      : {}),
    ...(ownerKey(before) !== ownerKey(after)
      ? { owner: { from: before.owner, to: after.owner } }
      : {}),
    ...(participantsKey(before.assignees) !== participantsKey(after.assignees)
      ? { assignees: { from: before.assignees, to: after.assignees } }
      : {}),
    ...(before.dueDate !== after.dueDate
      ? { dueDate: { from: before.dueDate, to: after.dueDate } }
      : {}),
    ...(before.projectId !== after.projectId
      ? { projectId: { from: before.projectId, to: after.projectId } }
      : {}),
    ...(JSON.stringify(before.resources) !== JSON.stringify(after.resources)
      ? { resources: { from: before.resources, to: after.resources } }
      : {}),
    ...(before.description !== after.description ? { description: true as const } : {}),
  };
}

export const decideTasks = Effect.fn("decideTasks")(function* ({
  command,
  readModel,
  actor,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    { type: "task.create" | "task.update" | "task.time.add" | "task.time.remove" }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "task.create": {
      yield* requireTaskAbsent({ readModel, command, taskId: command.taskId });
      yield* requireActiveProject({ readModel, command, projectId: command.projectId });

      const assignees = uniqueParticipants(command.assignees ?? []);
      yield* requireWorkParticipants({
        readModel,
        command,
        participants: [command.owner, ...assignees],
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.created",
        payload: {
          task: {
            id: command.taskId,
            projectId: command.projectId,
            title: command.title,
            description: command.description ?? "",
            owner: command.owner ?? null,
            assignees,
            resources: command.resources ?? [],
            dueDate: command.dueDate ?? null,
            status: command.status ?? "backlog",
            timeEntries: [],
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
          ...actorFields(actor),
        },
      };
    }

    case "task.update": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });

      if (command.projectId !== undefined) {
        yield* requireActiveProject({ readModel, command, projectId: command.projectId });
      }

      const assignees =
        command.assignees === undefined ? undefined : uniqueParticipants(command.assignees);

      yield* requireWorkParticipants({
        readModel,
        command,
        participants: [command.owner, ...(assignees ?? [])],
      });

      const occurredAt = yield* nowIso;

      const task = {
        ...existing,
        ...(command.projectId !== undefined ? { projectId: command.projectId } : {}),
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.description !== undefined ? { description: command.description } : {}),
        ...(command.owner !== undefined ? { owner: command.owner } : {}),
        ...(assignees !== undefined ? { assignees } : {}),
        ...(command.resources !== undefined ? { resources: command.resources } : {}),
        ...(command.dueDate !== undefined ? { dueDate: command.dueDate } : {}),
        ...(command.status !== undefined ? { status: command.status } : {}),
        updatedAt: occurredAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.updated",
        payload: { task, changes: taskChanges(existing, task), ...actorFields(actor) },
      };
    }

    case "task.time.add": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });

      if (actor === undefined) {
        return yield* invariant(command.type, "Only a signed-in person can log time.");
      }

      if (existing.timeEntries.some((entry) => entry.id === command.entryId)) {
        return yield* invariant(command.type, `Time entry '${command.entryId}' already exists.`);
      }

      const entry = {
        id: command.entryId,
        taskId: existing.id,
        duration: command.duration,
        description: command.description ?? "",
        createdBy: actor.personId,
        createdAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.time-added",
        payload: {
          task: { ...existing, timeEntries: [...existing.timeEntries, entry] },
          entry,
        },
      };
    }

    case "task.time.remove": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });
      const entry = existing.timeEntries.find((candidate) => candidate.id === command.entryId);

      if (entry === undefined) {
        return yield* invariant(command.type, `Time entry '${command.entryId}' does not exist.`);
      }

      if (actor !== undefined && entry.createdBy !== actor.personId) {
        return yield* invariant(
          command.type,
          "Only the person who logged this time can remove it.",
        );
      }

      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.time-removed",
        payload: {
          task: {
            ...existing,
            timeEntries: existing.timeEntries.filter((candidate) => candidate.id !== entry.id),
          },
          entryId: entry.id,
        },
      };
    }
  }
});

const invariant = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));
