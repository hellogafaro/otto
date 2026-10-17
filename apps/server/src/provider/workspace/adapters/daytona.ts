import * as Match from "effect/Match";
import type { DaytonaSandbox } from "@mastra/daytona";
import { type OttoRemoteSession, type OttoWorkspaceState } from "../bot-workspace-types.ts";
import { mastraSession } from "./mastra.ts";

export function daytona(sandbox: DaytonaSandbox): OttoRemoteSession {
  const providerId = sandbox.instance.id;

  const inspect = async (): Promise<OttoWorkspaceState> => {
    if (sandbox.status === "destroyed") return "missing";

    if (sandbox.status !== "running") return "sleeping";
    const instance = sandbox.instance;
    await instance.refreshData();

    return Match.value(String(instance.state)).pipe(
      Match.when("destroyed", () => "missing" as const),
      Match.when("started", () => "running" as const),
      Match.orElse(() => "sleeping" as const),
    );
  };

  return mastraSession(sandbox, {
    providerId,
    inspect,
  });
}
