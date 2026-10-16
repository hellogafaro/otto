import { workspaceIO } from "./test-support/workspace-io.ts";
import { partialSdkFixture } from "./test-support/partial-sdk-fixture.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import type { DaytonaSandbox } from "@mastra/daytona";
import type { E2BSandbox } from "@mastra/e2b";
import type { RailwaySandbox } from "@mastra/railway";
import type { VercelSandbox } from "@mastra/vercel";
import {
  createRemoteBotWorkspace,
  daytona,
  e2b,
  railway,
  railwayWorkspaceState,
  vercel,
  vercelWorkspaceState,
} from "./bot-workspace.ts";

const railwayCredentials = { token: "token", environmentId: "env" };

describe("createBotWorkspace", () => {
  it("creates and reattaches Railway identities with explicit credentials and cleans up", async () => {
    const { Sandbox } = await import("railway");
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-railway-"));
    const identityFile = NodePath.join(baseDir, "identity.json");
    const destroy = vi.fn(async () => undefined);

    const sandbox = partialSdkFixture<import("railway").Sandbox>({
      id: "railway-id",
      status: "RUNNING",
      createdAt: "2026-01-01T00:00:00.000Z",
      destroy,
    });

    const create = vi.spyOn(Sandbox, "create").mockResolvedValue(sandbox);
    const connect = vi.spyOn(Sandbox, "connect").mockResolvedValue(sandbox);

    const input = {
      io: workspaceIO,
      threadId: "railway-thread",
      workspaceId: "otto-railway",
      identityFile,
      sandbox: "railway" as const,
      environment: { RAILWAY_API_TOKEN: " token ", RAILWAY_ENVIRONMENT_ID: " env " },
    };

    try {
      const first = await createRemoteBotWorkspace(input);
      await first.wake();
      await first.sleep();
      expect(destroy).not.toHaveBeenCalled();
      const second = await createRemoteBotWorkspace(input);
      expect(second.providerId).toBe("railway-id");
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]?.[0]).toMatchObject(railwayCredentials);
      expect(connect).toHaveBeenCalledWith("railway-id", railwayCredentials);
      connect.mockRejectedValueOnce(new Error("unavailable"));
      await expect(createRemoteBotWorkspace(input)).rejects.toThrow("missing or unavailable");
      expect(create).toHaveBeenCalledTimes(1);
      await second.wake();
      await second.destroy();
      expect(destroy).toHaveBeenCalledOnce();
      expect(NodeFS.existsSync(identityFile)).toBe(false);

      for (const environment of [{}, { RAILWAY_API_TOKEN: "token" }]) {
        await expect(createRemoteBotWorkspace({ ...input, environment })).rejects.toThrow(
          "Remote sandbox credential",
        );
      }

      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      create.mockRestore();
      connect.mockRestore();
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("executes Railway commands through Mastra and refuses automatic browser ingress", async () => {
    const { Sandbox, SandboxNotFoundError } = await import("railway");

    const executeCommand = vi.fn(async () => ({
      success: false,
      exitCode: 7,
      stdout: "output",
      stderr: "error",
      executionTimeMs: 1,
    }));

    const remote = { status: "RUNNING" as import("railway").SandboxStatus };

    const connect = vi
      .spyOn(Sandbox, "connect")
      .mockImplementation(async () => partialSdkFixture<import("railway").Sandbox>(remote));

    const session = railway(
      partialSdkFixture<RailwaySandbox>({
        id: "otto-railway",
        sandboxId: "railway-id",
        executeCommand,
      }),
      railwayCredentials,
    );

    try {
      expect(
        await session.run("echo", ["it's private"], {
          cwd: "/tmp",
          env: { HELLO: "world" },
          timeout: 1501,
        }),
      ).toMatchObject({ exitCode: 7, stdout: "output", stderr: "error" });
      expect(executeCommand).toHaveBeenCalledWith("echo", ["it's private"], {
        cwd: "/tmp",
        env: { HELLO: "world" },
        timeout: 1501,
        maxRetainedBytes: 16 * 1024 * 1024,
      });
      await expect(session.browserEndpoint(9223)).rejects.toThrow("Railway CLI tunnel");
      await expect(session.inspect()).resolves.toBe("running");
      await session.sleep();
      remote.status = "DESTROYED";
      await expect(session.wake()).rejects.toThrow("not running");
      connect.mockRejectedValueOnce(
        new SandboxNotFoundError({ id: "railway-id", environmentId: "env" }),
      );
      await expect(session.inspect()).resolves.toBe("missing");
      connect.mockRejectedValueOnce(new Error("unauthorized"));
      await expect(session.inspect()).rejects.toThrow("unauthorized");
    } finally {
      connect.mockRestore();
    }

    expect(railwayWorkspaceState("CREATING")).toBe("sleeping");

    for (const status of ["DESTROYING", "DESTROYED", "FAILED"] as const) {
      expect(railwayWorkspaceState(status)).toBe("missing");
    }
  });

  it("stops and restarts Daytona workspaces through Mastra", async () => {
    let status: DaytonaSandbox["status"] = "running";

    const _stop = vi.fn(async () => {
      status = "stopped";
    });

    const _start = vi.fn(async () => {
      status = "running";
    });

    const instance = partialSdkFixture<DaytonaSandbox["instance"]>({
      id: "daytona-id",
      state: "started" as NonNullable<DaytonaSandbox["instance"]["state"]>,
      refreshData: vi.fn(async () => undefined),
      getPreviewLink: vi.fn(async () => ({
        url: "https://9223-daytona.example",
        token: "daytona-token",
      })),
    });

    const session = daytona(
      partialSdkFixture<DaytonaSandbox>({
        get status() {
          return status;
        },
        instance,
        _start,
        _stop,
      }),
    );

    await session.sleep();
    expect(await session.inspect()).toBe("sleeping");
    await session.wake();

    expect(_stop).toHaveBeenCalledOnce();
    expect(_start).toHaveBeenCalledOnce();
    expect(session.providerId).toBe("daytona-id");
    expect(session.computer?.workspaceId).toBe("daytona-id");
    expect(await session.inspect()).toBe("running");
    await expect(session.browserEndpoint(9223)).resolves.toEqual({
      url: "https://9223-daytona.example/?DAYTONA_SANDBOX_AUTH_KEY=daytona-token",
      requestHeaders: {},
    });
  });

  it("keeps E2B browser ingress private", async () => {
    const session = e2b(
      partialSdkFixture<E2BSandbox>({
        sandboxId: "e2b-id",
        instance: {
          trafficAccessToken: "e2b-token",
          getHost: (port: number) => `${port}-e2b.example`,
        },
      }),
      "e2b-key",
    );

    expect(session.providerId).toBe("e2b-id");
    await expect(session.browserEndpoint(9223)).resolves.toEqual({
      url: "https://9223-e2b.example",
      requestHeaders: { "e2b-traffic-access-token": "e2b-token" },
    });
  });

  it("adds the Vercel browser port without removing existing routes", async () => {
    const update = vi.fn(async () => undefined);

    const session = vercel(
      partialSdkFixture<VercelSandbox>({
        sandbox: {
          name: "vercel-id",
          routes: [{ port: 3000 }],
          update,
          domain: (port: number) => `https://${port}-vercel.example`,
        },
      }),
      { token: "token", teamId: "team", projectId: "project" },
    );

    expect(session.providerId).toBe("vercel-id");
    await expect(session.browserEndpoint(9223)).resolves.toEqual({
      url: "https://9223-vercel.example",
      requestHeaders: {},
    });
    expect(update).toHaveBeenCalledWith({ ports: [3000, 9223] });
  });

  it("fails closed when a remote provider omits browser credentials", async () => {
    const e2bSession = e2b(
      partialSdkFixture<E2BSandbox>({
        sandboxId: "e2b-id",
        instance: { trafficAccessToken: "", getHost: vi.fn() },
      }),
      "e2b-key",
    );

    const daytonaSession = daytona(
      partialSdkFixture<DaytonaSandbox>({
        instance: {
          id: "daytona-id",
          getPreviewLink: vi.fn(async () => ({ url: "https://daytona.example", token: "" })),
        },
      }),
    );

    await expect(e2bSession.browserEndpoint(9223)).rejects.toThrow("no traffic access token");
    await expect(daytonaSession.browserEndpoint(9223)).rejects.toThrow(
      "no authenticated preview URL",
    );
  });

  it("does not classify unavailable provider states as running", () => {
    expect(vercelWorkspaceState("failed")).toBe("missing");
    expect(vercelWorkspaceState("aborted")).toBe("missing");
    expect(vercelWorkspaceState("stopped")).toBe("sleeping");
  });
});
