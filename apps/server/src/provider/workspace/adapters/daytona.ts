import * as Match from "effect/Match";
import type { DaytonaSandbox } from "@mastra/daytona";
import { DaytonaComputer } from "../../daytona-computer.ts";
import { WorkspaceComputer } from "../../workspace-computer.ts";
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

  const computer = new WorkspaceComputer(
    providerId,
    new DaytonaComputer(() => sandbox.instance),
    // Chromium survives reconnects and some wakes; reuse it instead of starting
    // a second browser on the same profile and debugging port.
    async () => {
      const result = await sandbox.instance.process.executeCommand(
        "sh -c 'command -v chromium >/dev/null || command -v chromium-browser >/dev/null || exit 1; profile=/tmp/otto-chromium; command -v pgrep >/dev/null && pgrep -f \"[-]-user-data-dir=$profile\" >/dev/null && exit 0; mkdir -p $profile; nohup ${CHROMIUM_BIN:-$(command -v chromium || command -v chromium-browser)} --no-sandbox --disable-dev-shm-usage --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --user-data-dir=$profile about:blank >/dev/null 2>&1 </dev/null &'",
        undefined,
        { DISPLAY: ":1" },
      );

      if (result.exitCode !== 0) throw new Error("Daytona graphical Chromium is unavailable.");
    },
    async () => {
      const preview = await sandbox.instance.getPreviewLink(9222);

      if (!preview.url || !preview.token)
        throw new Error("Daytona browser endpoint is unavailable.");

      return { url: preview.url, requestHeaders: { "x-daytona-preview-token": preview.token } };
    },
    inspect,
  );

  return mastraSession(sandbox, {
    providerId,
    computer,
    inspect,
    browserEndpoint: async (port) => {
      const preview = await sandbox.instance.getPreviewLink(port);
      const token = preview.token?.trim();

      if (!preview.url || !token) {
        throw new Error(`Daytona workspace '${providerId}' has no authenticated preview URL.`);
      }

      const url = new URL(preview.url);
      url.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);

      return { url: url.toString(), requestHeaders: {} };
    },
  });
}
