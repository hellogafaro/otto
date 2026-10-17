import { workspaceIO } from "./test-support/workspace-io.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { OttoSessionResources } from "./otto-session-resources.ts";
import { type OttoRemoteSession, createRemoteBotWorkspace } from "./bot-workspace.ts";
import { makeOttoSessionResourcesTestSupport } from "./test-support/otto-session-resources.ts";

const { directories, stateDir, workspace, localBotWorkspace, remoteInput } =
  makeOttoSessionResourcesTestSupport();

describe("OttoSessionResources", () => {
  afterEach(() => {
    for (const directory of directories) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }

    directories.clear();
  });

  it("retries failed workspace sleeps after releasing sessions during shutdown", async () => {
    const remote = workspace();

    const botWorkspace = {
      ...localBotWorkspace(remote),
      provider: "vercel" as const,
      sleep: vi
        .fn()
        .mockRejectedValueOnce(new Error("pause unavailable"))
        .mockResolvedValue(undefined),
    };

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => botWorkspace,
      toMcpServerConfigs: () => ({}),
    });

    await resources.acquire({ ...remoteInput, threadId: "shutdown-retry" });
    await expect(resources.shutdown()).rejects.toThrow("pause unavailable");
    expect(botWorkspace.sleep).toHaveBeenCalledTimes(2);
    await resources.retryFailedWorkspaceSleeps();
  });

  it("retries a failed workspace sleep with no active session", async () => {
    const remote = workspace();

    const botWorkspace = {
      ...localBotWorkspace(remote),
      provider: "vercel" as const,
      sleep: vi
        .fn()
        .mockRejectedValueOnce(new Error("pause unavailable"))
        .mockResolvedValue(undefined),
    };

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => botWorkspace,
      toMcpServerConfigs: () => ({}),
    });

    await resources.acquire({ ...remoteInput, threadId: "idle-retry" });
    await expect(resources.release("idle-retry")).rejects.toThrow("pause unavailable");
    await resources.retryFailedWorkspaceSleeps();
    expect(botWorkspace.sleep).toHaveBeenCalledTimes(2);
    await resources.shutdown();
  });

  it("keeps a released computer awake for the idle time and sleeps it at shutdown", async () => {
    const botWorkspace = {
      ...localBotWorkspace(workspace()),
      provider: "vercel" as const,
      sleep: vi.fn(async () => undefined),
    };

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => botWorkspace,
      toMcpServerConfigs: () => ({}),
      workspaceIdleTimeToLive: "1 hour",
    });

    await resources.acquire({ ...remoteInput, threadId: "first-turn" });
    await resources.release("first-turn");
    await resources.acquire({ ...remoteInput, threadId: "next-turn" });
    await resources.release("next-turn");
    expect(botWorkspace.sleep).not.toHaveBeenCalled();
    await resources.shutdown();
    expect(botWorkspace.sleep).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent acquisition for the same thread", async () => {
    const remote = workspace();
    const stop = vi.spyOn(remote, "stop");
    let finishCreate!: () => void;
    const created = new Promise<void>((resolve) => (finishCreate = resolve));

    const makeRemoteWorkspace = vi.fn(async () => {
      await created;

      return remote;
    });

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace,
      toMcpServerConfigs: () => ({}),
    });

    const first = resources.acquire({ ...remoteInput, threadId: "same-thread" });
    const second = resources.acquire({ ...remoteInput, threadId: "same-thread" });
    finishCreate();
    const [firstView, secondView] = await Promise.all([first, second]);
    expect(firstView).toBe(secondView);
    expect(makeRemoteWorkspace).toHaveBeenCalledOnce();
    await resources.release("same-thread");
    expect(stop).toHaveBeenCalledOnce();
    await resources.shutdown();
  });

  it("exposes the authenticated Otto MCP tools without a plugin connection", async () => {
    const memoryUpdate = { execute: vi.fn(async () => ({ saved: true })) };

    const manager = {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({
        otto_memory_update: memoryUpdate,
      })),
      getServerStatuses: vi.fn(() => [
        {
          name: "otto",
          connected: true,
          toolCount: 1,
          toolNames: ["otto_memory_update"],
        },
      ]),
    };

    const makeMcpManager = vi.fn(
      (
        _projectDir: string,
        _configDirName?: string,
        _servers?: Parameters<
          NonNullable<
            import("./otto-session-resources.ts").OttoSessionResourcesOptions["makeMcpManager"]
          >
        >[2],
      ) => manager as never,
    );

    const getPreviewMcpServerConfig = vi.fn(() => ({
      url: "http://127.0.0.1:4000/mcp",
      headers: { Authorization: "Bearer preview-token" },
    }));

    const resources = new OttoSessionResources({
      io: workspaceIO,
      stateDir: stateDir(),
      makeRemoteWorkspace: async () => workspace(),
      makeMcpManager,
      getPreviewMcpServerConfig,
      toMcpServerConfigs: () => ({}),
    });

    await resources.acquire({ ...remoteInput, threadId: "preview-thread" });

    expect(getPreviewMcpServerConfig).toHaveBeenCalledExactlyOnceWith("preview-thread");
    expect(makeMcpManager).toHaveBeenCalledOnce();
    expect(makeMcpManager.mock.calls[0]?.[2]).toEqual({
      otto: {
        url: "http://127.0.0.1:4000/mcp",
        headers: { Authorization: "Bearer preview-token" },
      },
    });
    expect(resources.getConnectorTools("preview-thread")).toEqual({
      memory_update: memoryUpdate,
    });

    await resources.shutdown();
  });

  it("reattaches a durable remote workspace after shutdown", async () => {
    const directory = stateDir();
    const sleep = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => undefined);

    const openSession = vi.fn(
      async (providerId?: string): Promise<OttoRemoteSession> => ({
        providerId: providerId ?? "provider-1",
        inspect: async () => "running",
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        wake: async () => undefined,
        sleep,
        destroy,
      }),
    );

    const options = {
      io: workspaceIO,
      stateDir: directory,
      makeRemoteWorkspace: (input: Parameters<typeof createRemoteBotWorkspace>[0]) =>
        createRemoteBotWorkspace({ ...input, openSession }),
      toMcpServerConfigs: () => ({}),
    };

    const first = new OttoSessionResources(options);
    await first.acquire({ ...remoteInput, threadId: "before-restart" });
    await first.shutdown();

    expect(sleep).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();

    const identityFile = NodePath.join(
      directory,
      "bot-workspaces",
      `${remoteInput.workspaceId}.json`,
    );

    expect(NodeFS.existsSync(identityFile)).toBe(true);

    const second = new OttoSessionResources(options);
    await second.acquire({ ...remoteInput, threadId: "after-restart" });
    expect(openSession).toHaveBeenNthCalledWith(2, "provider-1");
    await second.release("after-restart");
    expect(destroy).not.toHaveBeenCalled();
    expect(NodeFS.existsSync(identityFile)).toBe(true);
  });
});
