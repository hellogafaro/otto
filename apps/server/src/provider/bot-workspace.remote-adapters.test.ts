import { workspaceIO } from "./test-support/workspace-io.ts";
import { partialSdkFixture } from "./test-support/partial-sdk-fixture.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import type { DaytonaSandbox } from "@mastra/daytona";
import type { RailwaySandbox } from "@mastra/railway";
import {
  createRemoteBotWorkspace,
  daytona,
  railway,
  railwayWorkspaceState,
  vercelWorkspaceState,
} from "./bot-workspace.ts";
import { railwayCredentials as railwayCredentialsFor } from "./workspace/adapters/railway.ts";

const railwayCredentials = { token: "token", environmentId: "env", authType: "bearer" as const };

const railwayTokenProbe = (projectToken: { readonly environmentId: string } | null) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ data: { projectToken } }));

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
    const probe = railwayTokenProbe(null);

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
      await expect(createRemoteBotWorkspace(input)).rejects.toThrow("is unavailable");
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
      probe.mockRestore();
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("sends Railway project tokens in their own header", async () => {
    const probe = railwayTokenProbe({ environmentId: "env" });

    try {
      await expect(
        railwayCredentialsFor({ RAILWAY_API_TOKEN: "token", RAILWAY_ENVIRONMENT_ID: "env" }),
      ).resolves.toEqual({ ...railwayCredentials, authType: "project-token" });
      expect(probe.mock.calls[0]?.[1]?.headers).toMatchObject({ "project-access-token": "token" });
      probe.mockImplementation(async () =>
        Response.json({ errors: [{ message: "Not Authorized" }], data: null }),
      );
      await expect(
        railwayCredentialsFor({ RAILWAY_API_TOKEN: "token", RAILWAY_ENVIRONMENT_ID: "env" }),
      ).resolves.toEqual(railwayCredentials);
    } finally {
      probe.mockRestore();
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
    expect(await session.inspect()).toBe("running");
  });

  it("does not classify unavailable provider states as running", () => {
    expect(vercelWorkspaceState("failed")).toBe("missing");
    expect(vercelWorkspaceState("aborted")).toBe("missing");
    expect(vercelWorkspaceState("stopped")).toBe("sleeping");
  });
});
