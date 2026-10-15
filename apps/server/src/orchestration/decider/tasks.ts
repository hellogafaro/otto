import {
  type Actor,
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
import { OrchestrationCommandInvariantError } from "../errors.ts";
import type { OrchestrationDispatchActor } from "../services/orchestration-engine.ts";
import {
  requireActiveProject,
  requireTask,
  requireTaskAbsent,
  requireWorkParticipants,
} from "../command-invariants.ts";
import { withEventBase, nowIso, type DecideOrchestrationCommandResult } from "./event-base.ts";

const uniqueParticipants = (participants: ReadonlyArray<WorkParticipant>) => [
  ...new Map(
    participants.map((participant) => [
      participant.kind === "bot" ? `bot:${participant.botId}` : `person:${participant.personId}`,
      participant,
    ]),
  ).values(),
];

/**
 * Otto: Who a task change is by: the signed-in person who sent it, or for a command the server
 * dispatches, the bot it names. A client's own `by` is never trusted over its session.
 */
const commandActor = (
  actor: OrchestrationDispatchActor | undefined,
  by: Actor | undefined,
): Actor | undefined => (actor === undefined ? by : { type: "person", id: actor.personId });

const actorFields = (actor: Actor | undefined) => (actor === undefined ? {} : { actor });

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
    {
      type:
        | "task.create"
        | "task.update"
        | "task.time.add"
        | "task.time.remove"
        | "task.comment.add";
    }
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
      const by = commandActor(actor, command.by);

      yield* requireHumanDone(command, by, command.status);

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
          ...actorFields(by),
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

      const by = commandActor(actor, command.by);

      yield* requireHumanDone(command, by, command.status);

      if (by?.type === "bot" && command.owner !== undefined) {
        return yield* invariant(command.type, "Only a person can change a task's owner.");
      }

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
        payload: { task, changes: taskChanges(existing, task), ...actorFields(by) },
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

    case "task.comment.add": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });

      if (command.content.length === 0 && command.fileIds.length === 0) {
        return yield* invariant(command.type, "A comment needs text or a file.");
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.commented",
        payload: {
          task: { ...existing, updatedAt: command.createdAt },
          comment: {
            id: command.commentId,
            content: command.content,
            fileIds: command.fileIds,
            actor: commandActor(actor, command.by) ?? command.by,
            createdAt: command.createdAt,
          },
        },
      };
    }
  }
});

/** Otto: Marking work done stays a person's call; bots report progress instead. */
const requireHumanDone = (
  command: OrchestrationCommand,
  by: Actor | undefined,
  status: OrchestrationTask["status"] | undefined,
) =>
  by?.type === "bot" && status === "completed"
    ? invariant(command.type, "Only a person can mark a task completed.")
    : Effect.void;

const invariant = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));
