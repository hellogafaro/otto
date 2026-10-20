import { describe } from "vite-plus/test";
import { Workspace } from "@mastra/core/workspace";
import { it as effectIt } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it, vi } from "vite-plus/test";
import { BotWorkspacePool } from "./bot-workspace-pool.ts";
import { makebotWorkspacePoolTestSupport } from "./test-support/bot-workspace-pool.ts";

const { localWorkspace, remoteWorkspace } = makebotWorkspacePoolTestSupport();

describe("BotWorkspacePool", () => {
  it("retries failed creation", async () => {
    const pool = new BotWorkspacePool();

    const create = vi
      .fn<() => Promise<Workspace>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(localWorkspace());

    await expect(pool.acquire("retry", create)).rejects.toThrow("unavailable");
    const lease = await pool.acquire("retry", create);
    await lease.release();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("preserves a remote workspace after a failed initial wake and retries it", async () => {
    const pool = new BotWorkspacePool();
    const local = localWorkspace();

    const remote = {
      id: local.id,
      provider: "boat" as const,
      workspace: local,
      inspect: async () => "running" as const,
      wake: () => local.init(),
      sleep: () => local.stop(),
      destroy: () => local.destroy(),
    };

    vi.spyOn(local, "init").mockRejectedValueOnce(new Error("wake failed"));
    const destroy = vi.spyOn(local, "destroy");
    const create = vi.fn(async () => remote);

    await expect(pool.acquire("remote-wake", create)).rejects.toThrow("wake failed");
    expect(destroy).not.toHaveBeenCalled();
    const lease = await pool.acquire("remote-wake", create);
    expect(create).toHaveBeenCalledTimes(2);
    await lease.release();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("retries a failed Boat stop instead of leaving the VM running", async () => {
    const pool = new BotWorkspacePool();
    const local = localWorkspace();

    const remote = {
      id: local.id,
      provider: "boat" as const,
      workspace: local,
      inspect: async () => "running" as const,
      wake: () => local.init(),
      sleep: () => local.stop(),
      destroy: () => local.destroy(),
    };

    const stop = vi.spyOn(local, "stop").mockRejectedValueOnce(new Error("sleep failed"));
    const destroy = vi.spyOn(local, "destroy");
    const create = vi.fn(async () => remote);
    const lease = await pool.acquire("remote-sleep", create);

    await expect(lease.release()).rejects.toThrow("sleep failed");
    await pool.retryFailedSleeps();
    expect(stop).toHaveBeenCalledTimes(2);
    const retry = await pool.acquire("remote-sleep", create);
    expect(create).toHaveBeenCalledOnce();
    await retry.release();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("preserves a remote workspace when waking after idle fails", async () => {
    const pool = new BotWorkspacePool();
    const local = localWorkspace();
    const wake = vi.fn(async () => local.init());
    const destroy = vi.fn(async () => local.destroy());

    const create = vi.fn(async () => ({
      id: local.id,
      provider: "boat" as const,
      workspace: local,
      inspect: async () => "running" as const,
      wake,
      sleep: () => local.stop(),
      destroy,
    }));

    const lease = await pool.acquire("remote-idle-wake", create);
    await lease.release();
    wake.mockRejectedValueOnce(new Error("resume timed out"));
    await expect(pool.acquire("remote-idle-wake", create)).rejects.toThrow("resume timed out");
    expect(destroy).not.toHaveBeenCalled();
    const retry = await pool.acquire("remote-idle-wake", create);
    expect(create).toHaveBeenCalledTimes(2);
    await retry.release();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("preserves and reuses a remote workspace after sleep failure", async () => {
    const pool = new BotWorkspacePool();

    const failed = remoteWorkspace({
      sleep: vi.fn().mockRejectedValueOnce(new Error("sleep failed")).mockResolvedValue(undefined),
    });

    const reattached = remoteWorkspace();
    const create = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(reattached);

    const initial = await pool.acquire("remote-sleep", create);
    await expect(initial.release()).rejects.toThrow("sleep failed");
    expect(failed.destroy).not.toHaveBeenCalled();
    const lease = await pool.acquire("remote-sleep", create);
    expect(lease.workspace).toBe(failed);
    expect(create).toHaveBeenCalledOnce();
    await lease.release();
    expect(failed.destroy).not.toHaveBeenCalled();
  });

  it("retries failed remote pauses without another acquisition and retains repeated failures", async () => {
    const pool = new BotWorkspacePool();

    const sleep = vi
      .fn()
      .mockRejectedValueOnce(new Error("pause failed"))
      .mockRejectedValueOnce(new Error("pause still unavailable"))
      .mockResolvedValue(undefined);

    const workspace = remoteWorkspace({ sleep });
    const lease = await pool.acquire("idle-retry", async () => workspace);
    await expect(lease.release()).rejects.toThrow("pause failed");
    await expect(pool.retryFailedSleeps()).rejects.toThrow("pause still unavailable");
    await pool.retryFailedSleeps();
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(workspace.destroy).not.toHaveBeenCalled();
    await pool.retryFailedSleeps();
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("does not retry pause while a recovered workspace is leased", async () => {
    const pool = new BotWorkspacePool();

    const sleep = vi
      .fn()
      .mockRejectedValueOnce(new Error("pause failed"))
      .mockResolvedValue(undefined);

    const workspace = remoteWorkspace({ sleep });
    const create = vi.fn(async () => workspace);
    const lease = await pool.acquire("active-retry", create);
    await expect(lease.release()).rejects.toThrow("pause failed");
    const active = await pool.acquire("active-retry", create);
    await pool.retryFailedSleeps();
    expect(sleep).toHaveBeenCalledTimes(1);
    await active.release();
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight idle retry before waking a new lease", async () => {
    const pool = new BotWorkspacePool();
    let finishPause!: () => void;
    let markStarted!: () => void;

    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    const sleep = vi
      .fn()
      .mockRejectedValueOnce(new Error("pause failed"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPause = resolve;
            markStarted();
          }),
      )
      .mockResolvedValue(undefined);

    const workspace = remoteWorkspace({ sleep });
    const create = vi.fn(async () => workspace);
    const lease = await pool.acquire("concurrent-retry", create);
    await expect(lease.release()).rejects.toThrow("pause failed");
    const retry = pool.retryFailedSleeps();
    await started;
    const acquire = pool.acquire("concurrent-retry", create);
    expect(workspace.wake).toHaveBeenCalledOnce();
    finishPause();
    await retry;
    const active = await acquire;
    expect(workspace.wake).toHaveBeenCalledTimes(2);
    await active.release();
  });

  effectIt.effect("destroys a workspace whose wake fails and retries creation", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const pool = new BotWorkspacePool({ idleTimeToLive: "1 hour", clock });
      const failed = localWorkspace();
      const healthy = localWorkspace();
      vi.spyOn(failed, "init").mockRejectedValueOnce(new Error("wake failed"));
      const failedDestroy = vi.spyOn(failed, "destroy");

      const create = vi
        .fn<() => Promise<Workspace>>()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(healthy);

      const rejection = (promise: Promise<unknown>) =>
        Effect.promise(() =>
          promise.then(
            () => undefined,
            (cause: unknown) => cause,
          ),
        );

      expect(yield* rejection(pool.acquire("retry", create))).toMatchObject({
        message: "unavailable",
      });
      expect(yield* rejection(pool.acquire("retry", create))).toMatchObject({
        message: "wake failed",
      });
      expect(failedDestroy).toHaveBeenCalledOnce();
      const lease = yield* Effect.promise(() => pool.acquire("retry", create));
      expect(lease.workspace.workspace).toBe(healthy);
      expect(create).toHaveBeenCalledTimes(3);
      yield* Effect.promise(() => lease.release());
    }).pipe(Effect.provide(TestClock.layer())),
  );

  effectIt.effect("destroys a workspace that fails to sleep and replaces it", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const pool = new BotWorkspacePool({ clock });
      const failed = localWorkspace();
      const replacement = localWorkspace();
      vi.spyOn(failed, "stop").mockRejectedValueOnce(new Error("sleep failed"));
      const failedDestroy = vi.spyOn(failed, "destroy");

      const create = vi
        .fn<() => Promise<Workspace>>()
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(replacement);

      const first = yield* Effect.promise(() => pool.acquire("sleep", create));

      const error = yield* Effect.promise(() =>
        first.release().then(
          () => undefined,
          (cause: unknown) => cause,
        ),
      );

      expect(error).toMatchObject({ message: "sleep failed" });
      const second = yield* Effect.promise(() => pool.acquire("sleep", create));
      expect(failedDestroy).toHaveBeenCalledOnce();
      expect(second.workspace.workspace).toBe(replacement);
      expect(second.wokeFromSleep).toBe(false);
      yield* Effect.promise(() => second.release());
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
