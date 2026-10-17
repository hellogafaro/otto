import { OttoDelegationPhase } from "@otto/contracts";

import {
  type BotId,
  type CommandId,
  DEFAULT_RUNTIME_MODE,
  isGroupBotMember,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  sameAlwaysAllowedTool,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../errors.ts";
import type { OrchestrationDispatchActor } from "../services/orchestration-engine.ts";
import {
  hasBotOwnerAuthority,
  requireBot,
  requireBotAbsent,
  requireBotArchived,
  requireBotNotArchived,
  requireGroup,
} from "../command-invariants.ts";
import {
  type PlannedOrchestrationEvent,
  withEventBase,
  activeGroupBotIds,
  nowIso,
  TERMINAL_DELEGATION_PHASES,
  delegationChildThreadId,
  delegationChildTurnId,
  type DecideOrchestrationCommandResult,
} from "./event-base.ts";

/** Hands a group's stored first-bot slot to its next active bot, so no bot is ever stuck as "boss". */
const handOverGroupSlots = Effect.fnUntraced(function* (input: {
  readonly readModel: OrchestrationReadModel;
  readonly botId: BotId;
  readonly commandId: CommandId;
  readonly occurredAt: string;
}) {
  const events: PlannedOrchestrationEvent[] = [];

  for (const group of input.readModel.groups) {
    if (group.bossBotId !== input.botId) continue;

    const next = group.members
      .filter(isGroupBotMember)
      .find(
        (member) =>
          member.botId !== input.botId &&
          input.readModel.bots.some((bot) => bot.id === member.botId && bot.archivedAt === null),
      );

    if (!next) continue;
    events.push({
      ...(yield* withEventBase({
        aggregateKind: "group",
        aggregateId: group.id,
        occurredAt: input.occurredAt,
        commandId: input.commandId,
      })),
      type: "group.boss-set",
      payload: {
        groupId: group.id,
        bossBotId: next.botId,
        previousBossBotId: input.botId,
        previousBossRole: "specialist",
        updatedAt: input.occurredAt,
      },
    });
  }

  return events;
});

export const decideBots = Effect.fn("decideBots")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    { type: "bot.create" | "bot.update" | "bot.archive" | "bot.restore" | "bot.delete" }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "bot.create": {
      yield* requireBotAbsent({ readModel, command, botId: command.botId });

      if (command.owner?.kind === "bot") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A bot's owner must be a person.",
        });
      }

      const group =
        command.groupId === null
          ? null
          : yield* requireGroup({ readModel, command, groupId: command.groupId });

      const botCreatedEvent: PlannedOrchestrationEvent = {
        ...(yield* withEventBase({
          aggregateKind: "bot",
          aggregateId: command.botId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "bot.created",
        payload: {
          botId: command.botId,
          name: command.name,
          title: command.title,
          label: command.label ?? null,
          description: command.description ?? null,
          instructions: command.instructions ?? null,
          disabledMcpServerIds: command.disabledMcpServerIds ?? [],
          owner: command.owner ?? null,
          avatar: command.avatar,
          engine: command.engine,
          sandbox: command.sandbox,
          runtimeMode: command.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          imageProvider: command.imageProvider ?? null,
          voiceEnabled: command.voiceEnabled ?? false,
          channelBindings: [],
          groupId: command.groupId,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };

      if (
        group === null ||
        group.members.some((member) => isGroupBotMember(member) && member.botId === command.botId)
      ) {
        return botCreatedEvent;
      }

      return [
        {
          ...(yield* withEventBase({
            aggregateKind: "group",
            aggregateId: group.id,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "group.member-assigned",
          payload: {
            groupId: group.id,
            member: { kind: "bot", botId: command.botId, role: "specialist" },
            updatedAt: command.createdAt,
          },
        },
        botCreatedEvent,
      ];
    }

    case "bot.update": {
      const bot = yield* requireBot({ readModel, command, botId: command.botId });

      if (command.owner?.kind === "bot") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "A bot's owner must be a person.",
        });
      }

      if (
        command.owner !== undefined &&
        command.by?.kind === "person" &&
        !hasBotOwnerAuthority(bot, command.by.personId)
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only the bot's owner can hand it to someone else.",
        });
      }

      if (
        command.alwaysAllow !== undefined &&
        (command.by?.kind !== "person" || !hasBotOwnerAuthority(bot, command.by.personId))
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only the bot's owner can choose Always allow for it.",
        });
      }

      const allowed = bot.alwaysAllowed ?? [];
      const keep = command.alwaysAllowed;

      if (keep?.some((rule) => !allowed.some((kept) => sameAlwaysAllowedTool(kept, rule)))) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Only Always allow on an approval adds an always-allowed tool.",
        });
      }

      const kept = keep
        ? allowed.filter((rule) => keep.some((entry) => sameAlwaysAllowedTool(rule, entry)))
        : allowed;

      const added = command.alwaysAllow;

      const alwaysAllowed = added
        ? [...kept.filter((rule) => !sameAlwaysAllowedTool(rule, added)), added]
        : kept;

      const targetGroup =
        command.groupId == null
          ? null
          : yield* requireGroup({ readModel, command, groupId: command.groupId });

      if (command.groupId !== undefined && command.groupId !== null) {
        yield* requireBotNotArchived({ readModel, command, botId: command.botId });
      }

      const sourceGroup =
        command.groupId !== undefined && bot.groupId !== null && bot.groupId !== command.groupId
          ? readModel.groups.find((group) => group.id === bot.groupId)
          : undefined;

      const sourceMembership = sourceGroup?.members
        .filter(isGroupBotMember)
        .find((member) => member.botId === bot.id);

      if (sourceGroup && sourceMembership) {
        const remainingBotIds = activeGroupBotIds(readModel, sourceGroup);
        remainingBotIds.delete(bot.id);

        if (remainingBotIds.size < 1) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Group '${sourceGroup.id}' requires at least one active bot.`,
          });
        }
      }

      const occurredAt = yield* nowIso;
      const events: PlannedOrchestrationEvent[] = [];

      if (sourceGroup && sourceMembership) {
        events.push(
          ...(yield* handOverGroupSlots({
            readModel,
            botId: bot.id,
            commandId: command.commandId,
            occurredAt,
          })).filter((event) => event.aggregateId === sourceGroup.id),
        );
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "group",
            aggregateId: sourceGroup.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "group.member-unassigned",
          payload: { groupId: sourceGroup.id, botId: bot.id, updatedAt: occurredAt },
        });
      }

      if (
        command.groupId !== undefined &&
        targetGroup !== null &&
        targetGroup.id !== bot.groupId &&
        !targetGroup.members.some((member) => isGroupBotMember(member) && member.botId === bot.id)
      ) {
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "group",
            aggregateId: targetGroup.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "group.member-assigned",
          payload: {
            groupId: targetGroup.id,
            member: { kind: "bot", botId: bot.id, role: "specialist" },
            updatedAt: occurredAt,
          },
        });
      }

      events.push({
        ...(yield* withEventBase({
          aggregateKind: "bot",
          aggregateId: command.botId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "bot.updated",
        payload: {
          botId: command.botId,
          ...(command.name !== undefined ? { name: command.name } : {}),
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.label !== undefined ? { label: command.label } : {}),
          ...(command.description !== undefined ? { description: command.description } : {}),
          ...(command.instructions !== undefined ? { instructions: command.instructions } : {}),
          ...(command.disabledMcpServerIds !== undefined
            ? { disabledMcpServerIds: command.disabledMcpServerIds }
            : {}),
          ...(command.disabledSkillIds !== undefined
            ? { disabledSkillIds: command.disabledSkillIds }
            : {}),
          ...(keep !== undefined || added !== undefined ? { alwaysAllowed } : {}),
          ...(command.owner !== undefined ? { owner: command.owner } : {}),
          ...(command.avatar !== undefined ? { avatar: command.avatar } : {}),
          ...(command.engine !== undefined ? { engine: command.engine } : {}),
          ...(command.sandbox !== undefined ? { sandbox: command.sandbox } : {}),
          ...(command.runtimeMode !== undefined ? { runtimeMode: command.runtimeMode } : {}),
          ...(command.imageProvider !== undefined ? { imageProvider: command.imageProvider } : {}),
          ...(command.voiceEnabled !== undefined ? { voiceEnabled: command.voiceEnabled } : {}),
          ...(command.channelBindings !== undefined
            ? { channelBindings: command.channelBindings }
            : {}),
          ...(command.groupId !== undefined ? { groupId: command.groupId } : {}),
          updatedAt: occurredAt,
        },
      });

      return events;
    }

    case "bot.archive": {
      yield* requireBotNotArchived({ readModel, command, botId: command.botId });

      const undersizedGroup = readModel.groups.find((group) => {
        if (
          !group.members.some(
            (member) => isGroupBotMember(member) && member.botId === command.botId,
          )
        ) {
          return false;
        }

        const remainingBotIds = activeGroupBotIds(readModel, group);
        remainingBotIds.delete(command.botId);

        return remainingBotIds.size < 1;
      });

      if (undersizedGroup) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Group '${undersizedGroup.id}' requires at least one active bot.`,
        });
      }

      const occurredAt = yield* nowIso;

      const archivedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "bot",
          aggregateId: command.botId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "bot.archived" as const,
        payload: {
          botId: command.botId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };

      const pausedEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];

      for (const routine of readModel.routines ?? []) {
        if (
          routine.botId !== command.botId ||
          !routine.enabled ||
          routine.lifecycle === "deleted"
        ) {
          continue;
        }

        pausedEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "routine",
            aggregateId: routine.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "routine.paused",
          payload: {
            routine: {
              ...routine,
              enabled: false,
              lifecycle: "paused",
              nextRunAt: null,
              updatedAt: occurredAt,
            },
          },
        });
      }

      const handOvers = yield* handOverGroupSlots({
        readModel,
        botId: command.botId,
        commandId: command.commandId,
        occurredAt,
      });

      return [...handOvers, ...pausedEvents, archivedEvent];
    }

    case "bot.restore": {
      yield* requireBotArchived({ readModel, command, botId: command.botId });
      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "bot",
          aggregateId: command.botId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "bot.restored",
        payload: {
          botId: command.botId,
          updatedAt: occurredAt,
        },
      };
    }

    case "bot.delete": {
      const bot = yield* requireBot({ readModel, command, botId: command.botId });

      if (command.archivedAt !== undefined && bot.archivedAt !== command.archivedAt) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Bot '${command.botId}' is no longer archived at ${command.archivedAt}.`,
        });
      }

      const undersizedGroup = readModel.groups.find((group) => {
        if (
          !group.members.some(
            (member) => isGroupBotMember(member) && member.botId === command.botId,
          )
        ) {
          return false;
        }

        const remainingBotIds = activeGroupBotIds(readModel, group);
        remainingBotIds.delete(command.botId);

        return remainingBotIds.size < 1;
      });

      if (undersizedGroup) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Group '${undersizedGroup.id}' requires at least one active bot.`,
        });
      }

      const occurredAt = yield* nowIso;
      const events: Array<Omit<OrchestrationEvent, "sequence">> = [];
      events.push(
        ...(yield* handOverGroupSlots({
          readModel,
          botId: command.botId,
          commandId: command.commandId,
          occurredAt,
        })),
      );

      // Canceling interrupts each child turn, so work the bot sent or received stops with it.
      for (const delegation of readModel.delegations) {
        if (
          TERMINAL_DELEGATION_PHASES.has(delegation.phase._tag) ||
          (delegation.parentBotId !== bot.id &&
            delegation.childBotId !== bot.id &&
            !delegation.ancestorBotIds.includes(bot.id))
        ) {
          continue;
        }

        const canceledAt =
          Date.parse(occurredAt) >= Date.parse(delegation.updatedAt)
            ? occurredAt
            : delegation.updatedAt;

        events.push({
          ...(yield* withEventBase({
            aggregateKind: "delegation",
            aggregateId: delegation.delegationId,
            occurredAt: canceledAt,
            commandId: command.commandId,
          })),
          type: "delegation.updated",
          payload: {
            delegation: {
              ...delegation,
              phase: OttoDelegationPhase.cases.Canceled.make({
                childThreadId: delegationChildThreadId(delegation.phase),
                childTurnId: delegationChildTurnId(delegation.phase),
                startedAt: "startedAt" in delegation.phase ? delegation.phase.startedAt : null,
                completedAt: canceledAt,
                canceledBy: "user",
              }),
              updatedAt: canceledAt,
            },
          },
        });
      }

      // Chats the bot owns or is answering in a group, plus their child chats, lose their agent.
      const liveThreads = readModel.threads.filter((thread) => thread.deletedAt === null);

      const stoppedThreadIds = new Set(
        liveThreads
          .filter((thread) => thread.botId === bot.id || thread.respondingBotId === bot.id)
          .map((thread) => thread.id),
      );

      for (let grew = true; grew; ) {
        grew = false;

        for (const thread of liveThreads) {
          if (
            !stoppedThreadIds.has(thread.id) &&
            thread.parentThreadId != null &&
            stoppedThreadIds.has(thread.parentThreadId)
          ) {
            stoppedThreadIds.add(thread.id);
            grew = true;
          }
        }
      }

      for (const thread of liveThreads) {
        if (
          !stoppedThreadIds.has(thread.id) ||
          !thread.session ||
          thread.session.status === "stopped"
        ) {
          continue;
        }

        events.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: thread.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.session-stop-requested",
          payload: {
            threadId: thread.id,
            createdAt: occurredAt,
          },
        });
      }

      for (const group of readModel.groups) {
        if (!group.members.some((member) => isGroupBotMember(member) && member.botId === bot.id)) {
          continue;
        }

        events.push({
          ...(yield* withEventBase({
            aggregateKind: "group",
            aggregateId: group.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "group.member-unassigned",
          payload: {
            groupId: group.id,
            botId: bot.id,
            updatedAt: occurredAt,
          },
        });
      }

      for (const thread of liveThreads) {
        const owned = thread.botId === bot.id;

        if (!owned && thread.respondingBotId !== bot.id) {
          continue;
        }

        // An owned chat is detached. A group chat keeps its owners and only drops the responder.
        events.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: thread.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.ownership-updated",
          payload: {
            threadId: thread.id,
            botId: owned ? null : (thread.botId ?? null),
            groupId: owned ? null : (thread.groupId ?? null),
            updatedAt: occurredAt,
          },
        });

        // A detached chat has no bot page, so it moves to Archived chats where it stays reachable.
        if (owned && thread.archivedAt === null) {
          events.push({
            ...(yield* withEventBase({
              aggregateKind: "thread",
              aggregateId: thread.id,
              occurredAt,
              commandId: command.commandId,
            })),
            type: "thread.archived",
            payload: { threadId: thread.id, archivedAt: occurredAt, updatedAt: occurredAt },
          });
        }
      }

      for (const routine of readModel.routines ?? []) {
        if (routine.botId !== bot.id || routine.lifecycle === "deleted") {
          continue;
        }

        events.push({
          ...(yield* withEventBase({
            aggregateKind: "routine",
            aggregateId: routine.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "routine.deleted",
          payload: {
            routine: {
              ...routine,
              enabled: false,
              lifecycle: "deleted",
              nextRunAt: null,
              updatedAt: occurredAt,
              deletedAt: occurredAt,
            },
          },
        });
      }

      for (const assignment of readModel.skillAssignments ?? []) {
        if (assignment.botId !== bot.id) {
          continue;
        }

        events.push({
          ...(yield* withEventBase({
            aggregateKind: "skill-assignment",
            aggregateId: assignment.id,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "skill-assignment.unassigned",
          payload: {
            assignmentId: assignment.id,
            botId: bot.id,
            removedAt: occurredAt,
          },
        });
      }

      events.push({
        ...(yield* withEventBase({
          aggregateKind: "bot",
          aggregateId: command.botId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "bot.deleted",
        payload: {
          botId: command.botId,
          deletedAt: occurredAt,
        },
      });

      return events;
    }
  }
});
