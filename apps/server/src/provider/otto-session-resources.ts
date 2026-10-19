import type { ToolsInput } from "@mastra/core/agent";
import { createMcpManager, type McpManager } from "@mastra/code-sdk/mcp/index";
import type { Workspace } from "@mastra/core/workspace";
import * as DateTime from "effect/DateTime";
import type { BotSandbox } from "@otto/contracts";
import {
  createBotWorkspace,
  destroyRemoteComputer,
  isRemoteBotSandbox,
  type RemoteBotSandbox,
} from "./bot-workspace.ts";
import {
  BotWorkspacePool,
  type BotWorkspaceLease,
  botIdFromResourceScope,
  isLegacyBotComputerScope,
} from "./bot-workspace-pool.ts";
import {
  type BotWorkspaceRecord,
  readIdentity,
  writeIdentity,
} from "./workspace/bot-workspace-lifecycle.ts";
import type { OttoBotWorkspace } from "./workspace/bot-workspace-types.ts";
import {
  type OttoSessionResourcesOptions,
  type OttoSessionResourceView,
  type OttoSessionResourceInput,
} from "./resources/otto-session-resource-types.ts";

const OTTO_PREVIEW_MCP_SERVER_NAME = "otto";

const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface BotComputerSweepResult {
  readonly workspaceId: string;
  readonly provider: string;
  readonly providerId?: string;
  readonly reason: "bot_deleted" | "sandbox_changed" | "replaced" | "orphan";
  readonly error?: string;
}

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
  private readonly workspacePool: BotWorkspacePool;
  private readonly workspaceIds = new Map<string, string>();
  private shuttingDown = false;

  constructor(options: OttoSessionResourcesOptions) {
    this.options = options;
    this.workspacePool = new BotWorkspacePool(
      options.workspaceIdleTimeToLive === undefined
        ? {}
        : { idleTimeToLive: options.workspaceIdleTimeToLive },
    );
  }

  /**
   * A connected handshake clears a prior failure. Otherwise one missed connect
   * stays open in every chat after the server is healthy again. A failed init
   * is not proof that a server which already connected is down.
   */
  private reportMcpConnections(
    servers: OttoSessionResourceInput["mcpServers"],
    manager: McpManager,
    initError?: string,
  ) {
    let statuses: ReturnType<McpManager["getServerStatuses"]> = [];

    try {
      statuses = manager.getServerStatuses();
    } catch {
      statuses = [];
    }

    const byName = new Map(statuses.map((status) => [status.name, status]));

    for (const server of servers) {
      const status = byName.get(String(server.id));

      if (status?.connected) {
        if (initError === undefined) this.options.onMcpServerConnectionSuccess?.(server.id);
        continue;
      }

      if (
        initError === undefined &&
        (status?.connecting || status?.authenticating || status?.disabled)
      ) {
        continue;
      }

      if (!status && initError === undefined) continue;

      const message =
        (status?.error && status.error.length > 0 ? status.error : undefined) ??
        (status?.needsAuth ? "The MCP server needs authentication." : undefined) ??
        initError ??
        "The MCP server failed to connect.";

      this.options.onMcpServerConnectionFailure?.(server.id, message);
    }
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
    const { io } = this.options;
    const directory = io.path.join(this.options.stateDir, "bot-workspaces");
    const workspaceId = input.workspaceId;
    const identityFile = io.path.join(directory, `${workspaceId}.json`);
    this.workspaceIds.set(key, workspaceId);

    try {
      const workspaceLease = await this.workspacePool.acquire(
        input.workspaceResourceKey,
        async () => {
          if (!isRemoteBotSandbox(input.botSandbox) && !(await readIdentity(io, identityFile))) {
            await writeIdentity(io, identityFile, {
              provider: "local",
              scope: input.resourceScope,
            });
          }

          const workspace = await createBotWorkspace({
            io,
            threadId: input.resourceScope,
            workspaceId,
            identityFile,
            legacyIdentityFile: io.path.join(directory, workspaceId, "provider.json"),
            ...(isRemoteBotSandbox(input.botSandbox)
              ? {
                  sandbox: input.botSandbox,
                  ...(input.sandboxEnvironment ? { environment: input.sandboxEnvironment } : {}),
                }
              : {
                  sandbox: "local" as const,
                  sandboxProfileDirectory: io.path.join(this.options.stateDir, "sandbox-profiles"),
                  localRoot: io.path.join(directory, workspaceId),
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
      const record = await readIdentity(io, identityFile);

      if (record) {
        await writeIdentity(io, identityFile, {
          ...record,
          scope: input.resourceScope,
          usedAt: DateTime.formatIso(DateTime.nowUnsafe()),
        });
      }

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
          this.reportMcpConnections(input.mcpServers, manager);
        } catch (cause) {
          const message =
            cause instanceof Error && cause.message.length > 0
              ? cause.message
              : "The MCP server failed to connect.";
          this.reportMcpConnections(input.mcpServers, manager, message);
          throw cause;
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

  /** The bot computer a thread's session holds, while it holds one. */
  computer(threadId: string): OttoBotWorkspace | undefined {
    return this.workspaceLeases.get(threadId)?.workspace;
  }

  /**
   * Wakes the thread's computer if its provider stopped it and pushes back the provider's
   * auto-stop, so a computer stays up while a turn runs and stops on its own after.
   */
  keepComputerAwake(threadId: string): (() => Promise<void>) | undefined {
    return this.workspaceLeases.get(threadId)?.workspace.keepAlive;
  }

  /**
   * After a turn: lets the chat's computer stop soon unless another turn on this same
   * computer is still running.
   */
  idleComputer(
    threadId: string,
    workingThreadIds: Iterable<string>,
  ): (() => Promise<void>) | undefined {
    const workspace = this.workspaceLeases.get(threadId)?.workspace;

    for (const other of workingThreadIds)
      if (other !== threadId && this.workspaceLeases.get(other)?.workspace === workspace)
        return undefined;

    return workspace?.idle;
  }

  async keepComputersAwake(threadIds: Iterable<string>): Promise<void> {
    await Promise.allSettled(
      [...threadIds].map((threadId) => this.keepComputerAwake(threadId)?.()),
    );
  }

  /**
   * Deletes computers no session should use again: a deleted bot's, one a bot left
   * when its sandbox changed, a leftover shared-per-bot computer, a retired
   * provider's identity, and an unclaimed remote a week after it was found.
   */
  async sweepComputers(input: {
    /** Every bot that exists, with the sandbox it uses now. */
    readonly sandboxes: ReadonlyMap<string, BotSandbox>;
    readonly environment: (provider: RemoteBotSandbox) => Readonly<Record<string, string>>;
    readonly now: number;
  }): Promise<readonly BotComputerSweepResult[]> {
    const { io } = this.options;
    const directory = io.path.join(this.options.stateDir, "bot-workspaces");
    const entries = await io.list(directory);
    const records = new Map<string, BotWorkspaceRecord>();

    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const record = await readIdentity(io, io.path.join(directory, name)).catch(() => undefined);

      if (record) records.set(name.slice(0, -".json".length), record);
    }

    // Records from before they moved out of the computer's folder; a folder holding anything
    // else is a Local computer's files.
    for (const name of entries) {
      if (name.endsWith(".json") || records.has(name)) continue;
      const files = await io.list(io.path.join(directory, name)).catch(() => []);

      if (files.length !== 1 || files[0] !== "provider.json") continue;

      const record = await readIdentity(io, io.path.join(directory, name, "provider.json")).catch(
        () => undefined,
      );

      if (record && record.provider !== "local") records.set(name, record);
    }

    const inUse = new Set(this.workspaceIds.values());
    const results: BotComputerSweepResult[] = [];

    for (const [id, record] of records) {
      if (inUse.has(id)) continue;
      let reason: BotComputerSweepResult["reason"] | undefined;
      const owner = botIdFromResourceScope(record.scope, input.sandboxes.keys());
      const supported = record.provider === "local" || record.provider === "boat";

      if (!supported) reason = "sandbox_changed";
      else if (owner) {
        const sandbox = input.sandboxes.get(owner);

        if (sandbox === undefined) reason = "bot_deleted";
        else if (sandbox !== record.provider) reason = "sandbox_changed";
        else if (isLegacyBotComputerScope(record.scope, owner)) reason = "replaced";
      } else if (!record.scope && record.provider !== "local") {
        const claimed = {
          ...record,
          orphanedAt: record.orphanedAt ?? DateTime.formatIso(DateTime.makeUnsafe(input.now)),
        };

        if (!record.orphanedAt) {
          await writeIdentity(io, io.path.join(directory, `${id}.json`), claimed);
          await io.remove(io.path.join(directory, id), true);
        } else if (input.now - Date.parse(record.orphanedAt) >= ORPHAN_GRACE_MS) {
          reason = "orphan";
        }
      } else if (record.scope && !record.scope.startsWith("thread-") && !owner) {
        reason = "bot_deleted";
      }

      if (!reason) continue;

      const result = {
        workspaceId: id,
        provider: record.provider,
        ...(record.providerId ? { providerId: record.providerId } : {}),
        reason,
      };

      try {
        if (record.provider === "boat") {
          await destroyRemoteComputer({
            provider: "boat",
            workspaceId: id,
            record,
            environment: input.environment("boat"),
          });
        }

        await io.remove(io.path.join(directory, id), true);
        await io.remove(io.path.join(directory, `${id}.json`));
        results.push(result);
      } catch (cause) {
        results.push({ ...result, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }

    return results;
  }

  async release(threadId: string): Promise<void> {
    await this.acquisitions.get(threadId)?.catch(() => undefined);
    await this.releaseOnce(threadId);
  }

  private async releaseOnce(threadId: string): Promise<void> {
    const failures: unknown[] = [];
    const manager = this.mcpManagers.get(threadId);
    this.mcpManagers.delete(threadId);

    if (manager) await manager.disconnect().catch((cause) => failures.push(cause));

    const workspaceLease = this.workspaceLeases.get(threadId);
    this.workspaceLeases.delete(threadId);
    this.workspaceIds.delete(threadId);

    if (workspaceLease) {
      await workspaceLease.release().catch((cause) => failures.push(cause));
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
      await this.workspacePool.shutdown();
    } catch (cause) {
      failures.push(cause);
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
