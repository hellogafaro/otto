import * as Predicate from "effect/Predicate";
import type { RailwaySandbox } from "@mastra/railway";
import { credential } from "../bot-workspace-lifecycle.ts";
import { type OttoRemoteSession, type OttoWorkspaceState } from "../bot-workspace-types.ts";
import { mastraSession } from "./mastra.ts";

export interface RailwayCredentials {
  readonly token: string;
  readonly environmentId: string;
  readonly authType: "bearer" | "project-token";
}

/**
 * Railway accepts account and workspace tokens as a bearer and project tokens in their own
 * header, and the token alone does not say which it is, so ask Railway once.
 */
export async function railwayCredentials(
  environment: Readonly<Record<string, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<RailwayCredentials> {
  const token = credential(environment, "RAILWAY_API_TOKEN");
  const environmentId = credential(environment, "RAILWAY_ENVIRONMENT_ID");

  const response = await fetchImpl("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "content-type": "application/json", "project-access-token": token },
    body: JSON.stringify({ query: "{ projectToken { environmentId } }" }),
  });

  const body: unknown = await response.json().catch(() => undefined);

  const projectToken =
    Predicate.hasProperty(body, "data") &&
    Predicate.hasProperty(body.data, "projectToken") &&
    Predicate.isNotNullish(body.data.projectToken);

  return { token, environmentId, authType: projectToken ? "project-token" : "bearer" };
}

export function railway(
  sandbox: RailwaySandbox,
  credentials: RailwayCredentials,
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
