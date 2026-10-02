import { validateAutomation } from "@otto/automations";
import type { RunProof } from "@otto/connections";
import {
  type ConnectionBoundary,
  createConnectionService,
} from "@otto/connections/server";
import { createMessage } from "@otto/conversations";
import type { Database } from "@otto/db";
import { getRun } from "@otto/runs";
import { assertRunAttempt } from "@otto/runs/runtime";
import { DomainError } from "@otto/shared";

import { type Actor, type Context, inWorkspace } from "@otto/workspaces";

export type ConnectionOptions = Omit<
  Parameters<typeof createConnectionService>[0],
  "boundary"
>;
/** Validates persisted execution identity, not a browser-supplied Agent or sponsor. */
export async function validateConnectionRun(c: Context, proof: RunProof) {
  const view = await getRun(c, proof.runId);
  const run = await assertRunAttempt(
    c,
    { ...proof, agentId: view.agentId },
    validateAutomation,
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
    validateRun: validateConnectionRun,
    async publishResult(c, result) {
      const run = await getRun(c, result.runId);
      const body = JSON.stringify({
        connectionId: result.connectionId,
        action: result.action,
        target: result.target,
        result: result.value,
      });
      if (Buffer.byteLength(body) > 100000)
        throw new DomainError(
          "unavailable",
          "Shared tool result exceeds message limit",
        );
      await createMessage(
        { ...c, actor: { userId: c.actor.userId, agentId: run.agentId } },
        run.conversationId,
        { requestId: result.operationId, body },
      );
    },
  };
  return createConnectionService({ ...options, boundary });
}
