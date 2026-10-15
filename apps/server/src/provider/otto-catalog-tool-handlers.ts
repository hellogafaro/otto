import * as Predicate from "effect/Predicate";
import type { McpManager } from "@mastra/code-sdk/mcp/index";
import { type OttoToolId, decodeOttoToolInput } from "@otto/contracts";
import { parseOttoPublicUrl } from "./otto-web-fetch.ts";
import { createOttoPluginRuntime } from "./tools/otto-plugin-catalog.ts";
import {
  type OttoMcpHealthHandlerOptions,
  type OttoCatalogBackendOptions,
  type OttoCatalogToolHandler,
} from "./tools/otto-catalog-types.ts";
import {
  requiredString,
  mcpHealthStatus,
  checkMcpConnection,
  field,
} from "./tools/otto-mcp-health.ts";

export function createOttoCatalogToolHandlers(
  mcpManager?: McpManager,
  pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>,
  health?: OttoMcpHealthHandlerOptions,
  backends: OttoCatalogBackendOptions = {},
): Partial<Record<OttoToolId, OttoCatalogToolHandler>> {
  const statuses = () => mcpManager?.getServerStatuses() ?? [];

  return {
    ...(backends.webSearch
      ? {
          WebSearch: async ({ input, webSearch }) => {
            const request = decodeOttoToolInput("WebSearch", input);

            return (webSearch ?? backends.webSearch!)({
              query: request.query,
              ...(request.domains ? { domains: request.domains } : {}),
            });
          },
        }
      : {}),
    ...(backends.webFetch
      ? {
          WebFetch: async ({ input }) => {
            const url = parseOttoPublicUrl(requiredString(input, "url"));

            return backends.webFetch!({ url: url.toString() });
          },
        }
      : {}),
    ...(backends.generateImage
      ? {
          GenerateImage: async ({ input }) =>
            backends.generateImage!(decodeOttoToolInput("GenerateImage", input)),
        }
      : {}),
    ...(backends.library
      ? {
          SaveToLibrary: async ({ input }) =>
            backends.library!.save(decodeOttoToolInput("SaveToLibrary", input)),
          ListLibrary: async ({ input }) =>
            backends.library!.list(decodeOttoToolInput("ListLibrary", input)),
          ReadLibraryFile: async ({ input }) =>
            backends.library!.read(decodeOttoToolInput("ReadLibraryFile", input)),
          UpdateLibraryDocument: async ({ input }) =>
            backends.library!.updateDocument(decodeOttoToolInput("UpdateLibraryDocument", input)),
          ListSkills: async () => backends.library!.listSkills(),
          ReadSkillFile: async ({ input }) =>
            backends.library!.readSkillFile(decodeOttoToolInput("ReadSkillFile", input)),
        }
      : {}),
    ...(backends.tasks
      ? {
          ListTasks: async ({ input }) =>
            backends.tasks!.list(decodeOttoToolInput("ListTasks", input)),
          ReadTask: async ({ input }) =>
            backends.tasks!.read(decodeOttoToolInput("ReadTask", input)),
          CreateTask: async ({ input }) =>
            backends.tasks!.create(decodeOttoToolInput("CreateTask", input)),
          UpdateTask: async ({ input }) =>
            backends.tasks!.update(decodeOttoToolInput("UpdateTask", input)),
          CommentOnTask: async ({ input }) =>
            backends.tasks!.comment(decodeOttoToolInput("CommentOnTask", input)),
        }
      : {}),
    ...(backends.addMcpServer
      ? {
          AddMcpServer: async ({ input }) =>
            backends.addMcpServer!(decodeOttoToolInput("AddMcpServer", input)),
        }
      : {}),
    ...(backends.uninstallMcpServer
      ? {
          UninstallMcpServer: async ({ input }) =>
            backends.uninstallMcpServer!(requiredString(input, "serverId")),
        }
      : {}),
    ...(backends.removeMcpAccount
      ? {
          RemoveMcpAccount: async ({ input }) =>
            backends.removeMcpAccount!(requiredString(input, "serverId")),
        }
      : {}),
    ...(backends.renameMcpAccount
      ? {
          RenameMcpAccount: async ({ input }) =>
            backends.renameMcpAccount!(decodeOttoToolInput("RenameMcpAccount", input)),
        }
      : {}),
    ...(backends.setMcpInstructions
      ? {
          SetMcpInstructions: async ({ input }) =>
            backends.setMcpInstructions!(decodeOttoToolInput("SetMcpInstructions", input)),
        }
      : {}),
    ...(pluginRuntime
      ? {
          SearchPlugins: async ({ input }) =>
            pluginRuntime.search(
              decodeOttoToolInput("SearchPlugins", input),
              statuses(),
              backends.botId,
            ),
          GetPlugin: async ({ input }) =>
            pluginRuntime.getPlugin(requiredString(input, "pluginId"), statuses()),
          InstallPlugin: async ({ input, emitProgress }) => {
            const pluginId = requiredString(input, "pluginId");
            await emitProgress(`Installing plugin '${pluginId}'.`);

            return pluginRuntime.install(pluginId);
          },
          UninstallPlugin: async ({ input, emitProgress }) => {
            const pluginId = requiredString(input, "pluginId");
            await emitProgress(`Removing plugin '${pluginId}'.`);

            return pluginRuntime.uninstall(pluginId, statuses());
          },
        }
      : {}),
    ...(mcpManager
      ? {
          ...(health
            ? {
                GetMcpServerStatus: async ({ input }) =>
                  mcpHealthStatus(mcpManager, health, requiredString(input, "serverId")),
                TestMcpServer: async ({ input, emitProgress }) =>
                  checkMcpConnection(
                    mcpManager,
                    health,
                    requiredString(input, "serverId"),
                    emitProgress,
                    "Testing",
                  ),
                ReconnectMcpServer: async ({ input, emitProgress }) =>
                  checkMcpConnection(
                    mcpManager,
                    health,
                    requiredString(input, "serverId"),
                    emitProgress,
                    "Reconnecting",
                  ),
              }
            : {}),
          AuthenticateMcpServer: async ({ input, emitProgress }) => {
            const serverId = requiredString(input, "serverId");
            let authorizationUrl: string | undefined;

            const status = await mcpManager.authenticateServer(serverId, {
              onAuthorizationUrl: (url) => {
                authorizationUrl = url;
                void emitProgress(`Authorize MCP server '${serverId}'.`, {
                  authorizationUrl: url,
                });
              },
            });

            if (!status.connected) {
              throw new Error(status.error ?? `MCP server '${serverId}' was not authenticated.`);
            }

            return { ...status, authorizationUrl: authorizationUrl ?? null };
          },
          RestartMcpServers: async ({ input, emitProgress }) => {
            const requested = field(input, "serverIds");

            const serverIds = Array.isArray(requested)
              ? requested.filter((value): value is string => Predicate.isString(value))
              : [];

            if (serverIds.length === 0) {
              await emitProgress("Restarting MCP servers.");
              await mcpManager.reload();

              return { servers: mcpManager.getServerStatuses() };
            }

            const servers = [];

            for (const serverId of new Set(serverIds)) {
              await emitProgress(`Restarting MCP server '${serverId}'.`);
              const status = await mcpManager.reconnectServer(serverId);

              if (!status.connected) {
                throw new Error(status.error ?? `MCP server '${serverId}' did not reconnect.`);
              }

              servers.push(status);
            }

            return { servers };
          },
        }
      : {}),
  };
}

export {
  type OttoCatalogToolHandlerInput,
  type OttoCatalogToolHandler,
  type OttoMcpDependencies,
  type OttoMcpHealthHandlerOptions,
  type OttoPluginRuntimeOptions,
  type OttoCatalogBackendOptions,
} from "./tools/otto-catalog-types.ts";

export { createOttoPluginRuntime } from "./tools/otto-plugin-catalog.ts";
