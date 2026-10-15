import type { AuthSessionState } from "@otto/contracts";
import * as Effect from "effect/Effect";
import { PrimaryEnvironmentHttpClient } from "./httpClient";
import { runPrimaryHttp } from "../../lib/runtime";
import { PrimaryEnvironmentRequestError, isPrimaryEnvironmentRequestError } from "./authErrors";

export async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientBootstrap(async () => {
    try {
      return await runPrimaryHttp(
        PrimaryEnvironmentHttpClient.pipe(
          Effect.flatMap((client) => client.auth.session({ headers: {} })),
        ),
      );
    } catch (error) {
      throw PrimaryEnvironmentRequestError.fromCause({
        operation: "fetch-session-state",
        cause: error,
      });
    }
  });
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);

const BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;

const BOOTSTRAP_RETRY_STEP_MS = 500;

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isTransientBootstrapError(cause: unknown): boolean {
  if (isPrimaryEnvironmentRequestError(cause)) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(cause.status);
  }

  if (cause instanceof TypeError) {
    return true;
  }

  return cause instanceof DOMException && cause.name === "AbortError";
}
