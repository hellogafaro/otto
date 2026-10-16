import type { RailwaySandbox } from "@mastra/railway";
import { credential } from "../bot-workspace-lifecycle.ts";
import { type OttoRemoteSession, type OttoWorkspaceState } from "../bot-workspace-types.ts";
import { mastraSession } from "./mastra.ts";

export function railwayCredentials(environment: Readonly<Record<string, string>>) {
  return {
    token: credential(environment, "RAILWAY_API_TOKEN"),
    environmentId: credential(environment, "RAILWAY_ENVIRONMENT_ID"),
  };
}

export function railway(
  sandbox: RailwaySandbox,
  credentials: ReturnType<typeof railwayCredentials>,
): OttoRemoteSession {
  const providerId = sandbox.sandboxId;

  if (!providerId) throw new Error(`Railway workspace '${sandbox.id}' is not started.`);

  const inspect = async (): Promise<OttoWorkspaceState> => {
    const { Sandbox, SandboxNotFoundError } = await import("railway");

    try {
      return railwayWorkspaceState((await Sandbox.connect(providerId, credentials)).status);
    } catch (cause) {
      if (cause instanceof SandboxNotFoundError) return "missing";
      throw cause;
    }
  };

  return mastraSession(sandbox, {
    providerId,
    inspect,
    browserEndpoint: async () => {
      throw new Error(
        "Railway previews require a Railway CLI tunnel. Automatic bot browser routing is not supported; private VM addresses are not browser endpoints.",
      );
    },
    wake: async () => {
      if ((await inspect()) !== "running")
        throw new Error(`Railway workspace '${providerId}' is not running.`);
    },
    // Railway has no pause; Mastra's stop deletes the VM, so idle keeps it running.
    sleep: async () => undefined,
  });
}

export function railwayWorkspaceState(status: import("railway").SandboxStatus): OttoWorkspaceState {
  if (status === "RUNNING") return "running";

  if (status === "CREATING") return "sleeping";

  return "missing";
}
