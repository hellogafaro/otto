import {
  type Actor,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type TaskChanges,
  type TaskDueDate,
  TaskId,
  type TaskRepeat,
  type WorkParticipant,
  type WorkResource,
  workParticipantKey,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
    ...(before.repeat !== after.repeat
      ? { repeat: { from: before.repeat, to: after.repeat } }
      : {}),
    ...(before.priority !== after.priority
      ? { priority: { from: before.priority, to: after.priority } }
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

const REPEAT_STEP: Record<TaskRepeat, { readonly days: number } | { readonly months: number }> = {
  daily: { days: 1 },
  weekdays: { days: 1 },
  weekly: { days: 7 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
};

/**
 * The next due day of a repeating task: the first occurrence after `today`, counted from its
 * due date (or from today when it has none), so finishing late never schedules a past day.
 */
export function nextTaskDueDate(
  repeat: TaskRepeat,
  dueDate: TaskDueDate | null,
  today: TaskDueDate,
): TaskDueDate {
  const anchor = DateTime.makeUnsafe(`${dueDate ?? today}T00:00:00Z`);
  const unit = REPEAT_STEP[repeat];

  for (let step = 1; ; step += 1) {
    const next = DateTime.add(
      anchor,
      "days" in unit ? { days: unit.days * step } : { months: unit.months * step },
    );

    const weekDay = DateTime.getPartUtc(next, "weekDay");
    const key = DateTime.formatIsoDateUtc(next);

    if (key > today && !(repeat === "weekdays" && (weekDay === 0 || weekDay === 6))) return key;
  }
}

/** The calendar day it is at `at` in `timeZone`, falling back to UTC for an unknown zone. */
export function zonedToday(at: string, timeZone: string | undefined): TaskDueDate {
  const zoned = DateTime.makeZoned(at, { timeZone: timeZone ?? "UTC" });

  return Option.isSome(zoned) ? DateTime.formatIsoDate(zoned.value) : at.slice(0, 10);
}

/** Completing records when and by whom; any other status clears both, which reopens the task. */
const completion = (
  before: Pick<OrchestrationTask, "status" | "completedAt" | "completedBy"> | undefined,
  status: OrchestrationTask["status"],
  by: Actor | undefined,
  at: string,
) =>
  status !== "completed"
    ? { completedAt: null, completedBy: null }
    : before?.status === "completed"
      ? { completedAt: before.completedAt, completedBy: before.completedBy }
      : { completedAt: at, completedBy: by ?? null };

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
        | "task.delete"
        | "task.time.create"
        | "task.time.delete"
        | "task.comment.create"
        | "task.comment.update"
        | "task.comment.delete";
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

      const requested = uniqueParticipants(command.assignees ?? []);

      const assignees =
        requested.length === 0 && command.owner != null ? [command.owner] : requested;

      const by = commandActor(actor, command.by);

      yield* requirePersonOwner(command, command.owner);

      yield* requireWorkParticipants({
        readModel,
        command,
        participants: [command.owner, ...assignees],
      });

      const status = command.status ?? "backlog";

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
            repeat: command.repeat ?? null,
            priority: command.priority ?? null,
            status,
            timeEntries: [],
            createdBy: by ?? null,
            updatedBy: by ?? null,
            ...completion(undefined, status, by, command.createdAt),
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

      yield* requirePersonOwner(command, command.owner);

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
        ...(command.repeat !== undefined ? { repeat: command.repeat } : {}),
        ...(command.priority !== undefined ? { priority: command.priority } : {}),
        ...(command.status !== undefined ? { status: command.status } : {}),
        ...completion(existing, command.status ?? existing.status, by, occurredAt),
        updatedBy: by ?? existing.updatedBy,
        updatedAt: occurredAt,
      };

      const updated = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.updated" as const,
        payload: { task, changes: taskChanges(existing, task), ...actorFields(by) },
      };

      if (task.repeat === null || existing.status === "completed" || task.status !== "completed") {
        return updated;
      }

      const crypto = yield* Crypto.Crypto;
      const nextTaskId = TaskId.make(yield* crypto.randomUUIDv4);
      const today = zonedToday(occurredAt, command.timezone);

      return [
        { ...updated, payload: { ...updated.payload, task: { ...task, repeat: null } } },
        {
          ...(yield* withEventBase({
            aggregateKind: "task",
            aggregateId: nextTaskId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "task.created" as const,
          payload: {
            task: {
              ...task,
              id: nextTaskId,
              dueDate: nextTaskDueDate(task.repeat, task.dueDate, today),
              status: "pending" as const,
              timeEntries: [],
              createdBy: by ?? null,
              updatedBy: by ?? null,
              completedAt: null,
              completedBy: null,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
            ...actorFields(by),
          },
        },
      ];
    }

    case "task.delete": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });
      const by = commandActor(actor, command.by);
      const occurredAt = yield* nowIso;

      const deleted = {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: existing.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.deleted" as const,
        payload: {
          taskId: existing.id,
          projectId: existing.projectId,
          title: existing.title,
          deletedAt: occurredAt,
          ...actorFields(by),
        },
      };

      const linking = (readModel.tasks ?? []).filter(
        (task) =>
          task.id !== existing.id &&
          task.resources.some((resource) => isLinkTo(resource, existing.id)),
      );

      const unlinked = yield* Effect.forEach(linking, (task) =>
        Effect.gen(function* () {
          const next = {
            ...task,
            resources: task.resources.filter((resource) => !isLinkTo(resource, existing.id)),
            updatedBy: by ?? task.updatedBy,
            updatedAt: occurredAt,
          };

          return {
            ...(yield* withEventBase({
              aggregateKind: "task",
              aggregateId: task.id,
              occurredAt,
              commandId: command.commandId,
            })),
            type: "task.updated" as const,
            payload: { task: next, changes: taskChanges(task, next), ...actorFields(by) },
          };
        }),
      );

      return [deleted, ...unlinked];
    }

    case "task.time.create": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });
      const by = commandActor(actor, command.by);

      if (by === undefined) {
        return yield* invariant(command.type, "Time is logged by a signed-in person or a bot.");
      }

      // A person signed in to a client logs their own time; the server says whose a bot logs.
      const personId =
        actor !== undefined
          ? actor.personId
          : (command.personId ?? (by.type === "person" ? by.id : undefined));

      if (personId === undefined) {
        return yield* invariant(command.type, "Say whose time this is with a person.");
      }

      if (existing.timeEntries.some((entry) => entry.id === command.entryId)) {
        return yield* invariant(command.type, `Time entry '${command.entryId}' already exists.`);
      }

      const today = zonedToday(command.createdAt, command.timezone);
      const date = command.date ?? today;

      if (date > today) {
        return yield* invariant(command.type, "Time can't be logged on a future day.");
      }

      const entry = {
        id: command.entryId,
        taskId: existing.id,
        duration: command.duration,
        description: command.description ?? "",
        personId,
        date,
        createdBy: by,
        createdAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "task.time-created",
        payload: {
          task: { ...existing, timeEntries: [...existing.timeEntries, entry] },
          entry,
          actor: by,
        },
      };
    }

    case "task.time.delete": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });
      const entry = existing.timeEntries.find((candidate) => candidate.id === command.entryId);

      if (entry === undefined) {
        return yield* invariant(command.type, `Time entry '${command.entryId}' does not exist.`);
      }

      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.time-deleted",
        payload: {
          task: {
            ...existing,
            timeEntries: existing.timeEntries.filter((candidate) => candidate.id !== entry.id),
          },
          entryId: entry.id,
          entry,
          ...actorFields(commandActor(actor, command.by)),
        },
      };
    }

    case "task.comment.create": {
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
        type: "task.comment-created",
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

    case "task.comment.update": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "task.comment-updated",
        payload: {
          task: { ...existing, updatedAt: command.updatedAt },
          comment: {
            id: command.commentId,
            content: command.content,
            previousContent: command.previousContent,
            actor: command.by,
            updatedAt: command.updatedAt,
          },
        },
      };
    }

    case "task.comment.delete": {
      const existing = yield* requireTask({ readModel, command, taskId: command.taskId });

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.deletedAt,
          commandId: command.commandId,
        })),
        type: "task.comment-deleted",
        payload: {
          task: { ...existing, updatedAt: command.deletedAt },
          comment: {
            id: command.commentId,
            content: command.content,
            actor: command.by,
            deletedAt: command.deletedAt,
          },
        },
      };
    }
  }
});

const isLinkTo = (resource: WorkResource, taskId: string) =>
  resource.type === "task" && resource.id === taskId;

/** Otto: A task's owner answers for it, so the owner is always a person. */
const requirePersonOwner = (
  command: OrchestrationCommand,
  owner: WorkParticipant | null | undefined,
) =>
  owner?.kind === "bot"
    ? invariant(command.type, "A task's owner must be a person, not a bot.")
    : Effect.void;

const invariant = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));
