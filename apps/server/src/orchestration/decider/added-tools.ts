import {
  LIBRARY_SKILLS_FOLDER_ID,
  type BotId,
  type CommandId,
  type LibraryFolderId,
  type McpServerId,
} from "@otto/contracts";
import * as Effect from "effect/Effect";

import { type PlannedOrchestrationEvent, withEventBase } from "./event-base.ts";

/**
 * Additions at or after this instant start off for every bot. Earlier skills and
 * MCP servers keep the previous default, so bots do not lose tools they already use.
 */
const ADDED_TOOLS_START_OFF_AT = Date.parse("2026-10-19T21:00:00.000Z");

export const addedToolStartsOff = (createdAt: string) => {
  const at = Date.parse(createdAt);

  return Number.isFinite(at) && at >= ADDED_TOOLS_START_OFF_AT;
};

const appendId = <Id extends string>(ids: readonly Id[] | undefined, id: Id): Id[] =>
  ids?.includes(id) ? [...ids] : [...(ids ?? []), id];

export const unionIds = <Id extends string>(left: readonly Id[], right: readonly Id[]): Id[] => {
  const seen = new Set(left);
  const ids = [...left];

  for (const id of right) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
};

export const optInMcpServerIds = (
  servers: ReadonlyArray<{ readonly id: McpServerId; readonly createdAt: string }> | undefined,
) => (servers ?? []).flatMap((server) => (addedToolStartsOff(server.createdAt) ? [server.id] : []));

export const optInSkillIds = (
  folders:
    | ReadonlyArray<{
        readonly id: LibraryFolderId;
        readonly parentId: LibraryFolderId | null;
        readonly createdAt: string;
      }>
    | undefined,
) =>
  (folders ?? []).flatMap((folder) =>
    folder.parentId === LIBRARY_SKILLS_FOLDER_ID && addedToolStartsOff(folder.createdAt)
      ? [folder.id]
      : [],
  );

/** A new skill or MCP server is switched off on every bot, including archived ones. */
export const disableAddedToolOnBots = Effect.fn("disableAddedToolOnBots")(function* (input: {
  readonly bots: ReadonlyArray<{
    readonly id: BotId;
    readonly disabledMcpServerIds: readonly McpServerId[];
    readonly disabledSkillIds?: readonly LibraryFolderId[] | undefined;
  }>;
  readonly occurredAt: string;
  readonly commandId: CommandId;
  readonly mcpServerId?: McpServerId;
  readonly skillId?: LibraryFolderId;
}) {
  const events: PlannedOrchestrationEvent[] = [];

  for (const bot of input.bots) {
    events.push({
      ...(yield* withEventBase({
        aggregateKind: "bot",
        aggregateId: bot.id,
        occurredAt: input.occurredAt,
        commandId: input.commandId,
      })),
      type: "bot.updated",
      payload: {
        botId: bot.id,
        ...(input.mcpServerId !== undefined
          ? { disabledMcpServerIds: appendId(bot.disabledMcpServerIds, input.mcpServerId) }
          : {}),
        ...(input.skillId !== undefined
          ? { disabledSkillIds: appendId(bot.disabledSkillIds, input.skillId) }
          : {}),
        updatedAt: input.occurredAt,
      },
    });
  }

  return events;
});
