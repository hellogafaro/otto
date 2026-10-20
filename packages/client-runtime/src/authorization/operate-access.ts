import { AuthOrchestrationOperateScope, type AuthSessionState } from "@otto/contracts";

/**
 * Whether the session may change environment state on an environment.
 * `pending` means the answer is still unknown, which must not be presented as
 * editable: rendering controls we already know might be rejected only turns a
 * permission problem into a failed write.
 */
export type OperateAccess = "granted" | "denied" | "pending";

/**
 * Resolve operate access from an environment's `/api/auth/session` answer.
 *
 * Cached session data wins over an in-flight revalidation. The session atoms
 * are SWR-backed, so they report `isPending` on every background refresh;
 * treating that as unknown would flip a working panel back to loading and
 * discard in-progress edits.
 *
 * The primary serves the web app itself, so its server always reports scopes;
 * a resolved session without them is denied. The environment RPC layer stays
 * authoritative either way.
 */
function resolveSessionOperateAccess(input: {
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): OperateAccess {
  if (input.session === null) {
    if (input.isPending) {
      return "pending";
    }

    // A failed session fetch is a transport problem, not a permission
    // decision — locking the panel read-only would misreport it. Stay
    // optimistic; the environment RPC layer still rejects unauthorized writes.
    return input.hasError ? "granted" : "denied";
  }

  if (!input.session.authenticated) {
    return "denied";
  }

  return input.session.scopes?.includes(AuthOrchestrationOperateScope) ? "granted" : "denied";
}

/** Operate access for the primary environment's own browser session. */
export function resolvePrimaryOperateAccess(input: {
  readonly isPrimary: boolean;
  readonly hasDesktopBridge: boolean;
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): OperateAccess {
  if (!input.isPrimary || input.hasDesktopBridge) {
    return "granted";
  }

  return resolveSessionOperateAccess({
    session: input.session,
    isPending: input.isPending,
    hasError: input.hasError,
  });
}
