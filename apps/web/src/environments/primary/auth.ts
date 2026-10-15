import type { AuthSessionState } from "@otto/contracts";
import { fetchSessionState } from "./auth-bootstrap";

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;

let resolvedAuthenticatedGateState: ServerAuthGateState | null = null;

// Otto: People sign in with an organization account; there is no pairing token to exchange.
async function bootstrapServerAuth(): Promise<ServerAuthGateState> {
  const currentSession = await fetchSessionState();

  return currentSession.authenticated
    ? { status: "authenticated" }
    : { status: "requires-auth", auth: currentSession.auth };
}

export async function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  if (resolvedAuthenticatedGateState?.status === "authenticated") {
    return resolvedAuthenticatedGateState;
  }

  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const nextPromise = bootstrapServerAuth();
  bootstrapPromise = nextPromise;

  return nextPromise
    .then((result) => {
      if (result.status === "authenticated") {
        resolvedAuthenticatedGateState = result;
      }

      return result;
    })
    .finally(() => {
      if (bootstrapPromise === nextPromise) {
        bootstrapPromise = null;
      }
    });
}

// Used by the WSL backend swap: invalidate the cached authenticated state so the next
// WS reconnect re-reads the session instead of starting a reauth loop.
export async function reauthenticatePrimaryEnvironment(): Promise<ServerAuthGateState> {
  resolvedAuthenticatedGateState = null;
  bootstrapPromise = null;

  return resolveInitialServerAuthGateState();
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  resolvedAuthenticatedGateState = null;
}

export { PrimaryEnvironmentRequestError, isPrimaryEnvironmentRequestError } from "./auth-errors";

export {
  type ServerClientSessionRecord,
  listServerClientSessions,
  revokeServerClientSession,
  revokeOtherServerClientSessions,
} from "./auth-administration";

export { fetchSessionState, retryTransientBootstrap } from "./auth-bootstrap";
