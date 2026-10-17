import type { McpManager } from "@mastra/code-sdk/mcp/index";
import { type OttoToolId, decodeOttoToolInput } from "@otto/contracts";
import { parseOttoPublicUrl } from "./otto-web-fetch.ts";
import { createOttoPluginRuntime, pluginServerId } from "./tools/otto-plugin-catalog.ts";
import {
  type OttoMcpHealthHandlerOptions,
  type OttoCatalogBackendOptions,
  type OttoCatalogToolHandler,
} from "./tools/otto-catalog-types.ts";
import { requiredString, mcpHealthStatus, checkMcpConnection } from "./tools/otto-mcp-health.ts";

export function createOttoCatalogToolHandlers(
  mcpManager?: McpManager,
  pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>,
  health?: OttoMcpHealthHandlerOptions,
  backends: OttoCatalogBackendOptions = {},
): Partial<Record<OttoToolId, OttoCatalogToolHandler>> {
  const statuses = () => mcpManager?.getServerStatuses() ?? [];

  /** The configured MCP server an id names: its own id, or an installed plugin's server. */
  const serverIdOf = (id: string) =>
    [id, pluginServerId(id)].find((candidate) =>
      statuses().some((status) => status.name === candidate),
    );

  return {
    ...(backends.webSearch
      ? {
          web_search: async ({ input, webSearch }) => {
            const request = decodeOttoToolInput("web_search", input);

            return (webSearch ?? backends.webSearch!)({
              query: request.query,
              ...(request.domains ? { domains: request.domains } : {}),
            });
          },
        }
      : {}),
    ...(backends.webFetch
      ? {
          web_fetch: async ({ input }) => {
            const url = parseOttoPublicUrl(requiredString(input, "url"));

            return backends.webFetch!({ url: url.toString() });
          },
        }
      : {}),
    ...(backends.generateImage
      ? {
          image_create: async ({ input }) =>
            backends.generateImage!(decodeOttoToolInput("image_create", input)),
        }
      : {}),
    ...(backends.search
      ? {
          search: async ({ input }) => backends.search!(decodeOttoToolInput("search", input)),
        }
      : {}),
    ...(backends.library
      ? {
          library_create: async ({ input }) =>
            backends.library!.save(decodeOttoToolInput("library_create", input)),
          library_read: async ({ input }) =>
            backends.library!.read(decodeOttoToolInput("library_read", input)),
          library_update: async ({ input }) =>
            backends.library!.updateDocument(decodeOttoToolInput("library_update", input)),
          skill_read: async ({ input }) =>
            backends.library!.readSkillFile(decodeOttoToolInput("skill_read", input)),
          skill_create: async ({ input, responder }) =>
            backends.library!.proposeSkill(decodeOttoToolInput("skill_create", input), responder),
          skill_update: async ({ input, responder }) =>
            backends.library!.updateSkill(decodeOttoToolInput("skill_update", input), responder),
        }
      : {}),
    ...(backends.tasks
      ? {
          task_read: async ({ input }) =>
            backends.tasks!.read(decodeOttoToolInput("task_read", input)),
          task_create: async ({ input }) =>
            backends.tasks!.create(decodeOttoToolInput("task_create", input)),
          task_update: async ({ input }) =>
            backends.tasks!.update(decodeOttoToolInput("task_update", input)),
          task_comment: async ({ input }) =>
            backends.tasks!.comment(decodeOttoToolInput("task_comment", input)),
        }
      : {}),
    ...(pluginRuntime
      ? {
          connection_search: async ({ input }) =>
            pluginRuntime.search(
              decodeOttoToolInput("connection_search", input),
              statuses(),
              backends.botId,
            ),
        }
      : {}),
    ...(pluginRuntime || mcpManager
      ? {
          connection_read: async ({ input }) => {
            const { id } = decodeOttoToolInput("connection_read", input);
            const serverId = serverIdOf(id);

            if (serverId !== undefined && mcpManager && health) {
              return mcpHealthStatus(mcpManager, health, serverId);
            }

            if (pluginRuntime?.has(id)) return pluginRuntime.getPlugin(id, statuses());

            throw new Error(
              `No plugin or MCP server has the id '${id}'. Find it with connection_search.`,
            );
          },
        }
      : {}),
    ...(pluginRuntime || backends.uninstallMcpServer
      ? {
          connection_delete: async ({ input, emitProgress }) => {
            const { id } = decodeOttoToolInput("connection_delete", input);

            if (pluginRuntime?.has(id)) {
              await emitProgress(`Removing plugin '${id}'.`);

              return pluginRuntime.uninstall(id, statuses());
            }

            if (!backends.uninstallMcpServer) {
              throw new Error("Removing MCP servers is not available here.");
            }

            return backends.uninstallMcpServer(serverIdOf(id) ?? id);
          },
        }
      : {}),
    ...(pluginRuntime || backends.addMcpServer
      ? {
          connection_create: async ({ input, emitProgress }) => {
            const { pluginId, url, title } = decodeOttoToolInput("connection_create", input);

            if (pluginId !== undefined) {
              if (!pluginRuntime) throw new Error("The plugin catalog is not available here.");
              await emitProgress(`Installing plugin '${pluginId}'.`);

              return pluginRuntime.install(pluginId);
            }

            if (!backends.addMcpServer || url === undefined || title === undefined) {
              throw new Error("Adding MCP servers by url is not available here.");
            }

            return backends.addMcpServer({ url, title });
          },
        }
      : {}),
    ...(backends.renameMcpAccount && backends.setMcpInstructions
      ? {
          connection_update: async ({ input }) => {
            const { id, title, instructions } = decodeOttoToolInput("connection_update", input);
            const serverId = serverIdOf(id) ?? id;

            const renamed =
              title === undefined
                ? undefined
                : await backends.renameMcpAccount!({ serverId, name: title });

            const instructed =
              instructions === undefined
                ? undefined
                : await backends.setMcpInstructions!({ serverId, instructions });

            return Object.assign({ serverId }, renamed, instructed);
          },
        }
      : {}),
    ...(mcpManager
      ? {
          connection_check: async ({ input, emitProgress }) => {
            const { id, action } = decodeOttoToolInput("connection_check", input);
            const serverId = serverIdOf(id) ?? id;

            if (action !== "authenticate") {
              if (!health) throw new Error("Connection checks are not available here.");

              return checkMcpConnection(
                mcpManager,
                health,
                serverId,
                emitProgress,
                action === "test" ? "Testing" : "Reconnecting",
              );
            }

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
