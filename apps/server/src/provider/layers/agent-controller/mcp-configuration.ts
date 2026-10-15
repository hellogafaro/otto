import { type McpServerConfig } from "@mastra/code-sdk/mcp/index";
import { type McpServer, type OrchestrationReadModel } from "@otto/contracts";
import {
  getMcpOAuthStorage,
  getMcpRuntimeHeaders,
  mcpServerNeedsBrowserAttachment,
} from "../../mcp-server-config.ts";
import type { BotBrowserAttachment } from "../../bot-browser.ts";

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
  browser?: BotBrowserAttachment,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    servers.map((server) => [String(server.id), toMcpServerConfig(server, browser)]),
  );
}

/**
 * Projects one persisted Otto MCP registration into the Mastra connection
 * recipe. Authentication headers are transient runtime state and therefore
 * never become part of the persisted contract record.
 */
export function toMcpServerConfig(
  server: McpServer,
  browser?: BotBrowserAttachment,
): McpServerConfig {
  const runtimeHeaders = getMcpRuntimeHeaders(server);

  if (server.transport === "stdio") {
    const browserAttachment =
      browser && mcpServerNeedsBrowserAttachment(server, browser.availableToHostedPlugins)
        ? {
            OTTO_BROWSER_MCP_URL: browser.browserUrl,
            OTTO_BROWSER_MCP_SESSION_ID: browser.mcpSessionId,
            OTTO_BROWSER_MCP_HEADERS: JSON.stringify(browser.localRequestHeaders),
          }
        : undefined;

    return {
      command: server.command,
      ...(server.args ? { args: [...server.args] } : {}),
      ...(browserAttachment ? { env: browserAttachment } : {}),
    };
  }

  const browserHeaders =
    browser?.availableToHostedPlugins &&
    mcpServerNeedsBrowserAttachment(server, browser.availableToHostedPlugins)
      ? {
          ...runtimeHeaders,
          "x-otto-browser-mcp-url": browser.browserUrl,
          "x-otto-browser-mcp-session-id": browser.mcpSessionId,
          "x-otto-browser-mcp-headers": JSON.stringify(browser.requestHeaders),
        }
      : runtimeHeaders;

  const oauthStorage = getMcpOAuthStorage(server);

  return {
    url: server.url,
    ...(Object.keys(browserHeaders).length > 0 ? { headers: browserHeaders } : {}),
    ...(oauthStorage ? { oauth: { storage: oauthStorage } } : {}),
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
