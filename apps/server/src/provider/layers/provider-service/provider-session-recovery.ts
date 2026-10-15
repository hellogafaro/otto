/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ThreadId,
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ProviderSession,
} from "@otto/contracts";

import * as Effect from "effect/Effect";

import * as Option from "effect/Option";

import {
  providerMetricAttributes,
  providerSessionsTotal,
  withMetrics,
} from "../../../observability/metrics.ts";
import { type ProviderAdapterError, ProviderValidationError } from "../../errors.ts";
import type { ProviderAdapterShape } from "../../services/provider-adapter.ts";
import * as ProviderAdapterRegistry from "../../services/provider-adapter-registry.ts";

import * as ProviderSessionDirectory from "../../services/provider-session-directory.ts";

import * as McpSessionRegistry from "../../../mcp/mcp-session-registry.ts";

import {
  toValidationError,
  readPersistedModelSelection,
  readPersistedCwd,
} from "./provider-session-mapping.ts";

export function createProviderSessionRecovery(deps: {
  readonly requireBindingInstanceId: (
    operation: string,
    payload: {
      readonly providerInstanceId?: ProviderInstanceId | undefined;
      readonly provider?: ProviderDriverKind | undefined;
    },
  ) => Effect.Effect<ProviderInstanceId, ProviderValidationError>;
  readonly registry: ProviderAdapterRegistry.ProviderAdapterRegistryShape;
  readonly upsertSessionBinding: (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: {
      readonly modelSelection?: unknown;
      readonly lastRuntimeEvent?: string;
      readonly lastRuntimeEventAt?: string;
    },
  ) => Effect.Effect<void, ProviderSessionDirectory.ProviderSessionDirectoryWriteError, never>;
  readonly prepareMcpSession: (
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<McpSessionRegistry.McpIssuedCredential | undefined, never, never>;
  readonly clearMcpSession: (threadId: ThreadId) => Effect.Effect<void, never, never>;
  readonly directory: ProviderSessionDirectory.ProviderSessionDirectoryShape;
  readonly getAdapterEntries: Effect.Effect<
    [ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>][],
    never,
    never
  >;
}) {
  const recoverSessionForThread = Effect.fn("recoverSessionForThread")(function* (input: {
    readonly binding: ProviderSessionDirectory.ProviderRuntimeBinding;
    readonly operation: string;
  }) {
    const bindingInstanceId = yield* deps.requireBindingInstanceId(input.operation, input.binding);
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "recover-session",
      "provider.kind": input.binding.provider,
      "provider.instance_id": bindingInstanceId,
      "provider.thread_id": input.binding.threadId,
    });

    return yield* Effect.gen(function* () {
      const adapter = yield* deps.registry.getByInstance(bindingInstanceId);

      const hasResumeCursor =
        input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;

      const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);

      if (hasActiveSession) {
        const activeSessions = yield* adapter.listSessions();

        const existing = activeSessions.find(
          (session) => session.threadId === input.binding.threadId,
        );

        if (existing) {
          yield* deps.upsertSessionBinding(
            { ...existing, providerInstanceId: bindingInstanceId },
            input.binding.threadId,
          );

          return { adapter, session: existing } as const;
        }
      }

      if (!hasResumeCursor) {
        return yield* toValidationError(
          input.operation,
          `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
        );
      }

      const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
      const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);

      yield* deps.prepareMcpSession(input.binding.threadId, bindingInstanceId);

      const resumed = yield* adapter
        .startSession({
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          providerInstanceId: bindingInstanceId,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          runtimeMode: input.binding.runtimeMode ?? "full-access",
        })
        .pipe(Effect.onError(() => deps.clearMcpSession(input.binding.threadId)));

      if (resumed.provider !== adapter.provider) {
        yield* deps.clearMcpSession(input.binding.threadId);

        return yield* toValidationError(
          input.operation,
          `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
        );
      }

      yield* deps.upsertSessionBinding(
        { ...resumed, providerInstanceId: bindingInstanceId },
        input.binding.threadId,
      );

      return { adapter, session: resumed } as const;
    }).pipe(
      withMetrics({
        counter: providerSessionsTotal,
        attributes: providerMetricAttributes(input.binding.provider, {
          operation: "recover",
        }),
      }),
    );
  });

  const resolveRoutableSession = Effect.fn("resolveRoutableSession")(function* (input: {
    readonly threadId: ThreadId;
    readonly operation: string;
    readonly allowRecovery: boolean;
  }) {
    const bindingOption = yield* deps.directory.getBinding(input.threadId);
    const binding = Option.getOrUndefined(bindingOption);

    if (!binding) {
      return yield* toValidationError(
        input.operation,
        `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
      );
    }

    const instanceId = yield* deps.requireBindingInstanceId(input.operation, binding);
    const adapter = yield* deps.registry.getByInstance(instanceId);

    const hasRequestedSession = yield* adapter.hasSession(input.threadId);

    if (hasRequestedSession) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: true,
      } as const;
    }

    if (!input.allowRecovery) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: false,
      } as const;
    }

    const recovered = yield* recoverSessionForThread({
      binding,
      operation: input.operation,
    });

    return {
      adapter: recovered.adapter,
      instanceId,
      threadId: input.threadId,
      isActive: true,
    } as const;
  });

  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly currentInstanceId: ProviderInstanceId;
  }) {
    const currentAdapters = yield* deps.getAdapterEntries;
    yield* Effect.forEach(
      currentAdapters,
      ([instanceId, adapter]) =>
        instanceId === input.currentInstanceId
          ? Effect.void
          : Effect.gen(function* () {
              const hasSession = yield* adapter.hasSession(input.threadId);

              if (!hasSession) {
                return;
              }

              yield* adapter.stopSession(input.threadId).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("provider.session.stop-stale-failed", {
                    threadId: input.threadId,
                    provider: adapter.provider,
                    cause,
                  }),
                ),
              );
            }),
      { discard: true },
    );
  });

  return { recoverSessionForThread, resolveRoutableSession, stopStaleSessionsForThread };
}
