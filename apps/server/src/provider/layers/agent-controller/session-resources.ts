import type { BotWorkspaceIO } from "../../workspace/bot-workspace-io.ts";
import type { AgentControllerLiveOptions } from "./options.ts";

import { ThreadId } from "@otto/contracts";
import { Effect } from "effect";

import { ServerConfig } from "../../../config.ts";

import * as McpProviderSession from "../../../mcp/mcp-provider-session.ts";

import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";

import { OttoSessionResources } from "../../otto-session-resources.ts";

import { toMcpServerConfigs } from "./mcp-configuration.ts";

export function createSessionResources(deps: {
  readonly io: BotWorkspaceIO;
  readonly config: ServerConfig["Service"];
  readonly hostPlatform: NodeJS.Platform;
  readonly subscriptionAuth: SubscriptionAuthService;
  readonly options: AgentControllerLiveOptions | undefined;
}) {
  const sessionResources = new OttoSessionResources({
    io: deps.io,
    stateDir: deps.config.stateDir,
    hostPlatform: deps.hostPlatform,
    getPreviewMcpServerConfig: (threadId) => {
      const session = McpProviderSession.readMcpProviderSession(ThreadId.make(threadId));

      return session
        ? {
            url: session.endpoint,
            headers: { Authorization: session.authorizationHeader },
          }
        : undefined;
    },
    toMcpServerConfigs,
    onMcpServerConnectionFailure: (serverId) =>
      deps.subscriptionAuth.recordMcpRequestFailure(serverId, "The MCP server failed to connect."),
    // Otto: The bot already sees a browser failure in its tool result and says so in the chat,
    // so it is only logged, never an inbox incident.
    onBrowserFailure: ({ botId, botName, detail }) =>
      Effect.runFork(Effect.logWarning("bot browser failed", { botId, botName, detail })),
    ...(deps.options?.makeMcpManager ? { makeMcpManager: deps.options.makeMcpManager } : {}),
    ...(deps.options?.makeRemoteWorkspace
      ? { makeRemoteWorkspace: deps.options.makeRemoteWorkspace }
      : {}),
    ...(deps.options?.makeBotBrowser ? { makeBotBrowser: deps.options.makeBotBrowser } : {}),
    ...(deps.options?.resolveComputerUseServer
      ? { resolveComputerUseServer: deps.options.resolveComputerUseServer }
      : {}),
  });

  return { sessionResources };
}
