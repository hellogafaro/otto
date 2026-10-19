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

  const boatInput = (botId: string, workspaceId = `otto-${botId}`) => ({
    threadId: `thread-${botId}`,
    resourceScope: `bot-${botId}`,
    workspaceResourceKey: `boat:key:bot-${botId}`,
    workspaceId,
    botSandbox: "boat" as const,
    sandboxEnvironment: { BOAT_API_KEY: "test-key" },
    mcpServers: [],
  });

  const sweep = (
    target: OttoSessionResources,
    sandboxes: Record<string, "boat" | "railway" | "local">,
    now = Date.now(),
  ) =>
    target.sweepComputers({
      sandboxes: new Map(Object.entries(sandboxes)),
      environment: () => ({ BOAT_API_KEY: "test-key" }),
      now,
    });

  const recordFile = (workspaceId: string) =>
    NodePath.join(stateDir, "bot-workspaces", `${workspaceId}.json`);

  it("lets a shared computer stop soon only when none of its chats still works", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy"));
    await target.acquire({ ...boatInput("ivy"), threadId: "thread-ivy-2" });
    await target.acquire(boatInput("oak"));
    vi.mocked(BoatApi.prototype.update).mockClear();

    // Another chat of the same bot still works on this computer: it stays up.
    expect(target.idleComputer("thread-ivy", ["thread-ivy-2"])).toBeUndefined();
    // Work on another bot's computer does not hold this one.
    await target.idleComputer("thread-ivy", ["thread-oak"])?.();
    expect(BoatApi.prototype.update).toHaveBeenCalledWith({
      sandboxId: "vm-1",
      updateSandboxRequest: { ttlSeconds: 120 },
    });
  });

  it("creates Boat computers with an idempotency key and a TTL that running turns push back", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy"));

    expect(BoatApi.prototype.create).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      createSandboxRequest: { ttlSeconds: 300, noEnv: true },
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
      resumeRequest: { ttlSeconds: 300 },
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

  it("deletes the computer a bot left when its sandbox changed or a newer one replaced it", async () => {
    const target = resources();
    await target.acquire(boatInput("ivy"));
    await target.release("thread-ivy");
    await target.acquire({ ...boatInput("nova"), workspaceResourceKey: "boat:old:bot-nova" });
    await target.release("thread-nova");
    await target.acquire({ ...boatInput("nova", "otto-nova-new") });
    await target.release("thread-nova");

    expect(await sweep(target, { ivy: "railway", nova: "boat" })).toEqual([
      { workspaceId: "otto-ivy", provider: "boat", providerId: "vm-1", reason: "sandbox_changed" },
      { workspaceId: "otto-nova", provider: "boat", providerId: "vm-2", reason: "replaced" },
    ]);
    expect(NodeFS.existsSync(recordFile("otto-nova-new"))).toBe(true);
  });

  it("keeps a bot's computer from before its scope was its id, then sweeps by the new scope", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();
    await target.acquire(boatInput("ivy"));
    await target.release("thread-ivy");
    vi.mocked(BoatApi.prototype.create).mockClear();

    await target.acquire({
      ...boatInput("ivy", "otto-ivy-renamed"),
      resourceScope: "ivy",
      workspaceResourceKey: "boat:key:ivy",
      legacyWorkspaceId: "otto-ivy",
    });

    expect(BoatApi.prototype.create).not.toHaveBeenCalled();
    expect(NodeFS.existsSync(recordFile("otto-ivy-renamed"))).toBe(false);
    expect(JSON.parse(NodeFS.readFileSync(recordFile("otto-ivy"), "utf8"))).toMatchObject({
      providerId: "vm-1",
      scope: "ivy",
    });
    await target.release("thread-ivy");

    expect(await sweep(target, { ivy: "boat" })).toEqual([]);
    expect(await sweep(target, {})).toEqual([
      { workspaceId: "otto-ivy", provider: "boat", providerId: "vm-1", reason: "bot_deleted" },
    ]);
  });

  it("gives a bot a new computer under its id when it had none before", async () => {
    const { BoatApi } = await import("@boatdev/sdk");
    const target = resources();

    await target.acquire({
      ...boatInput("nova", "otto-nova-new"),
      resourceScope: "nova",
      workspaceResourceKey: "boat:key:nova",
      legacyWorkspaceId: "otto-nova",
    });

    expect(BoatApi.prototype.create).toHaveBeenCalledOnce();
    expect(JSON.parse(NodeFS.readFileSync(recordFile("otto-nova-new"), "utf8"))).toMatchObject({
      scope: "nova",
    });
    expect(NodeFS.existsSync(recordFile("otto-nova"))).toBe(false);
  });

  it("deletes a deleted bot's Local computer folder", async () => {
    const target = resources();
    await target.acquire({
      threadId: "thread-local",
      resourceScope: "bot-local",
      workspaceResourceKey: "local:cwd:bot-local",
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

  it("claims old records for their bot and deletes unclaimed ones a week after finding them", async () => {
    const { BoatApi } = await import("@boatdev/sdk");

    const { botWorkspaceCredentialFingerprint, botWorkspaceIdentity, botWorkspaceResourceKey } =
      await import("./bot-workspace-pool.ts");

    const target = resources();

    const ivyId = botWorkspaceIdentity(
      botWorkspaceResourceKey({
        resourceScope: "bot-ivy",
        sandbox: "boat",
        credentialFingerprint: botWorkspaceCredentialFingerprint({ BOAT_API_KEY: "test-key" }),
      }),
    );

    for (const [id, providerId] of [
      [ivyId, "vm-ivy"],
      ["otto-unknown", "vm-unknown"],
    ]) {
      const legacy = NodePath.join(stateDir, "bot-workspaces", id!);
      NodeFS.mkdirSync(legacy, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(legacy, "provider.json"),
        JSON.stringify({ provider: "boat", providerId }),
      );
    }

    const now = Date.now();
    expect(await sweep(target, { ivy: "boat" }, now)).toEqual([]);
    expect(JSON.parse(NodeFS.readFileSync(recordFile(ivyId), "utf8"))).toEqual({
      provider: "boat",
      providerId: "vm-ivy",
      scope: "ivy",
    });
    expect(JSON.parse(NodeFS.readFileSync(recordFile("otto-unknown"), "utf8"))).toMatchObject({
      orphanedAt: expect.any(String),
    });
    expect(NodeFS.existsSync(NodePath.join(stateDir, "bot-workspaces", ivyId))).toBe(false);

    expect(await sweep(target, { ivy: "boat" }, now + 6 * DAY_MS)).toEqual([]);
    expect(await sweep(target, { ivy: "boat" }, now + 7 * DAY_MS)).toEqual([
      { workspaceId: "otto-unknown", provider: "boat", providerId: "vm-unknown", reason: "orphan" },
    ]);
    expect(BoatApi.prototype.deleteSandbox).toHaveBeenCalledOnce();
  });
});
