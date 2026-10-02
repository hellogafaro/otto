import type { Database, Transaction } from "@otto/db";
import { type Context, requireAdmin } from "@otto/workspaces";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { operations } from "./schema";

const RECOVERY_BATCH_SIZE = 100;
const STALE_CLAIM_MS = 120_000;

function getRecoveryClaims(
  db: Database | Transaction,
  cutoff: Date,
  workspaceId?: string,
) {
  return db
    .select({
      id: operations.id,
      workspaceId: operations.workspaceId,
      executionToken: operations.executionToken,
      startedAt: operations.startedAt,
    })
    .from(operations)
    .where(
      and(
        eq(operations.state, "executing"),
        lt(operations.startedAt, cutoff),
        workspaceId ? eq(operations.workspaceId, workspaceId) : undefined,
      ),
    )
    .orderBy(operations.startedAt, operations.id)
    .limit(RECOVERY_BATCH_SIZE + 1);
}

/** Caller holds the workspace mutation lock. Recheck the observed claim after acquiring it. */
async function recoverClaim(
  tx: Transaction,
  claim: Awaited<ReturnType<typeof getRecoveryClaims>>[number],
  cutoff: Date,
) {
  if (!claim.startedAt) return 0;
  const fence = and(
    eq(operations.id, claim.id),
    eq(operations.workspaceId, claim.workspaceId),
    eq(operations.state, "executing"),
    claim.executionToken === null
      ? isNull(operations.executionToken)
      : eq(operations.executionToken, claim.executionToken),
    eq(operations.startedAt, claim.startedAt),
    lt(operations.startedAt, cutoff),
  );
  const [row] = await tx.select().from(operations).where(fence);
  if (!row) return 0;
  const now = new Date();
  const changed = await tx
    .update(operations)
    .set({
      state: row.isWrite ? "uncertain" : "failed",
      outcome: "execution_interrupted",
      executionToken: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(fence)
    .returning({ id: operations.id });
  return changed.length;
}

/** Human recovery retains administrator authorization and the existing workspace transaction. */
export async function recoverOperations(c: Context) {
  requireAdmin(c);
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const claims = await getRecoveryClaims(c.tx, cutoff, c.workspaceId);
  let recovered = 0;
  for (const claim of claims.slice(0, RECOVERY_BATCH_SIZE))
    recovered += await recoverClaim(c.tx, claim, cutoff);
  return { recovered };
}

/** Server recovery requires no surviving sponsor. It only retires stale claims; never performs I/O or publishes. */
export async function recoverConnectionOperations(db: Database) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const claims = await getRecoveryClaims(db, cutoff);
  let recovered = 0;
  for (const claim of claims.slice(0, RECOVERY_BATCH_SIZE)) {
    recovered += await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from workspaces where id = ${claim.workspaceId} for update`,
      );
      return recoverClaim(tx, claim, cutoff);
    });
  }
  return { recovered, hasMore: claims.length > RECOVERY_BATCH_SIZE };
}
