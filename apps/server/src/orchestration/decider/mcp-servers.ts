import { type OrchestrationCommand, type OrchestrationReadModel } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../errors.ts";
import type { OrchestrationDispatchActor } from "../services/orchestration-engine.ts";
import { requireMcpServer, requireMcpServerAbsent } from "../command-invariants.ts";
import { addedToolStartsOff, disableAddedToolOnBots } from "./added-tools.ts";
import { withEventBase, nowIso, type DecideOrchestrationCommandResult } from "./event-base.ts";

export const decideMcpServers = Effect.fn("decideMcpServers")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    {
      type:
        | "mcp-server.create"
        | "mcp-server.update"
        | "mcp-server.instructions.set"
        | "mcp-server.delete"
        | "mcp-server.enable"
        | "mcp-server.disable"
        | "mcp-server.access.set";
    }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  /** A server with a recorded owner is changed only by that person; bots and older servers stay open. */
  const requireChangeable = (target: Exclude<typeof command, { type: "mcp-server.create" }>) =>
    requireMcpServer({ readModel, command: target, mcpServerId: target.mcpServerId }).pipe(
      Effect.flatMap((existing) =>
        target.by !== undefined &&
        existing.createdBy !== undefined &&
        existing.createdBy.personId !== target.by.personId
          ? Effect.fail(
              new OrchestrationCommandInvariantError({
                commandType: target.type,
                detail: "Only the person who added this MCP server can change it.",
              }),
            )
          : Effect.succeed(existing),
      ),
    );

  switch (command.type) {
    case "mcp-server.create": {
      yield* requireMcpServerAbsent({
        readModel,
        command,
        mcpServerId: command.mcpServerId,
      });

      const access = {
        ...(command.visibility ? { visibility: command.visibility } : {}),
        ...(command.by ? { createdBy: command.by } : {}),
      };

      const mcpServer =
        command.transport === "stdio"
          ? {
              id: command.mcpServerId,
              name: command.name,
              transport: command.transport,
              command: command.command,
              ...(command.args !== undefined ? { args: command.args } : {}),
              enabled: command.enabled ?? true,
              ...access,
              createdAt: command.createdAt,
              updatedAt: command.createdAt,
            }
          : {
              id: command.mcpServerId,
              name: command.name,
              transport: command.transport,
              url: command.url,
              enabled: command.enabled ?? true,
              ...access,
              createdAt: command.createdAt,
              updatedAt: command.createdAt,
            };

      const created = {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server" as const,
          aggregateId: command.mcpServerId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "mcp-server.created" as const,
        payload: { mcpServer },
      };

      if (!addedToolStartsOff(command.createdAt)) return created;

      const disables = yield* disableAddedToolOnBots({
        bots: readModel.bots,
        occurredAt: command.createdAt,
        commandId: command.commandId,
        mcpServerId: command.mcpServerId,
      });

      return disables.length === 0 ? created : [created, ...disables];
    }

    case "mcp-server.update": {
      const existing = yield* requireChangeable(command);

      const access = {
        ...(existing.visibility ? { visibility: existing.visibility } : {}),
        ...(existing.createdBy ? { createdBy: existing.createdBy } : {}),
      };

      const occurredAt = yield* nowIso;

      const mcpServer =
        command.transport === "stdio"
          ? {
              id: existing.id,
              name: command.name,
              transport: command.transport,
              command: command.command,
              ...(command.args !== undefined ? { args: command.args } : {}),
              ...(existing.instructions !== undefined
                ? { instructions: existing.instructions }
                : {}),
              enabled: existing.enabled,
              ...access,
              createdAt: existing.createdAt,
              updatedAt: occurredAt,
            }
          : {
              id: existing.id,
              name: command.name,
              transport: command.transport,
              url: command.url,
              ...(existing.instructions !== undefined
                ? { instructions: existing.instructions }
                : {}),
              enabled: existing.enabled,
              ...access,
              createdAt: existing.createdAt,
              updatedAt: occurredAt,
            };

      return {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server",
          aggregateId: command.mcpServerId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "mcp-server.updated",
        payload: { mcpServer },
      };
    }

    case "mcp-server.instructions.set": {
      const existing = yield* requireChangeable(command);

      const occurredAt = yield* nowIso;
      const { instructions: _previous, ...rest } = existing;
      const instructions = command.instructions.trim();

      return {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server",
          aggregateId: command.mcpServerId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "mcp-server.updated",
        payload: {
          mcpServer: {
            ...rest,
            ...(instructions ? { instructions } : {}),
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "mcp-server.delete": {
      yield* requireChangeable(command);
      const occurredAt = yield* nowIso;

      return {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server",
          aggregateId: command.mcpServerId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "mcp-server.deleted",
        payload: {
          mcpServerId: command.mcpServerId,
          deletedAt: occurredAt,
        },
      };
    }

    case "mcp-server.enable":
    case "mcp-server.disable": {
      const existing = yield* requireChangeable(command);

      const occurredAt = yield* nowIso;
      const enabled = command.type === "mcp-server.enable";

      return {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server",
          aggregateId: command.mcpServerId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: enabled ? "mcp-server.enabled" : "mcp-server.disabled",
        payload: {
          mcpServer: {
            ...existing,
            enabled,
            updatedAt: occurredAt,
          },
        },
      };
    }

    case "mcp-server.access.set": {
      const existing = yield* requireChangeable(command);
      const occurredAt = yield* nowIso;
      const createdBy = existing.createdBy ?? command.by;

      return {
        ...(yield* withEventBase({
          aggregateKind: "mcp-server",
          aggregateId: command.mcpServerId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "mcp-server.updated",
        payload: {
          mcpServer: {
            ...existing,
            visibility: command.visibility,
            ...(createdBy ? { createdBy } : {}),
            updatedAt: occurredAt,
          },
        },
      };
    }
  }
});
