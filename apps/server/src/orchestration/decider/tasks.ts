import {
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type WorkParticipant,
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

export const decideTasks = Effect.fn("decideTasks")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<OrchestrationCommand, { type: "task.create" | "task.update" }>;
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
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
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

      return {
        ...(yield* withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "task.updated",
        payload: {
          task: {
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
          },
        },
      };
    }
  }
});
