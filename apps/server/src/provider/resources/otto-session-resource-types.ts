import type { BotWorkspaceIO } from "../workspace/bot-workspace-io.ts";
import { createMcpManager, type McpServerConfig } from "@mastra/code-sdk/mcp/index";
import type { Workspace } from "@mastra/core/workspace";
import type { BotSandbox, McpServer, SandboxSize } from "@otto/contracts";
import type * as Duration from "effect/Duration";
import {
  type OttoBotWorkspace,
  type CreateRemoteBotWorkspaceInput,
} from "../workspace/bot-workspace-types.ts";

export interface OttoSessionResourceInput {
  readonly threadId: string;
  readonly resourceScope: string;
  readonly workspaceResourceKey: string;
  readonly workspaceId: string;
  readonly botSandbox?: BotSandbox | null;
  /** Resolved Boat size. Local computers ignore it. */
  readonly sandboxSize?: SandboxSize;
  readonly sandboxEnvironment?: Readonly<Record<string, string>>;
  readonly mcpServers: readonly McpServer[];
}

export interface OttoSessionResourceView {
  readonly botWorkspace: Workspace;
}

export interface OttoSessionResourcesOptions {
  readonly io: BotWorkspaceIO;
  readonly stateDir: string;
  readonly makeMcpManager?: typeof createMcpManager;
  readonly makeRemoteWorkspace?: (
    input: CreateRemoteBotWorkspaceInput,
  ) => Promise<OttoBotWorkspace | Workspace>;
  readonly onMcpServerConnectionFailure?: (serverId: McpServer["id"], message: string) => void;
  /** A completed handshake. Clears a prior failure so a healthy server does not stay failed. */
  readonly onMcpServerConnectionSuccess?: (serverId: McpServer["id"]) => void;
  readonly getPreviewMcpServerConfig?: (threadId: string) => McpServerConfig | undefined;
  readonly toMcpServerConfigs: (servers: readonly McpServer[]) => Record<string, McpServerConfig>;
  /** How long a bot's computer stays awake after its last session ends; zero sleeps it at once. */
  readonly workspaceIdleTimeToLive?: Duration.Input;
}
