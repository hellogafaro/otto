import type { VercelSandbox } from "@mastra/vercel";
import { type OttoWorkspaceState, type OttoRemoteSession } from "../bot-workspace-types.ts";
import { credential } from "../bot-workspace-lifecycle.ts";
import { mastraSession } from "./mastra.ts";

export function vercelCredentials(environment: Readonly<Record<string, string>>) {
  return {
    token: credential(environment, "VERCEL_TOKEN"),
    teamId: credential(environment, "VERCEL_TEAM_ID"),
    projectId: credential(environment, "VERCEL_PROJECT_ID"),
  };
}

export function vercelWorkspaceState(
  status: import("@vercel/sandbox").Sandbox["status"],
): OttoWorkspaceState {
  if (status === "running") return "running";

  if (status === "failed" || status === "aborted") return "missing";

  return "sleeping";
}

export function vercel(
  sandbox: VercelSandbox,
  credentials: ReturnType<typeof vercelCredentials>,
): OttoRemoteSession {
  const providerId = sandbox.sandbox.name;

  return mastraSession(sandbox, {
    providerId,
    inspect: async () => {
      const { Sandbox } = await import("@vercel/sandbox");

      return vercelWorkspaceState(
        (await Sandbox.get({ name: providerId, resume: false, ...credentials })).status,
      );
    },
    browserEndpoint: async (port) => {
      const current = sandbox.sandbox;

      if (!current.routes.some((route) => route.port === port)) {
        await current.update({ ports: [...current.routes.map((route) => route.port), port] });
      }

      return { url: current.domain(port), requestHeaders: {} };
    },
  });
}
