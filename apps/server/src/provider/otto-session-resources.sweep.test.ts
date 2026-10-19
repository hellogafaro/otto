import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OttoSessionResources } from "./otto-session-resources.ts";
import { makebotWorkspaceTestSupport } from "./test-support/bot-workspace.ts";
import { workspaceIO } from "./test-support/workspace-io.ts";

const { deleted } = makebotWorkspaceTestSupport();

const DAY_MS = 24 * 60 * 60 * 1000;

describe("OttoSessionResources computer sweep", () => {
  let stateDir: string;
  const states = new Map<string, "idle" | "archived">();
  let nextId = 0;
  const restores: Array<() => void> = [];

  beforeEach(async () => {
    stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-sweep-"));
    states.clear();
    nextId = 0;
    const { BoatApi } = await import("@boatdev/sdk");

    const box = (id: string) => ({
      id,
      name: "test",
      state: states.get(id) ?? ("idle" as const),
      desktopAvailable: false,
      snapshotAvailable: true,
    });

    restores.push(
      vi.spyOn(BoatApi.prototype, "create").mockImplementation(async () => ({
        ok: true,
        type: "sandbox.created",
        status: "provisioning",
        ttlSeconds: 300,
        sandbox: box(`vm-${++nextId}`),
      })).mockRestore,
      vi.spyOn(BoatApi.prototype, "get").mockImplementation(async ({ sandboxId }) => ({
        ok: true,
        type: "sandbox.info",
        sandbox: box(sandboxId),
      })).mockRestore,
      vi.spyOn(BoatApi.prototype, "stop").mockImplementation(async ({ sandboxId }) => {
        states.set(sandboxId, "archived");

        return { ok: true, type: "sandbox.stopped" } as never;
      }).mockRestore,
      vi.spyOn(BoatApi.prototype, "update").mockResolvedValue({} as never).mockRestore,
      vi.spyOn(BoatApi.prototype, "resume").mockImplementation(async ({ sandboxId }) => {
        states.set(sandboxId, "idle");

        return {} as never;
      }).mockRestore,
      vi.spyOn(BoatApi.prototype, "deleteSandbox").mockResolvedValue(deleted).mockRestore,
      vi.spyOn(BoatApi.prototype, "command").mockResolvedValue({
        ok: true,
        type: "command.finished",
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      }).mockRestore,
    );
  });

  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
    NodeFS.rmSync(stateDir, { recursive: true, force: true });
  });

  const resources = () =>
    new OttoSessionResources({ io: workspaceIO, stateDir, toMcpServerConfigs: () => ({}) });

  const boatInput = (
    botId: string,
    threadId = `thread-${botId}`,
    workspaceId = `otto-${botId}`,
  ) => ({
    threadId,
    resourceScope: `${botId}_${threadId}`,
    workspaceResourceKey: `boat:key:${botId}_${threadId}`,
    workspaceId,
    botSandbox: "boat" as const,
    sandboxEnvironment: { BOAT_API_KEY: "test-key" },
    mcpServers: [],
  });

  const sweep = (
    target: OttoSessionResources,
    sandboxes: Record<string, "boat" | "local">,
    now = Date.now(),
  ) =>
    target.sweepComputers({
      sandboxes: new Map(Object.entries(sandboxes)),
      environment: () => ({ BOAT_API_KEY: "test-key" }),
      now,
    });

  const recordFile = (workspaceId: string) =>
    NodePath.join(stateDir, "bot-workspaces", `${workspaceId}.json`);

  it("lets a chat's computer stop soon even when another chat of the same bot still works", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy", "thread-ivy-1", "otto-ivy-1"));
    await target.acquire(boatInput("ivy", "thread-ivy-2", "otto-ivy-2"));
    vi.mocked(BoatApi.prototype.update).mockClear();

    expect(target.idleComputer("thread-ivy-1", ["thread-ivy-2"])).toBeDefined();
    await target.idleComputer("thread-ivy-1", ["thread-ivy-2"])?.();
    expect(BoatApi.prototype.update).toHaveBeenCalledWith({
      sandboxId: "vm-1",
      updateSandboxRequest: { ttlSeconds: 120 },
    });
  });

  it("gives each chat of a bot its own Boat computer and resumes it on the next turn", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy", "thread-a", "otto-a"));
    await target.acquire(boatInput("ivy", "thread-b", "otto-b"));
    expect(BoatApi.prototype.create).toHaveBeenCalledTimes(2);
    await target.release("thread-a");
    vi.mocked(BoatApi.prototype.create).mockClear();

    await target.acquire(boatInput("ivy", "thread-a", "otto-a"));
    expect(BoatApi.prototype.create).not.toHaveBeenCalled();
    expect(BoatApi.prototype.get).toHaveBeenCalledWith({ sandboxId: "vm-1" });
  });

  it("creates Boat computers with an idempotency key and a TTL that running turns push back", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy"));

    expect(BoatApi.prototype.create).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      createSandboxRequest: { ttlSeconds: 300, noEnv: true, type: "default" },
    });
    vi.mocked(BoatApi.prototype.update).mockClear();
    await target.keepComputersAwake([]);
    expect(BoatApi.prototype.update).not.toHaveBeenCalled();

    await target.keepComputersAwake(["thread-ivy"]);
    expect(BoatApi.prototype.update).toHaveBeenCalledWith({
      sandboxId: "vm-1",
      updateSandboxRequest: { ttlSeconds: 300 },
    });

    states.set("vm-1", "archived");
    await target.keepComputersAwake(["thread-ivy"]);
    expect(BoatApi.prototype.resume).toHaveBeenCalledWith({
      sandboxId: "vm-1",
      resumeRequest: { ttlSeconds: 300, type: "default" },
    });
    await target.release("thread-ivy");
    expect(BoatApi.prototype.stop).toHaveBeenCalledWith({ sandboxId: "vm-1" });
  });

  it("deletes a deleted bot's computer once no session holds it", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("nova"));

    expect(await sweep(target, {})).toEqual([]);
    expect(BoatApi.prototype.deleteSandbox).not.toHaveBeenCalled();

    await target.release("thread-nova");
    expect(await sweep(target, { ivy: "boat" })).toEqual([
      { workspaceId: "otto-nova", provider: "boat", providerId: "vm-1", reason: "bot_deleted" },
    ]);
    expect(BoatApi.prototype.deleteSandbox).toHaveBeenCalledWith({
      sandboxId: "vm-1",
      xAsciiConfirmDelete: "vm-1",
    });
    expect(NodeFS.existsSync(recordFile("otto-nova"))).toBe(false);
    expect(await sweep(target, {})).toEqual([]);
  });

  it("keeps the record after a failed delete and finishes on the next sweep", async () => {
    const { BoatApi, ResponseError } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("nova"));
    await target.release("thread-nova");

    vi.mocked(BoatApi.prototype.deleteSandbox).mockRejectedValueOnce(
      new Error("Boat is unavailable."),
    );
    expect(await sweep(target, {})).toMatchObject([
      { workspaceId: "otto-nova", error: "Boat is unavailable." },
    ]);
    expect(NodeFS.existsSync(recordFile("otto-nova"))).toBe(true);

    vi.mocked(BoatApi.prototype.deleteSandbox).mockRejectedValueOnce(
      new ResponseError(new Response(null, { status: 404 })),
    );
    expect(await sweep(target, {})).toMatchObject([{ workspaceId: "otto-nova" }]);
    expect(NodeFS.existsSync(recordFile("otto-nova"))).toBe(false);
  });

  it("keeps a chat's computer while its bot still uses that sandbox", async () => {
    const target = resources();
    await target.acquire(boatInput("ivy"));
    await target.release("thread-ivy");

    expect(await sweep(target, { ivy: "boat" })).toEqual([]);
    expect(NodeFS.existsSync(recordFile("otto-ivy"))).toBe(true);
  });

  it("deletes the computer a bot left when its sandbox changed", async () => {
    const target = resources();
    await target.acquire(boatInput("ivy"));
    await target.release("thread-ivy");

    expect(await sweep(target, { ivy: "local" })).toEqual([
      { workspaceId: "otto-ivy", provider: "boat", providerId: "vm-1", reason: "sandbox_changed" },
    ]);
    expect(NodeFS.existsSync(recordFile("otto-ivy"))).toBe(false);
  });

  it("retires a leftover per-bot computer so each chat gets its own", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    NodeFS.mkdirSync(NodePath.join(stateDir, "bot-workspaces"), { recursive: true });
    NodeFS.writeFileSync(
      recordFile("otto-ivy-legacy"),
      JSON.stringify({
        provider: "boat",
        providerId: "vm-legacy",
        scope: "ivy",
      }),
    );

    expect(await sweep(target, { ivy: "boat" })).toEqual([
      {
        workspaceId: "otto-ivy-legacy",
        provider: "boat",
        providerId: "vm-legacy",
        reason: "replaced",
      },
    ]);
    expect(BoatApi.prototype.deleteSandbox).toHaveBeenCalledWith({
      sandboxId: "vm-legacy",
      xAsciiConfirmDelete: "vm-legacy",
    });
    expect(NodeFS.existsSync(recordFile("otto-ivy-legacy"))).toBe(false);
  });

  it("drops a retired provider's identity without calling Boat", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    NodeFS.mkdirSync(NodePath.join(stateDir, "bot-workspaces"), { recursive: true });
    NodeFS.writeFileSync(
      recordFile("otto-e2b"),
      JSON.stringify({
        provider: "e2b",
        providerId: "old-e2b",
        scope: "ivy_thread-1",
      }),
    );

    expect(await sweep(target, { ivy: "local" })).toEqual([
      {
        workspaceId: "otto-e2b",
        provider: "e2b",
        providerId: "old-e2b",
        reason: "sandbox_changed",
      },
    ]);
    expect(BoatApi.prototype.deleteSandbox).not.toHaveBeenCalled();
    expect(NodeFS.existsSync(recordFile("otto-e2b"))).toBe(false);
  });

  it("deletes a deleted bot's Local computer folder", async () => {
    const target = resources();
    await target.acquire({
      threadId: "thread-local",
      resourceScope: "local_thread-local",
      workspaceResourceKey: "local:cwd:local_thread-local",
      workspaceId: "otto-local",
      botSandbox: "local",
      mcpServers: [],
    });
    await target.release("thread-local");
    const folder = NodePath.join(stateDir, "bot-workspaces", "otto-local");
    NodeFS.writeFileSync(NodePath.join(folder, "notes.md"), "kept while the bot exists");

    expect(await sweep(target, { local: "local" })).toEqual([]);
    expect(await sweep(target, {})).toMatchObject([
      { workspaceId: "otto-local", reason: "bot_deleted" },
    ]);
    expect(NodeFS.existsSync(folder)).toBe(false);
  });

  it("deletes unclaimed remote records a week after finding them", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    const unknown = NodePath.join(stateDir, "bot-workspaces", "otto-unknown");
    NodeFS.mkdirSync(unknown, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(unknown, "provider.json"),
      JSON.stringify({ provider: "boat", providerId: "vm-unknown" }),
    );

    const now = Date.now();
    expect(await sweep(target, { ivy: "boat" }, now)).toEqual([]);
    expect(JSON.parse(NodeFS.readFileSync(recordFile("otto-unknown"), "utf8"))).toMatchObject({
      orphanedAt: expect.any(String),
    });
    expect(NodeFS.existsSync(unknown)).toBe(false);

    expect(await sweep(target, { ivy: "boat" }, now + 6 * DAY_MS)).toEqual([]);
    expect(await sweep(target, { ivy: "boat" }, now + 7 * DAY_MS)).toEqual([
      { workspaceId: "otto-unknown", provider: "boat", providerId: "vm-unknown", reason: "orphan" },
    ]);
    expect(BoatApi.prototype.deleteSandbox).toHaveBeenCalledOnce();
  });
});
