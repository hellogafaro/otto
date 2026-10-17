import { describe } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import {
  BotWorkspacePool,
  botWorkspaceCredentialFingerprint,
  botWorkspaceIdentity,
  botWorkspaceResourceKey,
} from "./bot-workspace-pool.ts";
import { makebotWorkspacePoolTestSupport } from "./test-support/bot-workspace-pool.ts";

const { localWorkspace, remoteWorkspace } = makebotWorkspacePoolTestSupport();

describe("BotWorkspacePool", () => {
  effectIt.effect("never destroys a durable Railway VM on initial or subsequent wake failure", () =>
    Effect.promise(async () => {
      const pool = new BotWorkspacePool();
      const destroy = vi.fn(async () => undefined);
      const wake = vi.fn(async () => undefined);

      const create = async () => ({
        id: "shared-railway",
        provider: "railway" as const,
        workspace: localWorkspace(),
        inspect: async () => "running" as const,
        wake,
        sleep: async () => undefined,
        destroy,
      });

      const active = await pool.acquire("old-credentials", create);
      wake.mockRejectedValueOnce(new Error("new credentials unavailable"));
      await expect(pool.acquire("new-credentials", create)).rejects.toThrow(
        "new credentials unavailable",
      );
      expect(destroy).not.toHaveBeenCalled();
      await active.release();
      wake.mockRejectedValueOnce(new Error("wake failed"));
      await expect(pool.acquire("old-credentials", create)).rejects.toThrow("wake failed");
      expect(destroy).not.toHaveBeenCalled();
    }),
  );

  effectIt.effect(
    "keeps Railway identities across credential changes without reusing credential-bound clients",
    () =>
      Effect.sync(() => {
        const key = (token: string, scope = "bot-one") =>
          botWorkspaceResourceKey({
            resourceScope: scope,
            sandbox: "railway",
            credentialFingerprint: botWorkspaceCredentialFingerprint({ RAILWAY_API_TOKEN: token }),
          });

        expect(key("old")).not.toBe(key("new"));
        expect(botWorkspaceIdentity(key("old"))).toBe(botWorkspaceIdentity(key("new")));
        expect(botWorkspaceIdentity(key("old"))).not.toBe(
          botWorkspaceIdentity(key("old", "bot-two")),
        );
      }),
  );

  it("serializes Railway creation across credential-scoped keys with one identity", async () => {
    const pool = new BotWorkspacePool();

    const key = (token: string) =>
      botWorkspaceResourceKey({
        resourceScope: "bot-one",
        sandbox: "railway",
        credentialFingerprint: botWorkspaceCredentialFingerprint({ RAILWAY_API_TOKEN: token }),
      });

    let vmCreated = false;
    let creates = 0;
    let activeCreates = 0;
    let maxActiveCreates = 0;

    const create = async () => {
      creates++;
      activeCreates++;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);

      if (!vmCreated) {
        await Promise.resolve();
        vmCreated = true;
      }

      activeCreates--;

      return remoteWorkspace({ provider: "railway" });
    };

    const [first, second] = await Promise.all([
      pool.acquire(key("old"), create),
      pool.acquire(key("new"), create),
    ]);

    expect(creates).toBe(2);
    expect(maxActiveCreates).toBe(1);
    expect(vmCreated).toBe(true);
    await first.release();
    await second.release();
  });
});
