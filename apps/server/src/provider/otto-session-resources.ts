import type { ToolsInput } from "@mastra/core/agent";
import { createMcpManager, type McpManager } from "@mastra/code-sdk/mcp/index";
import type { Workspace } from "@mastra/core/workspace";
import { createBotWorkspace, isRemoteBotSandbox } from "./bot-workspace.ts";
import { BotWorkspacePool, type BotWorkspaceLease } from "./bot-workspace-pool.ts";
import {
  type OttoSessionResourcesOptions,
  type OttoSessionResourceView,
  type OttoSessionResourceInput,
} from "./resources/otto-session-resource-types.ts";

const OTTO_PREVIEW_MCP_SERVER_NAME = "otto";

const OTTO_PREVIEW_TOOL_PREFIX = `${OTTO_PREVIEW_MCP_SERVER_NAME}_`;

/**
 * Mastra sessions reach image generation through the image_create catalog
 * tool on the runtime, not the shared `/mcp` server (their credential never
 * carries the `image` capability). Hide the dead MCP copy so a bot sees
 * exactly one image tool.
 */
const OTTO_MASTRA_HIDDEN_TOOLS = new Set([`${OTTO_PREVIEW_TOOL_PREFIX}generate_image`]);

export class OttoSessionResources {
  private readonly options: OttoSessionResourcesOptions;
  private readonly acquisitions = new Map<string, Promise<OttoSessionResourceView>>();
  private readonly mcpManagers = new Map<string, McpManager>();
  private readonly workspaceLeases = new Map<string, BotWorkspaceLease>();
  private readonly workspacePool = new BotWorkspacePool();
  private shuttingDown = false;

  constructor(options: OttoSessionResourcesOptions) {
    this.options = options;
  }

  acquire(input: OttoSessionResourceInput): Promise<OttoSessionResourceView> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Otto session resources are shutting down."));
    }

    const pending = this.acquisitions.get(input.threadId);

    if (pending) return pending;

    if (this.workspaceLeases.has(input.threadId)) {
      return Promise.reject(
        new Error(`Resources are already acquired for thread '${input.threadId}'.`),
      );
    }

    const acquisition = this.acquireOnce(input).finally(() => {
      if (this.acquisitions.get(input.threadId) === acquisition) {
        this.acquisitions.delete(input.threadId);
      }
    });

    this.acquisitions.set(input.threadId, acquisition);

    return acquisition;
  }

  private async acquireOnce(input: OttoSessionResourceInput): Promise<OttoSessionResourceView> {
    const key = input.threadId;

    try {
      const workspaceLease = await this.workspacePool.acquire(
        input.workspaceResourceKey,
        async () => {
          const workspace = await createBotWorkspace({
            io: this.options.io,
            threadId: input.resourceScope,
            workspaceId: input.workspaceId,
            identityFile: this.options.io.path.join(
              this.options.stateDir,
              "bot-workspaces",
              input.workspaceId,
              "provider.json",
            ),
            ...(isRemoteBotSandbox(input.botSandbox)
              ? {
                  sandbox: input.botSandbox,
                  ...(input.sandboxEnvironment ? { environment: input.sandboxEnvironment } : {}),
                }
              : {
                  sandbox: "local" as const,
                  sandboxProfileDirectory: this.options.io.path.join(
                    this.options.stateDir,
                    "sandbox-profiles",
                  ),
                  localRoot: this.options.io.path.join(
                    this.options.stateDir,
                    "bot-workspaces",
                    input.workspaceId,
                  ),
                }),
            ...(this.options.makeRemoteWorkspace
              ? { makeRemoteWorkspace: this.options.makeRemoteWorkspace }
              : {}),
          });

          if (!workspace) throw new Error(`Workspace is unavailable for thread '${key}'.`);

          return workspace;
        },
      );

      this.workspaceLeases.set(key, workspaceLease);

      const previewMcpServerConfig = this.options.getPreviewMcpServerConfig?.(key);

      if (input.mcpServers.length > 0 || previewMcpServerConfig) {
        const configs = this.options.toMcpServerConfigs(input.mcpServers);

        if (previewMcpServerConfig) {
          configs[OTTO_PREVIEW_MCP_SERVER_NAME] = previewMcpServerConfig;
        }

        const manager = (this.options.makeMcpManager ?? createMcpManager)(
          this.options.io.path.join(this.options.stateDir, "bot-mcp-runtime"),
          ".otto-runtime",
          configs,
        );

        this.mcpManagers.set(key, manager);

        try {
          await manager.init();
        } catch (cause) {
          for (const server of input.mcpServers) {
            this.options.onMcpServerConnectionFailure?.(server.id);
          }

          throw cause;
        }

        const serversById = new Map(input.mcpServers.map((server) => [String(server.id), server]));

        for (const status of manager.getServerStatuses()) {
          if (status.connected) continue;
          const server = serversById.get(status.name);

          if (server) this.options.onMcpServerConnectionFailure?.(server.id);
        }
      }

      return { botWorkspace: workspaceLease.workspace.workspace };
    } catch (cause) {
      await this.releaseOnce(key).catch(() => undefined);
      throw cause;
    }
  }

  getConnectorTools(threadId: string): ToolsInput {
    const tools: ToolsInput = this.mcpManagers.get(threadId)?.getTools() ?? {};

    return Object.fromEntries(
      Object.entries(tools)
        .filter(([name]) => !OTTO_MASTRA_HIDDEN_TOOLS.has(name))
        .map(([name, tool]) => [
          name.startsWith(OTTO_PREVIEW_TOOL_PREFIX)
            ? name.slice(OTTO_PREVIEW_TOOL_PREFIX.length)
            : name,
          tool,
        ]),
    );
  }

  getMcpManager(threadId: string): McpManager | undefined {
    return this.mcpManagers.get(threadId);
  }

  getMcpManagersForServer(serverId: string): readonly McpManager[] {
    return this.getMcpManagerSessionsForServer(serverId).map(({ manager }) => manager);
  }

  getMcpManagerSessionsForServer(
    serverId: string,
  ): readonly { readonly threadId: string; readonly manager: McpManager }[] {
    return [...this.mcpManagers.entries()].flatMap(([threadId, manager]) =>
      Object.hasOwn(manager.getConfig().mcpServers ?? {}, serverId) ? [{ threadId, manager }] : [],
    );
  }

  getWorkspace(threadId: string): Workspace | undefined {
    return this.workspaceLeases.get(threadId)?.workspace.workspace;
  }

  desktopUrl(threadId: string): (() => Promise<string>) | undefined {
    return this.workspaceLeases.get(threadId)?.workspace.desktopUrl;
  }

  retryFailedWorkspaceSleeps(): Promise<void> {
    return this.workspacePool.retryFailedSleeps();
  }

  async release(threadId: string, options?: { readonly destroy?: boolean }): Promise<void> {
    await this.acquisitions.get(threadId)?.catch(() => undefined);
    await this.releaseOnce(threadId, options);
  }

  private async releaseOnce(
    threadId: string,
    options?: { readonly destroy?: boolean },
  ): Promise<void> {
    const failures: unknown[] = [];
    const manager = this.mcpManagers.get(threadId);
    this.mcpManagers.delete(threadId);

    if (manager) await manager.disconnect().catch((cause) => failures.push(cause));

    const workspaceLease = this.workspaceLeases.get(threadId);
    this.workspaceLeases.delete(threadId);

    if (workspaceLease) {
      await workspaceLease.release(options).catch((cause) => failures.push(cause));
    }

    if (failures.length > 0) throw failures[0];
  }

  async shutdown(): Promise<void> {
    const failures: unknown[] = [];
    this.shuttingDown = true;
    await Promise.allSettled(this.acquisitions.values());

    const threadIds = new Set([
      ...this.acquisitions.keys(),
      ...this.workspaceLeases.keys(),
      ...this.mcpManagers.keys(),
    ]);

    const releases = await Promise.allSettled(
      [...threadIds].map((threadId) => this.release(threadId)),
    );

    for (const result of releases) {
      if (result.status === "rejected") failures.push(result.reason);
    }

    try {
      await this.workspacePool.retryFailedSleeps();
    } catch (cause) {
      failures.push(cause);
    }

    if (failures.length > 0) throw failures[0];
  }
}

export {
  type OttoSessionResourceInput,
  type OttoSessionResourceView,
  type OttoSessionResourcesOptions,
} from "./resources/otto-session-resource-types.ts";
