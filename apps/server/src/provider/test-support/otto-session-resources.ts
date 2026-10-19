import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { McpServerId } from "@otto/contracts";
import { vi } from "vite-plus/test";
import { type OttoBotWorkspace } from "../bot-workspace.ts";

export function makeOttoSessionResourcesTestSupport() {
  const directories = new Set<string>();

  function stateDir() {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-resources-"));
    directories.add(directory);

    return directory;
  }

  function workspace() {
    return new Workspace({
      filesystem: new LocalFilesystem({ basePath: process.cwd() }),
      sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
    });
  }

  function localBotWorkspace(value: Workspace): OttoBotWorkspace {
    return {
      id: value.id,
      provider: "local",
      workspace: value,
      inspect: async () => "running",
      wake: () => value.init(),
      sleep: () => value.stop(),
      destroy: () => value.destroy(),
    };
  }

  function mcpManager(
    status: { connected: boolean; toolCount: number; error?: string },
    tools: Record<string, Pick<import("@mastra/core/tools").Tool, "execute">> = {},
  ) {
    return {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => tools),
      getServerStatuses: vi.fn(() => [
        {
          name: "builtin-exa",
          transport: "url" as const,
          toolNames: status.toolCount > 0 ? ["builtin-exa_search"] : [],
          ...status,
        },
      ]),
    };
  }

  const remoteInput = {
    resourceScope: "shared",
    workspaceResourceKey: "boat:shared",
    workspaceId: "otto-shared",
    botSandbox: "boat" as const,
    mcpServers: [],
  };

  const exaServer = {
    id: McpServerId.make("builtin-exa"),
    name: "Exa",
    transport: "url" as const,
    url: "https://mcp.exa.ai/mcp",
    enabled: true,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };

  return {
    directories,
    stateDir,
    workspace,
    localBotWorkspace,
    mcpManager,
    remoteInput,
    exaServer,
  };
}
