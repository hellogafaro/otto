import type { BotWorkspaceIO } from "../../workspace/bot-workspace-io.ts";
import type { AgentControllerLiveOptions } from "./options.ts";

import { ThreadId } from "@otto/contracts";

import { ServerConfig } from "../../../config.ts";

import * as McpProviderSession from "../../../mcp/mcp-provider-session.ts";

import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";

import { OttoSessionResources } from "../../otto-session-resources.ts";

import { toMcpServerConfigs } from "./mcp-configuration.ts";

export function createSessionResources(deps: {
  readonly io: BotWorkspaceIO;
  readonly config: ServerConfig["Service"];
  readonly subscriptionAuth: SubscriptionAuthService;
  readonly options: AgentControllerLiveOptions | undefined;
}) {
  const sessionResources = new OttoSessionResources({
    io: deps.io,
    stateDir: deps.config.stateDir,
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
    // Otto: a group chat switches bots every message; keep a computer awake between turns
    // instead of stopping and waking it each time. Idle computers still stop after this.
    workspaceIdleTimeToLive: deps.options?.workspaceIdleTimeToLive ?? "5 minutes",
    onMcpServerConnectionFailure: (serverId) =>
      deps.subscriptionAuth.recordMcpRequestFailure(serverId, "The MCP server failed to connect."),
    ...(deps.options?.makeMcpManager ? { makeMcpManager: deps.options.makeMcpManager } : {}),
    ...(deps.options?.makeRemoteWorkspace
      ? { makeRemoteWorkspace: deps.options.makeRemoteWorkspace }
      : {}),
  });

  return { sessionResources };
}
