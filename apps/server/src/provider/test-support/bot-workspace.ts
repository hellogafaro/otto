import { DateTime } from "effect";
import { vi } from "vite-plus/test";
import { boat, type OttoRemoteSession } from "../bot-workspace.ts";

export function makebotWorkspaceTestSupport() {
  function remoteSession(providerId: string): OttoRemoteSession {
    return {
      providerId,
      inspect: async () => "running",
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      wake: async () => undefined,
      sleep: async () => undefined,
      destroy: async () => undefined,
    };
  }

  const deleted = {
    ok: true,
    type: "sandbox.deleting",
    operation: {
      id: "deletion",
      kind: "sandbox",
      targetId: "boat-id",
      reason: "explicit",
      status: "completed",
      attemptCount: 0,
      requestedAt: DateTime.toDate(DateTime.makeUnsafe(0)),
      completedAt: null,
    },
  } satisfies import("@boatdev/sdk").DeletionOperationResponse;

  async function setup() {
    const { BoatApi, Configuration } = await import("@boatdev/sdk");
    const client = new BoatApi(new Configuration({ accessToken: "test-key" }));

    const get = vi.spyOn(client, "get").mockResolvedValue({
      type: "sandbox.info",
      sandbox: {
        id: "boat-id",
        name: "test",
        state: "idle",
        desktopAvailable: false,
        snapshotAvailable: true,
      },
      ok: true,
    });

    return { client, get, session: boat(client, "boat-id") };
  }

  return { remoteSession, deleted, setup };
}
