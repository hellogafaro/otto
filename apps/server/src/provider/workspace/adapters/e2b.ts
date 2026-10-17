import type { E2BSandbox } from "@mastra/e2b";
import { type OttoRemoteSession } from "../bot-workspace-types.ts";
import { mastraSession } from "./mastra.ts";

export function e2b(sandbox: E2BSandbox, apiKey: string): OttoRemoteSession {
  const providerId = sandbox.sandboxId;

  if (!providerId) throw new Error(`E2B workspace '${sandbox.id}' is not started.`);

  return mastraSession(sandbox, {
    providerId,
    inspect: async () => {
      const { Sandbox } = await import("e2b");
      const info = await Sandbox.getInfo(providerId, { apiKey });

      return info.state === "paused" ? "sleeping" : "running";
    },
  });
}
