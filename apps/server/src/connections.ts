import type { RunProof } from "@otto/connections";
import {
  type ConnectionBoundary,
  createConnectionService,
} from "@otto/connections/server";
import type { Database } from "@otto/db";
import { getRun } from "@otto/runs";
import { assertRunAttempt } from "@otto/runs/runtime";
import { validateSchedule } from "@otto/schedules";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError } from "@otto/shared";
import { type Actor, type Context, inWorkspace } from "@otto/workspaces";
import { authorizeRunSources } from "./run-sources";

export type ConnectionOptions = Omit<
  Parameters<typeof createConnectionService>[0],
  "boundary"
> & { native?: NativeSessionStorage };
/** Validates persisted execution identity, not a browser-supplied Agent or sponsor. */
export async function validateConnectionRun(
  c: Context,
  proof: RunProof,
  native?: NativeSessionStorage,
) {
  const view = await getRun(c, proof.runId);
  const run = await assertRunAttempt(
    c,
    { ...proof, agentId: view.agentId },
    validateSchedule,
    native,
    authorizeRunSources,
  );
  if (run.environmentGeneration !== proof.environmentGeneration)
    throw new DomainError("forbidden", "Stale Environment");
  // assertRunAttempt compares the entire current grant snapshot with the accepted
  // snapshot, including approval policies and recipients. Current grants cannot widen it.
  return { agentId: run.agentId, audience: run.inputs.audience };
}
/** One request-scoped boundary; it cannot switch the authenticated workspace or actor. */
export function connectionService(
  db: Database,
  workspaceId: string,
  actor: Actor,
  options: ConnectionOptions,
) {
  const boundary: ConnectionBoundary = {
    transact: (work) => inWorkspace(db, workspaceId, actor, work),
    validateRun: (c, proof) => validateConnectionRun(c, proof, options.native),
  };
  return createConnectionService({ ...options, boundary });
}
