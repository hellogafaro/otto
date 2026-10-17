import * as NodeCrypto from "node:crypto";
import { type BotId, CommandId, McpServerId, type ThreadId } from "@otto/contracts";
import { runImageGenerationTool } from "../../../image-generation/image-generation-runtime.ts";
import { activeLibraryTools } from "../../../library/library-tool-runtime.ts";
import { activeTaskTools } from "../../../tasks/task-tool-runtime.ts";
import { createOttoCatalogToolHandlers } from "../../otto-catalog-tool-handlers.ts";
import { ottoWebSearchUnavailable } from "../../otto-web-fetch.ts";
import { nowIso } from "./event-identity.ts";
import { createSessionSearch } from "./search-tool.ts";
import { mcpServerDependentBots } from "./mcp-configuration.ts";
import type { SessionLifecycleDependencies } from "./session-lifecycle-dependencies.ts";

/**
 * Catalog tool handlers for one bot session: MCP request health and inbox
 * incidents, image generation, and the catalog MCP server management tools.
 */
export function createSessionCatalogHandlers(
  deps: SessionLifecycleDependencies,
  input: {
    readonly threadId: ThreadId;
    readonly botId: BotId | undefined;
    readonly botName: string | undefined;
    readonly mcpManager: ReturnType<
      SessionLifecycleDependencies["sessionResources"]["getMcpManager"]
    >;
  },
) {
  const { threadId, mcpManager } = input;
  const libraryTools = activeLibraryTools();
  const libraryCaller = input.botId ? { threadId, botId: input.botId } : null;
  const taskTools = activeTaskTools();

  const mcpDependencies =
    input.botId && input.botName
      ? { dependentBots: [{ id: input.botId, name: input.botName }], dependentRoutines: [] }
      : { dependentBots: [], dependentRoutines: [] };

  return createOttoCatalogToolHandlers(
    mcpManager,
    deps.wired().pluginRuntime,
    mcpManager
      ? {
          getRequestHealth: (serverId) => deps.subscriptionAuth.mcpRequestHealth(serverId),
          recordSuccess: (serverId, at) =>
            deps.subscriptionAuth.recordMcpRequestSuccess(serverId, at),
          recordFailure: (serverId, message, at) =>
            deps.subscriptionAuth.recordMcpRequestFailure(serverId, message, at),
          getDependencies: async (serverId) => {
            const snapshot = await deps.wired().pluginRuntimeOptions?.readSnapshot();

            return snapshot
              ? {
                  dependentBots: mcpServerDependentBots(snapshot, serverId),
                  dependentRoutines: [],
                }
              : mcpDependencies;
          },
          onFailure: (serverId, message, dependencies) => {
            for (const bot of dependencies.dependentBots) {
              deps.botInbox.ensureOpen({
                incidentKey: `access:mcp-${serverId}:${bot.id}`,
                kind: "connector-failure",
                botId: bot.id,
                botName: bot.name,
                taskOrRoutine: `${serverId} access`,
                lastFailure: message,
                nextAction: `Reconnect ${serverId}, then retry its failed request.`,
              });
            }
          },
          onRecovery: (serverId, dependencies) => {
            for (const bot of dependencies.dependentBots) {
              deps.botInbox.resolve(`access:mcp-${serverId}:${bot.id}`);
            }
          },
        }
      : undefined,
    {
      webSearch: ottoWebSearchUnavailable,
      webFetch: deps.webFetch,
      // The router bounds each provider attempt and interruptTurn cancels
      // in-flight requests, so there is no outer deadline here.
      ...(input.botId
        ? {
            botId: input.botId,
            search: createSessionSearch(deps, { threadId, botId: input.botId }),
          }
        : {}),
      generateImage: async (request) => {
        const generate = deps.options?.generateImage ?? runImageGenerationTool;

        return deps.runPromise(generate(threadId, request));
      },
      ...(libraryTools && libraryCaller
        ? {
            library: {
              save: (request) => deps.runPromise(libraryTools.save(libraryCaller, request)),
              read: (request) => deps.runPromise(libraryTools.read(libraryCaller, request)),
              updateDocument: (request) =>
                deps.runPromise(libraryTools.updateDocument(libraryCaller, request)),
              readSkillFile: (request) =>
                deps.runPromise(libraryTools.readSkillFile(libraryCaller, request)),
            },
          }
        : {}),
      ...(taskTools && libraryCaller
        ? {
            tasks: {
              read: (request) => deps.runPromise(taskTools.read(libraryCaller, request)),
              create: (request) => deps.runPromise(taskTools.create(libraryCaller, request)),
              update: (request) => deps.runPromise(taskTools.update(libraryCaller, request)),
              comment: (request) => deps.runPromise(taskTools.comment(libraryCaller, request)),
            },
          }
        : {}),
      ...(deps.wired().pluginRuntimeOptions
        ? {
            addMcpServer: async ({ url, title }) => {
              const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40);

              const serverId = McpServerId.make(
                `${slug || "mcp"}-${NodeCrypto.randomUUID().slice(0, 6)}`,
              );

              await deps.wired().pluginRuntimeOptions!.dispatch({
                type: "mcp-server.create",
                commandId: CommandId.make(`catalog:mcp-add:${NodeCrypto.randomUUID()}`),
                mcpServerId: serverId,
                name: title,
                transport: "url",
                url,
                enabled: true,
                createdAt: nowIso(),
              });

              return {
                serverId,
                added: true,
                next: "Check it with connection_check; sign in with action authenticate if it asks.",
              };
            },
            uninstallMcpServer: (serverId: string) =>
              deps.deleteCatalogMcpServer(
                deps.wired().pluginRuntimeOptions!,
                serverId,
                "mcp-delete",
              ),
            renameMcpAccount: async (value) => {
              const server = (
                await deps.wired().pluginRuntimeOptions!.readSnapshot()
              ).mcpServers?.find((candidate) => candidate.id === value.serverId);

              if (!server) throw new Error(`MCP server '${value.serverId}' was not found.`);

              const base = {
                type: "mcp-server.update" as const,
                commandId: CommandId.make(`catalog:mcp-rename:${NodeCrypto.randomUUID()}`),
                mcpServerId: server.id,
                name: value.name,
              };

              await deps.wired().pluginRuntimeOptions!.dispatch(
                server.transport === "stdio"
                  ? {
                      ...base,
                      transport: "stdio",
                      command: server.command,
                      ...(server.args ? { args: [...server.args] } : {}),
                    }
                  : { ...base, transport: "url", url: server.url },
              );

              return { serverId: value.serverId, name: value.name, renamed: true };
            },
            setMcpInstructions: async (value: {
              readonly serverId: string;
              readonly instructions: string;
            }) => {
              await deps.wired().pluginRuntimeOptions!.dispatch({
                type: "mcp-server.instructions.set",
                commandId: CommandId.make(`catalog:mcp-instructions:${NodeCrypto.randomUUID()}`),
                mcpServerId: McpServerId.make(value.serverId),
                instructions: value.instructions,
              });

              return {
                serverId: value.serverId,
                instructions: value.instructions.trim(),
                appliesFrom: "next-turn",
              };
            },
          }
        : {}),
    },
  );
}
