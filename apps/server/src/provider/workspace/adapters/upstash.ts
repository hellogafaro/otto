import { type OttoRemoteSession, type OttoWorkspaceState } from "../bot-workspace-types.ts";
import { commandLine, quote } from "../bot-workspace-lifecycle.ts";

export function upstash(box: import("@upstash/box").Box): OttoRemoteSession {
  const inspect = async () => {
    const status = (await box.getStatus()).status;

    return upstashWorkspaceState(status);
  };

  return {
    providerId: box.id,
    inspect,
    run: async (command, args, options) => {
      const assignments = Object.entries(options?.env ?? {}).map(
        ([key, value]) => `${key}=${value}`,
      );

      let line =
        assignments.length > 0
          ? commandLine("env", ["--", ...assignments, command, ...args])
          : commandLine(command, args);

      if (options?.timeout !== undefined) {
        line = commandLine("timeout", [`${options.timeout / 1_000}s`, "sh", "-lc", line]);
      }

      const result = await box.exec.command(
        `${options?.cwd ? `cd ${quote(options.cwd)} && ` : ""}${line}`,
      );

      return { exitCode: result.exitCode ?? 1, stdout: result.result, stderr: "" };
    },
    browserEndpoint: async (port) => {
      const preview = await box.getPublicURL(port, { bearerToken: true });
      const token = preview.token?.trim();

      if (!preview.url || !token) {
        throw new Error(`Upstash workspace '${box.id}' has no authenticated public URL.`);
      }

      return {
        url: preview.url,
        requestHeaders: { authorization: `Bearer ${token}` },
      };
    },
    wake: async () => {
      const current = await inspect();

      if (current === "missing") {
        throw new Error(`Upstash workspace '${box.id}' is missing.`);
      }

      if (current === "sleeping") {
        await box.resume();
      }
    },
    sleep: () => box.pause(),
    destroy: () => box.delete(),
  };
}

export function upstashWorkspaceState(status: string): OttoWorkspaceState {
  if (status === "running" || status === "idle") return "running";

  if (status === "error" || status === "deleted") return "missing";

  return "sleeping";
}
