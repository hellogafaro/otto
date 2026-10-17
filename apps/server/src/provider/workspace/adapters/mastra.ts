import type { MastraSandbox } from "@mastra/core/workspace";
import type { OttoRemoteSession } from "../bot-workspace-types.ts";

const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

export function mastraSession(
  sandbox: MastraSandbox,
  session: Pick<OttoRemoteSession, "providerId" | "inspect"> &
    Partial<Pick<OttoRemoteSession, "wake" | "sleep">>,
): OttoRemoteSession {
  return {
    run: async (command, args, options) => {
      if (!sandbox.executeCommand)
        throw new Error(`${sandbox.provider} sandbox cannot run commands.`);

      return sandbox.executeCommand(command, [...args], {
        ...options,
        maxRetainedBytes: MAX_COMMAND_OUTPUT_BYTES,
      });
    },
    wake: async () => {
      await sandbox._start();
    },
    sleep: () => sandbox._stop(),
    destroy: () => sandbox._destroy(),
    ...session,
  };
}
