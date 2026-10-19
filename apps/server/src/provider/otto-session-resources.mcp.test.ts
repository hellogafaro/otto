import { workspaceIO } from "./test-support/workspace-io.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { OttoSessionResources } from "./otto-session-resources.ts";
import {
  botWorkspaceCredentialFingerprint,
  botWorkspaceIdentity,
  botWorkspaceResourceKey,
} from "./bot-workspace-pool.ts";
import {
  type OttoBotWorkspace,
  type OttoRemoteSession,
  createRemoteBotWorkspace,
} from "./bot-workspace.ts";
import { makeOttoSessionResourcesTestSupport } from "./test-support/otto-session-resources.ts";

const { directories, stateDir, workspace, localBotWorkspace, mcpManager, remoteInput, exaServer } =
  makeOttoSessionResourcesTestSupport();

describe("OttoSessionResources", () => {
  afterEach(() => {
    for (const directory of directories) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }

    directories.clear();
  });

  it("preserves the Boat workspace when MCP initialization fails", async () => {
    const remote: OttoBotWorkspace = { ...localBotWorkspace(workspace()), provider: "boat" };
    const destroy = vi.spyOn(remote, "destroy");
    const sleep = vi.spyOn(remote, "sleep");
    const manager = mcpManager({ connected: true, toolCount: 1 });
    manager.init.mockRejectedValueOnce(new Error("connector failed"));

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => remote,
      makeMcpManager: () => manager as never,
      toMcpServerConfigs: () => ({}),
    });

    await expect(
      resources.acquire({
        ...remoteInput,
        botSandbox: "boat",
        threadId: "boat-init-failure",
        mcpServers: [exaServer],
      }),
    ).rejects.toThrow("connector failed");
    expect(destroy).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledOnce();
    expect(manager.disconnect).toHaveBeenCalledOnce();

    const recovered = await resources.acquire({
      ...remoteInput,
      botSandbox: "boat",
      threadId: "boat-init-failure",
      mcpServers: [exaServer],
    });

    expect(recovered.botWorkspace).toBe(remote.workspace);
    await resources.shutdown();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("reports MCP connection failures at the resource boundary", async () => {
    const onMcpServerConnectionFailure = vi.fn();

    const manager = {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({})),
      getServerStatuses: vi.fn(() => [{ name: String(exaServer.id), connected: false }]),
    };

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => workspace(),
      makeMcpManager: () => manager as never,
      onMcpServerConnectionFailure,
      toMcpServerConfigs: () => ({}),
    });

    await resources.acquire({ ...remoteInput, threadId: "mcp-failure", mcpServers: [exaServer] });
    expect(onMcpServerConnectionFailure).toHaveBeenCalledExactlyOnceWith(exaServer.id);
    await resources.shutdown();
  });

  it("reports every configured MCP server when manager initialization fails", async () => {
    const onMcpServerConnectionFailure = vi.fn();

    const manager = {
      init: vi.fn(async () => Promise.reject(new Error("MCP init failed"))),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({})),
      getServerStatuses: vi.fn(() => []),
    };

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => workspace(),
      makeMcpManager: () => manager as never,
      onMcpServerConnectionFailure,
      toMcpServerConfigs: () => ({}),
    });

    await expect(
      resources.acquire({ ...remoteInput, threadId: "mcp-init-failure", mcpServers: [exaServer] }),
    ).rejects.toThrow("MCP init failed");
    expect(onMcpServerConnectionFailure).toHaveBeenCalledExactlyOnceWith(exaServer.id);
    await resources.shutdown();
  });

  it("keeps the Boat VM when MCP setup fails after reconnect", async () => {
    const directory = stateDir();
    const destroy = vi.fn(async () => undefined);

    const openSession = vi.fn(
      async (providerId?: string): Promise<OttoRemoteSession> => ({
        providerId: providerId ?? "boat-vm",
        inspect: async () => "running",
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        wake: async () => undefined,
        sleep: async () => undefined,
        destroy,
      }),
    );

    const makeRemoteWorkspace = vi.fn((input: Parameters<typeof createRemoteBotWorkspace>[0]) =>
      createRemoteBotWorkspace({ ...input, openSession }),
    );

    const failedManager = mcpManager({ connected: true, toolCount: 0 });
    failedManager.init.mockRejectedValueOnce(new Error("MCP init failed after reconnect"));

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: directory,
      makeRemoteWorkspace,
      makeMcpManager: () => failedManager as never,
      toMcpServerConfigs: () => ({}),
    });

    const sandboxEnvironment = { BOAT_API_KEY: "token" };

    const workspaceResourceKey = botWorkspaceResourceKey({
      sandbox: "boat",
      resourceScope: "bot-one_thread-one",
      credentialFingerprint: botWorkspaceCredentialFingerprint(sandboxEnvironment),
    });

    const input = (threadId: string) => ({
      ...remoteInput,
      botSandbox: "boat" as const,
      sandboxEnvironment,
      threadId,
      resourceScope: "bot-one_thread-one",
      workspaceResourceKey,
      workspaceId: botWorkspaceIdentity(workspaceResourceKey),
      mcpServers: [],
    });

    const first = input("first-turn");
    await resources.acquire(first);
    expect(openSession).toHaveBeenNthCalledWith(1, undefined);
    await resources.shutdown();

    const identityFile = NodePath.join(directory, "bot-workspaces", `${first.workspaceId}.json`);
    const { providerId } = JSON.parse(NodeFS.readFileSync(identityFile, "utf8"));

    const reconnecting = new OttoSessionResources({
      io: workspaceIO,
      stateDir: directory,
      makeRemoteWorkspace,
      makeMcpManager: () => failedManager as never,
      toMcpServerConfigs: () => ({}),
    });

    await expect(
      reconnecting.acquire({ ...input("failed-turn"), mcpServers: [exaServer] }),
    ).rejects.toThrow("MCP init failed after reconnect");
    expect(openSession).toHaveBeenNthCalledWith(2, "boat-vm");
    expect(destroy).not.toHaveBeenCalled();
    expect(JSON.parse(NodeFS.readFileSync(identityFile, "utf8"))).toMatchObject({ providerId });
    await reconnecting.shutdown();

    const restarted = new OttoSessionResources({
      io: workspaceIO,
      stateDir: directory,
      makeRemoteWorkspace,
      toMcpServerConfigs: () => ({}),
    });

    openSession.mockRejectedValueOnce(new Error("credentials revoked"));
    await expect(restarted.acquire(input("revoked-turn"))).rejects.toThrow("is unavailable");
    expect(openSession).toHaveBeenLastCalledWith("boat-vm");
    expect(JSON.parse(NodeFS.readFileSync(identityFile, "utf8"))).toMatchObject({ providerId });
    expect(destroy).not.toHaveBeenCalled();
    await restarted.shutdown();
  });
});
