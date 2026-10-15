import {
  isGroupBotMember,
  isGroupPersonMember,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import {
  requireBotNotArchived,
  requireGroup,
  requireGroupAbsent,
  requireMutationActorAuthorized,
} from "../commandInvariants.ts";
import {
  type PlannedOrchestrationEvent,
  withEventBase,
  nowIso,
  botGroupUpdatedEvent,
  activeGroupBotIds,
  type DecideOrchestrationCommandResult,
} from "./eventBase.ts";

export const decideGroups = Effect.fn("decideGroups")(function* ({
  command,
  readModel,
  actor,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    {
      type:
        | "group.create"
        | "group.rename"
        | "group.delete"
        | "group.member.assign"
        | "group.member.unassign"
        | "group.person.assign"
        | "group.person.unassign"
        | "group.leave"
        | "group.boss.set";
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
    case "group.create": {
      yield* requireGroupAbsent({ readModel, command, groupId: command.groupId });

      // Otto: a group can be people only; its first bot, when there is one, is stored as boss.
      const memberBotIds = [
        ...new Set([
          ...(command.bossBotId === undefined ? [] : [command.bossBotId]),
          ...(command.specialistBotIds ?? []),
        ]),
      ];

      const bossBotId = memberBotIds[0] ?? null;

      yield* Effect.forEach(memberBotIds, (botId) =>
        requireBotNotArchived({ readModel, command, botId }),
      );

      const groupCreatedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: command.groupId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "group.created",
        payload: {
          groupId: command.groupId,
          name: command.name,
          bossBotId,
          members: [
            ...memberBotIds.map((botId) => ({
              kind: "bot" as const,
              botId,
              role: botId === bossBotId ? ("boss" as const) : ("specialist" as const),
            })),
            ...(command.creator === undefined ? [] : [command.creator]),
            ...(command.people ?? []).filter(
              (person, index, people) =>
                person.personId !== command.creator?.personId &&
                people.findIndex((other) => other.personId === person.personId) === index,
            ),
          ],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };

      return groupCreatedEvent;
    }

    case "group.rename": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });
      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: command.groupId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.renamed",
        payload: {
          groupId: command.groupId,
          name: command.name,
          updatedAt: occurredAt,
        },
      };
    }

    case "group.delete": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });
      const occurredAt = yield* nowIso;

      const deletedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: command.groupId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.deleted",
        payload: {
          groupId: command.groupId,
          deletedAt: occurredAt,
        },
      };

      const botUpdatedEvents = yield* Effect.forEach(
        group.members
          .filter(isGroupBotMember)
          .filter(
            (member) =>
              readModel.bots.find((bot) => bot.id === member.botId)?.groupId === command.groupId,
          ),
        (member) =>
          botGroupUpdatedEvent({
            botId: member.botId,
            groupId: null,
            occurredAt,
            commandId: command.commandId,
          }),
      );

      const threadUpdatedEvents = yield* Effect.forEach(
        readModel.threads.filter((thread) => thread.groupId === command.groupId),
        Effect.fn(function* (thread) {
          return {
            ...(yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: thread.id,
              occurredAt,
              commandId: command.commandId,
            })),
            type: "thread.ownership-updated" as const,
            payload: {
              threadId: thread.id,
              botId: null,
              groupId: null,
              updatedAt: occurredAt,
            },
          };
        }),
      );

      return [...botUpdatedEvents, ...threadUpdatedEvents, deletedEvent];
    }

    case "group.member.assign": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });
      const bot = yield* requireBotNotArchived({ readModel, command, botId: command.botId });

      if (command.role === "boss" && group.bossBotId !== null && group.bossBotId !== bot.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Group '${group.id}' already has boss bot '${group.bossBotId}'. Use 'group.boss.set' to replace it.`,
        });
      }

      if (command.role === "specialist" && group.bossBotId === bot.id) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Bot '${bot.id}' is the boss of group '${group.id}' and cannot be assigned as a specialist.`,
        });
      }

      const occurredAt = yield* nowIso;

      const assignedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: group.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.member-assigned",
        payload: {
          groupId: group.id,
          // Otto: the first bot to join a people-only group becomes its boss.
          member: {
            kind: "bot",
            botId: bot.id,
            role: group.bossBotId === null ? "boss" : command.role,
          },
          updatedAt: occurredAt,
        },
      };

      return assignedEvent;
    }

    case "group.member.unassign": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });

      const member = group.members
        .filter(isGroupBotMember)
        .find((entry) => entry.botId === command.botId);

      if (!member) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Bot '${command.botId}' is not a member of group '${group.id}'.`,
        });
      }

      const remainingBotIds = activeGroupBotIds(readModel, group);
      remainingBotIds.delete(command.botId);

      // Otto: the last bot may leave, which makes the group people only.
      if (
        remainingBotIds.size > 0 &&
        (member.role === "boss" || group.bossBotId === command.botId)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Bot '${command.botId}' is the boss of group '${group.id}'. Set a new boss and unassign the previous boss with one 'group.boss.set' command.`,
        });
      }

      const occurredAt = yield* nowIso;

      const unassignedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: group.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.member-unassigned",
        payload: {
          groupId: group.id,
          botId: command.botId,
          updatedAt: occurredAt,
        },
      };

      return unassignedEvent;
    }

    case "group.person.assign": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });

      if (
        group.members.some(
          (member) => isGroupPersonMember(member) && member.personId === command.person.personId,
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `${command.person.displayName} is already in this group.`,
        });
      }
      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: group.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.person-assigned",
        payload: {
          groupId: group.id,
          person: command.person,
          updatedAt: occurredAt,
        },
      };
    }

    case "group.person.unassign":
    case "group.leave": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });

      const person = group.members.find(
        (member) => member.kind === "person" && member.personId === command.personId,
      );

      if (!person) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Person '${command.personId}' is not a member of group '${group.id}'.`,
        });
      }

      const people = group.members.filter(isGroupPersonMember);

      // Anyone may leave; removing someone else takes the group's first person or an admin.
      if (
        command.type === "group.person.unassign" &&
        actor !== undefined &&
        !actor.canManageGroups &&
        actor.personId !== command.personId &&
        people[0]?.personId !== actor.personId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only the person who started this group or an admin can remove people.",
        });
      }

      if (people.length === 1) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "The last person cannot leave a group. Delete the group instead.",
        });
      }

      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: group.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.person-unassigned",
        payload: {
          groupId: group.id,
          personId: command.personId,
          updatedAt: occurredAt,
        },
      };
    }

    case "group.boss.set": {
      const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
      yield* requireMutationActorAuthorized({ group, command, actor });

      const nextBoss = yield* requireBotNotArchived({
        readModel,
        command,
        botId: command.bossBotId,
      });

      if (group.bossBotId === nextBoss.id && command.unassignPreviousBoss === true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Bot '${nextBoss.id}' is already the boss and cannot replace and unassign itself.`,
        });
      }

      if (command.unassignPreviousBoss === true) {
        const remainingBotIds = activeGroupBotIds(readModel, group);

        if (group.bossBotId !== null) remainingBotIds.delete(group.bossBotId);
        remainingBotIds.add(nextBoss.id);

        if (remainingBotIds.size < 1) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Group '${group.id}' requires at least one active bot.`,
          });
        }
      }

      const occurredAt = yield* nowIso;
      const previousBossBotId = group.bossBotId;

      const previousBossRole =
        previousBossBotId === null || previousBossBotId === nextBoss.id
          ? null
          : command.unassignPreviousBoss === true
            ? ("unassigned" as const)
            : ("specialist" as const);

      const bossSetEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "group",
          aggregateId: group.id,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "group.boss-set",
        payload: {
          groupId: group.id,
          bossBotId: nextBoss.id,
          previousBossBotId,
          previousBossRole,
          updatedAt: occurredAt,
        },
      };

      return bossSetEvent;
    }
  }
});
