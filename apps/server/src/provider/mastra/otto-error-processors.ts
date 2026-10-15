import * as Predicate from "effect/Predicate";
import {
  isBadRequestError,
  PrefillErrorHandler,
  ProviderHistoryCompat,
  StreamErrorRetryProcessor,
  type ErrorProcessor,
} from "@mastra/core/processors";

import { controllerResourceId } from "./otto-memory.ts";

export function isConnectionReset(cause: unknown): boolean {
  if (!cause) return false;
  const code = Predicate.isObjectOrArray(cause) && "code" in cause ? cause.code : undefined;

  if (Predicate.isString(code) && code.toUpperCase() === "ECONNRESET") return true;

  return cause instanceof Error && /econnreset|socket hang up/i.test(cause.message);
}

/**
 * The stream retry policy `createCodingAgent` applies by default. Otto builds
 * its Agent directly because `createCodingAgent` also adds a task-list tool
 * whenever memory is on, and each list update costs a full model round trip.
 */
export function ottoErrorProcessors(
  onRetry?: (threadId: string) => void,
): ReadonlyArray<ErrorProcessor> {
  const streamRetry = new StreamErrorRetryProcessor({
    retryUnknownErrors: true,
    maxRetries: 2,
    delayMs: 3_000,
    matchers: [
      { match: isBadRequestError, maxRetries: 1, delayMs: 2_000 },
      {
        match: isConnectionReset,
        maxRetries: 2,
        delayMs: ({ retryCount }) => Math.min(1_000 * 2 ** retryCount, 30_000),
      },
    ],
  });

  return [
    {
      id: streamRetry.id,
      name: streamRetry.name,
      processAPIError: async (args) => {
        const result = await streamRetry.processAPIError(args);
        const threadId = args.requestContext && controllerResourceId(args.requestContext);

        if (result?.retry && threadId) onRetry?.(threadId);

        return result;
      },
    },
    new PrefillErrorHandler(),
    new ProviderHistoryCompat(),
  ];
}
