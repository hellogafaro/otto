import { workspaceIO } from "./test-support/workspace-io.ts";
import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { assert, expect, it, vi } from "vite-plus/test";
import {
  createBotWorkspace,
  createRemoteBotWorkspace,
  isRemoteBotSandbox,
} from "./bot-workspace.ts";
import { makebotWorkspaceTestSupport } from "./test-support/bot-workspace.ts";

const { remoteSession, deleted, setup } = makebotWorkspaceTestSupport();

describe("Boat", () => {
  it("waits for pending VM deletion to complete", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });

    try {
      const { client, session } = await setup();

      const pending = {
        ...deleted,
        operation: { ...deleted.operation, status: "pending" as const },
      };

      vi.spyOn(client, "deleteSandbox").mockResolvedValue(pending);

      const poll = vi
        .spyOn(client, "getDeletionOperation")
        .mockResolvedValueOnce(pending)
        .mockResolvedValue(deleted);

      let complete = false;

      const operation = session.destroy().then(() => {
        complete = true;
      });

      await vi.advanceTimersByTimeAsync(2_000);
      expect(complete).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      await operation;
      expect(poll).toHaveBeenCalledWith({ operationId: "deletion" });
      expect(complete).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds pending deletion waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });

    try {
      const { client, session } = await setup();

      const pending = {
        ...deleted,
        operation: { ...deleted.operation, status: "pending" as const },
      };

      vi.spyOn(client, "deleteSandbox").mockResolvedValue(pending);
      vi.spyOn(client, "getDeletionOperation").mockResolvedValue(pending);
      const failure = expect(session.destroy()).rejects.toThrow("deletion timed out");
      await vi.advanceTimersByTimeAsync(300_000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops with a native snapshot, resumes, and deletes with confirmation", async () => {
    const { client, get, session } = await setup();

    const stop = vi
      .spyOn(client, "stop")
      .mockResolvedValue({ ok: true, type: "sandbox.stopped", id: "boat-id", status: "archived" });

    const resume = vi
      .spyOn(client, "resume")
      .mockResolvedValue({ ok: true, type: "sandbox.resumed", id: "boat-id", status: "ready" });

    const remove = vi.spyOn(client, "deleteSandbox").mockResolvedValue(deleted);
    const current = await client.get({ sandboxId: "boat-id" });
    get.mockResolvedValueOnce({ ...current, sandbox: { ...current.sandbox, state: "archived" } });
    await session.sleep();
    expect(stop).toHaveBeenCalledWith({ sandboxId: "boat-id" });
    get.mockResolvedValueOnce({ ...current, sandbox: { ...current.sandbox, state: "archived" } });
    await session.wake();
    expect(resume).toHaveBeenCalledWith({
      sandboxId: "boat-id",
      resumeRequest: { ttlSeconds: null },
    });
    expect(await session.inspect()).toBe("running");
    await session.destroy();
    expect(remove).toHaveBeenCalledWith({ sandboxId: "boat-id", xAsciiConfirmDelete: "boat-id" });
  });

  it.each(["sleep", "wake"] as const)(
    "waits for native snapshot completion during %s",
    async (action) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });

      try {
        const { client, get, session } = await setup();
        const current = await client.get({ sandboxId: "boat-id" });

        const archiving = {
          ...current,
          sandbox: { ...current.sandbox, state: "archiving" as const },
        };

        const archived = {
          ...current,
          sandbox: { ...current.sandbox, state: "archived" as const },
        };

        const stop = vi.spyOn(client, "stop").mockResolvedValue({
          ok: true,
          type: "sandbox.stopped",
          id: "boat-id",
          status: "archiving",
        });

        const resume = vi
          .spyOn(client, "resume")
          .mockResolvedValue({ ok: true, type: "sandbox.resumed", id: "boat-id", status: "ready" });

        if (action === "wake") get.mockResolvedValueOnce(archiving);
        get.mockResolvedValueOnce(archiving).mockResolvedValueOnce(archived);
        let completed = false;

        const operation = session[action]().then(() => {
          completed = true;
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(completed).toBe(false);
        expect(resume).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2_000);
        await operation;

        if (action === "wake")
          expect(resume).toHaveBeenCalledWith({
            sandboxId: "boat-id",
            resumeRequest: { ttlSeconds: null },
          });
        else expect(stop).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("surfaces snapshot errors without force-stopping or deleting the VM", async () => {
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    get.mockResolvedValue({ ...current, sandbox: { ...current.sandbox, state: "error" } });

    const stop = vi
      .spyOn(client, "stop")
      .mockResolvedValue({ ok: true, type: "sandbox.stopped", id: "boat-id", status: "archiving" });

    const remove = vi.spyOn(client, "deleteSandbox");
    await expect(session.sleep()).rejects.toThrow("snapshot archival failed");
    expect(stop).toHaveBeenCalledWith({ sandboxId: "boat-id" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("stops archival polling when a later response reports an error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });

    try {
      const { client, get, session } = await setup();
      const current = await client.get({ sandboxId: "boat-id" });
      get
        .mockResolvedValueOnce({ ...current, sandbox: { ...current.sandbox, state: "archiving" } })
        .mockResolvedValue({ ...current, sandbox: { ...current.sandbox, state: "error" } });
      vi.spyOn(client, "stop").mockResolvedValue({
        ok: true,
        type: "sandbox.stopped",
        id: "boat-id",
        status: "archiving",
      });
      const failure = expect(session.sleep()).rejects.toThrow("snapshot archival failed");
      await vi.advanceTimersByTimeAsync(2_000);
      await failure;
      expect(get).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds snapshot waits without deleting the VM", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });

    try {
      const { client, get, session } = await setup();
      const current = await client.get({ sandboxId: "boat-id" });
      get.mockResolvedValue({ ...current, sandbox: { ...current.sandbox, state: "archiving" } });
      const resume = vi.spyOn(client, "resume");
      const remove = vi.spyOn(client, "deleteSandbox");
      const failure = expect(session.wake()).rejects.toThrow("snapshot archival timed out");
      await vi.advanceTimersByTimeAsync(300_000);
      await failure;
      expect(resume).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "init",
    "provisioning",
    "provisioned",
    "cloning",
    "archiving",
    "archived",
    "error",
  ] as const)("does not report %s VMs as running", async (state) => {
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    get.mockResolvedValue({ ...current, sandbox: { ...current.sandbox, state } });
    expect(await session.inspect()).toBe(state === "error" ? "missing" : "sleeping");
  });

  it("distinguishes missing VMs from credential or transport errors", async () => {
    const { ResponseError } = await import("@boatdev/sdk");
    const { get, session } = await setup();
    get.mockRejectedValue(new ResponseError(new Response(null, { status: 404 })));
    expect(await session.inspect()).toBe("missing");
    get.mockRejectedValue(new Error("unauthorized"));
    await expect(session.inspect()).rejects.toThrow("unauthorized");
  });

  it("quotes commands, absolute working directories and environment values", async () => {
    const { client, session } = await setup();

    const command = vi.spyOn(client, "command").mockResolvedValue({
      ok: true,
      type: "command.finished",
      success: false,
      exitCode: 7,
      stdout: "out",
      stderr: "err",
      timedOut: false,
    });

    expect(
      await session.run("printf", ["a'b"], {
        cwd: "/workspace/my files",
        env: { VALUE: "x; echo unsafe" },
        timeout: 1501,
      }),
    ).toEqual({ exitCode: 7, stdout: "out", stderr: "err" });
    expect(command).toHaveBeenCalledWith({
      sandboxId: "boat-id",
      commandRequest: {
        command: "cd '/workspace/my files' && env 'VALUE=x; echo unsafe' 'printf' 'a'\\''b'",
        timeoutSeconds: 2,
      },
    });
    command.mockResolvedValue({
      ok: true,
      type: "command.finished",
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    });
    expect((await session.run("sleep", ["2"])).exitCode).toBe(124);
    expect(command).toHaveBeenLastCalledWith({
      sandboxId: "boat-id",
      commandRequest: { command: "'sleep' '2'", timeoutSeconds: 600 },
    });
    await session.run("sleep", ["2"], { timeout: 600_000 });
    expect(command).toHaveBeenLastCalledWith({
      sandboxId: "boat-id",
      commandRequest: { command: "'sleep' '2'", timeoutSeconds: 600 },
    });
  });

  it.each([900_000, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsupported command timeout %s before executing",
    async (timeout) => {
      const { client, session } = await setup();
      const command = vi.spyOn(client, "command");

      await expect(session.run("sleep", ["900"], { timeout })).rejects.toThrow(
        "Boat command timeout must be greater than 0 and at most 600000 ms.",
      );
      expect(command).not.toHaveBeenCalled();
    },
  );

  it("bounds readiness polling without deleting the VM", async () => {
    const { client, get, session } = await setup();
    const current = await client.get({ sandboxId: "boat-id" });
    get.mockResolvedValue({ ...current, sandbox: { ...current.sandbox, state: "provisioning" } });
    const deleteSandbox = vi.spyOn(client, "deleteSandbox");
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(300_001);

    try {
      await expect(session.wake()).rejects.toThrow("Timed out waiting for sandbox state");
      expect(deleteSandbox).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("protects browser control without forwarding the API credential", async () => {
    const { client, session } = await setup();

    const hostPort = vi.spyOn(client, "hostPort").mockResolvedValue({
      ok: true,
      type: "host_port",
      url: "https://preview.example/?_token=browser-token",
      isProtected: true,
    });

    expect(await session.browserEndpoint(9223)).toEqual({
      url: "https://preview.example/?_token=browser-token",
      requestHeaders: {},
    });
    expect(hostPort).toHaveBeenCalledWith({
      sandboxId: "boat-id",
      hostPortRequest: { port: 9223, _public: false },
    });
    hostPort.mockResolvedValue({ ok: true, type: "host_port" });
    await expect(session.browserEndpoint(9223)).rejects.toThrow("preview URL");
    hostPort.mockResolvedValue({
      ok: true,
      type: "host_port",
      url: "https://preview.example",
      isProtected: false,
    });
    await expect(session.browserEndpoint(9223)).rejects.toThrow("protected browser endpoint");
    hostPort.mockResolvedValue({
      ok: true,
      type: "host_port",
      url: "https://preview.example",
      isProtected: true,
    });
    await expect(session.browserEndpoint(9223)).rejects.toThrow("protected browser endpoint");
  });

  it("creates once with the configured credential and reattaches by saved VM identity", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const root = await NodeFS.promises.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-boat-"));

    const box = {
      id: "boat-id",
      name: "test",
      state: "idle" as const,
      desktopAvailable: false,
      snapshotAvailable: true,
    };

    const create = vi.spyOn(BoatApi.prototype, "create").mockResolvedValue({
      ok: true,
      type: "sandbox.created",
      status: "provisioning",
      ttlSeconds: null,
      sandbox: box,
    });

    const get = vi
      .spyOn(BoatApi.prototype, "get")
      .mockResolvedValue({ ok: true, type: "sandbox.info", sandbox: box });

    const remove = vi.spyOn(BoatApi.prototype, "deleteSandbox").mockResolvedValue(deleted);

    const command = vi.spyOn(BoatApi.prototype, "command").mockResolvedValue({
      ok: true,
      type: "command.finished",
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });

    try {
      const input = {
        io: workspaceIO,
        threadId: "thread",
        sandbox: "boat" as const,
        workspaceId: "workspace",
        identityFile: NodePath.join(root, "identity.json"),
        environment: { BOAT_API_KEY: "configured-key" },
      };

      const first = await createRemoteBotWorkspace(input);
      expect(create).toHaveBeenCalledWith({
        createSandboxRequest: { ttlSeconds: null, noEnv: true },
      });
      const client = create.mock.contexts[0] as import("@boatdev/sdk").BoatApi;
      expect((await client.createRequestOpts({})).headers.Authorization).toBe(
        "Bearer configured-key",
      );
      expect(first.providerId).toBe("boat-id");
      get.mockRejectedValueOnce(new Error("VM unavailable"));
      await expect(createRemoteBotWorkspace(input)).rejects.toThrow("missing or unavailable");
      expect(create).toHaveBeenCalledOnce();
      const second = await createRemoteBotWorkspace(input);
      expect(create).toHaveBeenCalledOnce();
      expect(get).toHaveBeenCalledWith({ sandboxId: "boat-id" });
      await second.wake();
      remove.mockResolvedValueOnce({
        ...deleted,
        operation: { ...deleted.operation, status: "blocked" },
      });
      await expect(second.destroy()).rejects.toThrow("deletion is blocked");
      expect(JSON.parse(await NodeFS.promises.readFile(input.identityFile, "utf8"))).toEqual({
        provider: "boat",
        providerId: "boat-id",
      });
      await second.destroy();
      expect(remove).toHaveBeenCalledTimes(2);
      await expect(NodeFS.promises.stat(input.identityFile)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      create.mockRestore();
      get.mockRestore();
      remove.mockRestore();
      command.mockRestore();
      await NodeFS.promises.rm(root, { recursive: true, force: true });
    }
  });

  it.each([404, 401, 403, 500])(
    "reconciles saved VM identity only for a confirmed 404, not %s errors",
    async (status) => {
      const { BoatApi, ResponseError } = await import("@boatdev/sdk");
      const root = await NodeFS.promises.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-boat-"));
      const identityFile = NodePath.join(root, "identity.json");
      const previous = { provider: "boat", providerId: "deleted-id" };

      const get = vi
        .spyOn(BoatApi.prototype, "get")
        .mockRejectedValue(new ResponseError(new Response(null, { status })));

      const create = vi.spyOn(BoatApi.prototype, "create").mockResolvedValue({
        ok: true,
        type: "sandbox.created",
        status: "provisioning",
        ttlSeconds: null,
        sandbox: {
          id: "replacement-id",
          name: "test",
          state: "idle",
          desktopAvailable: false,
          snapshotAvailable: false,
        },
      });

      try {
        await NodeFS.promises.writeFile(identityFile, JSON.stringify(previous));

        const input = {
          io: workspaceIO,
          threadId: "thread",
          sandbox: "boat" as const,
          workspaceId: "workspace",
          identityFile,
          environment: { BOAT_API_KEY: "configured-key" },
        };

        if (status === 404) {
          create.mockRejectedValueOnce(new Error("creation unavailable"));
          await expect(createRemoteBotWorkspace(input)).rejects.toThrow("missing or unavailable");
          expect(JSON.parse(await NodeFS.promises.readFile(identityFile, "utf8"))).toEqual(
            previous,
          );
          const workspace = await createRemoteBotWorkspace(input);
          expect(workspace.providerId).toBe("replacement-id");
          expect(JSON.parse(await NodeFS.promises.readFile(identityFile, "utf8"))).toEqual({
            provider: "boat",
            providerId: "replacement-id",
          });
          expect(create).toHaveBeenLastCalledWith({
            createSandboxRequest: { ttlSeconds: null, noEnv: true },
          });
        } else {
          await expect(createRemoteBotWorkspace(input)).rejects.toThrow("missing or unavailable");
          expect(create).not.toHaveBeenCalled();
          expect(JSON.parse(await NodeFS.promises.readFile(identityFile, "utf8"))).toEqual(
            previous,
          );
        }
      } finally {
        get.mockRestore();
        create.mockRestore();
        await NodeFS.promises.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("surfaces Boat's own message when it refuses to create a VM", async () => {
    const { BoatApi, ResponseError } = await import("@boatdev/sdk");

    const refusal = new Response(
      JSON.stringify({ ok: false, message: "Start the $20/month Boat plan to create sandboxes." }),
      { status: 402 },
    );

    const create = vi
      .spyOn(BoatApi.prototype, "create")
      .mockRejectedValue(new ResponseError(refusal, "Response returned an error code"));

    const root = await NodeFS.promises.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-boat-"));

    try {
      await expect(
        createRemoteBotWorkspace({
          io: workspaceIO,
          threadId: "thread",
          sandbox: "boat",
          workspaceId: "workspace",
          identityFile: NodePath.join(root, "identity.json"),
          environment: { BOAT_API_KEY: "configured-key" },
        }),
      ).rejects.toThrow("Boat: Start the $20/month Boat plan to create sandboxes.");
    } finally {
      create.mockRestore();
      await NodeFS.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing credential before creating a VM", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const create = vi.spyOn(BoatApi.prototype, "create");
    const root = await NodeFS.promises.mkdtemp(NodePath.join(NodeOS.tmpdir(), "otto-boat-"));

    try {
      await expect(
        createRemoteBotWorkspace({
          io: workspaceIO,
          threadId: "thread",
          sandbox: "boat",
          workspaceId: "workspace",
          identityFile: NodePath.join(root, "identity.json"),
          environment: {},
        }),
      ).rejects.toThrow("BOAT_API_KEY");
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      await NodeFS.promises.rm(root, { recursive: true, force: true });
    }
  });
});

describe("createBotWorkspace", () => {
  it("classifies every managed provider", () => {
    expect(isRemoteBotSandbox("local")).toBe(false);

    for (const sandbox of ["e2b", "daytona", "vercel", "railway", "boat"] as const) {
      expect(isRemoteBotSandbox(sandbox)).toBe(true);
    }
  });

  it("keeps durable local bot files outside the user project", async () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-workspace-"));
    const projectDir = NodePath.join(baseDir, "project");
    const botRoot = NodePath.join(baseDir, "state", "otto-one");
    NodeFS.mkdirSync(projectDir, { recursive: true });

    const workspace = await createBotWorkspace({
      io: workspaceIO,
      threadId: "bot-one",
      cwd: projectDir,
      localRoot: botRoot,
      workspaceId: "otto-one",
      sandbox: "local",
    });

    assert.isDefined(workspace);
    expect(workspace.workspace.sandbox).toBeInstanceOf(LocalSandbox);
    expect(workspace.workspace.filesystem).toBeInstanceOf(LocalFilesystem);
    await workspace.workspace.filesystem?.writeFile("identity.txt", "bot-owned");
    expect(NodeFS.readFileSync(NodePath.join(botRoot, "identity.txt"), "utf8")).toBe("bot-owned");
    expect(NodeFS.existsSync(NodePath.join(projectDir, "identity.txt"))).toBe(false);
    await workspace.destroy();
    NodeFS.rmSync(baseDir, { recursive: true, force: true });
  });

  it("runs Local commands without the server's environment", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-local-env-"));
    process.env.OTTO_LOCAL_ENV_PROBE = "server-only";

    try {
      const workspace = await createBotWorkspace({
        io: workspaceIO,
        threadId: "bot-env",
        localRoot: root,
        workspaceId: "otto-env",
        sandbox: "local",
      });

      assert.isDefined(workspace);
      const result = await workspace.workspace.sandbox?.executeCommand?.("env");
      expect(result?.stdout).toContain("PATH=");
      expect(result?.stdout).not.toContain("OTTO_LOCAL_ENV_PROBE");
      await workspace.destroy();
    } finally {
      delete process.env.OTTO_LOCAL_ENV_PROBE;
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes stable identity to an injected remote provider", async () => {
    const remote = new Workspace({
      filesystem: new LocalFilesystem({ basePath: process.cwd() }),
      sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
    });

    const makeRemoteWorkspace = vi.fn(async () => remote);
    await createBotWorkspace({
      io: workspaceIO,
      threadId: "thread-vercel",
      sandbox: "vercel",
      workspaceId: "otto-vercel",
      environment: {
        VERCEL_TOKEN: "token",
        VERCEL_TEAM_ID: "team",
        VERCEL_PROJECT_ID: "project",
      },
      makeRemoteWorkspace,
    });
    expect(makeRemoteWorkspace).toHaveBeenCalledWith({
      io: workspaceIO,
      threadId: "thread-vercel",
      sandbox: "vercel",
      workspaceId: "otto-vercel",
      environment: {
        VERCEL_TOKEN: "token",
        VERCEL_TEAM_ID: "team",
        VERCEL_PROJECT_ID: "project",
      },
    });
    await remote.destroy();
  });

  it("requires stable identity for remote workspaces", async () => {
    await expect(
      createRemoteBotWorkspace({ io: workspaceIO, threadId: "thread-remote", sandbox: "e2b" }),
    ).rejects.toThrow("needs a stable workspace identity");
  });

  it("persists the provider identity and uses it to reattach", async () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-identity-"));
    const identityFile = NodePath.join(baseDir, "provider.json");

    const openSession = vi.fn(async (providerId?: string) =>
      remoteSession(providerId ?? "native-workspace-id"),
    );

    const input = {
      io: workspaceIO,
      threadId: "thread-remote",
      sandbox: "e2b" as const,
      workspaceId: "otto-stable-id",
      identityFile,
      openSession,
    };

    const created = await createRemoteBotWorkspace(input);
    const reattached = await createRemoteBotWorkspace(input);

    expect(created.id).toBe("otto-stable-id");
    expect(reattached.id).toBe("otto-stable-id");
    expect(reattached.providerId).toBe("native-workspace-id");
    expect(openSession).toHaveBeenNthCalledWith(1, undefined);
    expect(openSession).toHaveBeenNthCalledWith(2, "native-workspace-id");
    expect(JSON.parse(NodeFS.readFileSync(identityFile, "utf8"))).toEqual({
      provider: "e2b",
      providerId: "native-workspace-id",
    });
    await reattached.destroy();
    expect(NodeFS.existsSync(identityFile)).toBe(false);
    NodeFS.rmSync(baseDir, { recursive: true, force: true });
  });

  it("fails closed when a persisted remote workspace is missing", async () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-missing-"));
    const identityFile = NodePath.join(baseDir, "provider.json");
    NodeFS.writeFileSync(
      identityFile,
      `${JSON.stringify({ provider: "vercel", providerId: "missing-id" })}\n`,
    );

    await expect(
      createRemoteBotWorkspace({
        io: workspaceIO,
        threadId: "thread-remote",
        sandbox: "vercel",
        workspaceId: "otto-stable-id",
        identityFile,
        openSession: async () => Promise.reject(new Error("not found")),
      }),
    ).rejects.toThrow(`Remove '${identityFile}' to create a replacement`);
    expect(NodeFS.existsSync(identityFile)).toBe(true);
    NodeFS.rmSync(baseDir, { recursive: true, force: true });
  });
});
