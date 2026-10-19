import type { BotWorkspaceIO } from "../workspace/bot-workspace-io.ts";
import { createMcpManager, type McpServerConfig } from "@mastra/code-sdk/mcp/index";
import type { Workspace } from "@mastra/core/workspace";
import type { BotSandbox, McpServer } from "@otto/contracts";
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
  readonly onMcpServerConnectionFailure?: (serverId: McpServer["id"]) => void;
  readonly getPreviewMcpServerConfig?: (threadId: string) => McpServerConfig | undefined;
  readonly toMcpServerConfigs: (servers: readonly McpServer[]) => Record<string, McpServerConfig>;
  /** How long a bot's computer stays awake after its last session ends; zero sleeps it at once. */
  readonly workspaceIdleTimeToLive?: Duration.Input;
}
