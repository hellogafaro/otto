/**
 * How long to wait before the next automatic wake after a recoverable death
 * (server restart, killed process, out of memory, provider drop).
 *
 * Attempt 0 runs as soon as the server is back. Later attempts wait longer so
 * a sick provider is not hammered. A null delay means the ladder is exhausted
 * and the chat should say the run stopped.
 */
export const RECOVERY_BACKOFF_MS = [0, 15_000, 30_000, 60_000, 120_000] as const;

export const RECOVERY_MAX_ATTEMPTS = RECOVERY_BACKOFF_MS.length;

/** Persisted on the turn so a second restart does not start the ladder over. */
export const RECOVERY_ATTEMPT_KIND = "provider.recovery.attempt";

export const RECOVERY_GIVE_UP_DETAIL =
  "Automatic recovery failed. Use Resume to continue.";

export function recoveryBackoffDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= RECOVERY_BACKOFF_MS.length) {
    return null;
  }

  return RECOVERY_BACKOFF_MS[attempt] ?? null;
}

export function countRecoveryAttempts(
  activities: ReadonlyArray<{ readonly kind: string; readonly turnId: string | null }>,
  turnId: string | null,
): number {
  return activities.filter(
    (activity) =>
      activity.kind === RECOVERY_ATTEMPT_KIND &&
      (turnId === null || activity.turnId === turnId),
  ).length;
}

export function recoveryFailureDetail(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("detail" in payload)) {
    return null;
  }

  const detail = payload.detail;

  return typeof detail === "string" && detail.trim().length > 0 ? detail : null;
}
