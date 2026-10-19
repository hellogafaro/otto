import { type McpServerConfig } from "@mastra/code-sdk/mcp/index";
import { type McpServer, type OrchestrationReadModel } from "@otto/contracts";
import { getMcpOAuthStorage, getMcpRuntimeHeaders } from "../../mcp-server-config.ts";
import { ottoMcpOAuthIdentity } from "../../mcp-oauth-public.ts";

/** Active bots that lose an MCP server when it goes away: every one that has not turned it off. */
export function mcpServerDependentBots(snapshot: OrchestrationReadModel, serverId: string) {
  return snapshot.bots
    .filter(
      (bot) =>
        bot.archivedAt === null && !bot.disabledMcpServerIds.some((id) => String(id) === serverId),
    )
    .map((bot) => ({ id: bot.id, name: bot.name }));
}

export function toMcpServerConfigs(
  servers: readonly McpServer[],
  publicOrigin?: string | null,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    servers.map((server) => [String(server.id), toMcpServerConfig(server, publicOrigin)]),
  );
}

/**
 * Projects one persisted Otto MCP registration into the Mastra connection
 * recipe. Authentication headers are transient runtime state and therefore
 * never become part of the persisted contract record.
 */
export function toMcpServerConfig(
  server: McpServer,
  publicOrigin?: string | null,
): McpServerConfig {
  if (server.transport === "stdio") {
    return { command: server.command, ...(server.args ? { args: [...server.args] } : {}) };
  }

  const headers = getMcpRuntimeHeaders(server);
  const oauthStorage = getMcpOAuthStorage(server);
  const identity = ottoMcpOAuthIdentity(publicOrigin);

  return {
    url: server.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(identity || oauthStorage
      ? {
          oauth: {
            ...(identity
              ? {
                  clientName: identity.clientName,
                  redirectUrl: identity.redirectUrl,
                  clientMetadataUrl: identity.clientMetadataUrl,
                }
              : {}),
            ...(oauthStorage ? { storage: oauthStorage } : {}),
          },
        }
      : {}),
  };
}

export function mcpServerIdForToolName(
  serverIds: readonly McpServer["id"][],
  toolName: string,
): McpServer["id"] | undefined {
  return serverIds
    .toSorted((left, right) => String(right).length - String(left).length)
    .find((serverId) => toolName.startsWith(`${serverId}_`));
}
