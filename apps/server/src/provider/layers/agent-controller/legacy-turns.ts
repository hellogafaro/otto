import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";

import { type ProviderRuntimeEvent, ThreadId } from "@otto/contracts";

import * as Effect from "effect/Effect";

import type { OttoControllerHarness } from "../../mastra/otto-harness-types.ts";

import { type OttoDelegationChildOutcome } from "../../otto-delegation-runtime.ts";

import { type LegacyTurnMemoryState } from "./state.ts";

/** Settles turns other providers ran and stores them in the chat's one history. */
export function createLegacyTurns(deps: {
  readonly forkPromise: OttoRuntimeSeam["forkPromise"];
  readonly hasLegacyPending: (key: string, pending: LegacyTurnMemoryState) => boolean;
  readonly resolveChildWaiter: (threadId: ThreadId, outcome: OttoDelegationChildOutcome) => void;
  readonly removeLegacyPending: (key: string, pending: LegacyTurnMemoryState) => void;
  readonly legacyPending: (key: string) => LegacyTurnMemoryState[];
  readonly bundle: OttoControllerHarness;
  readonly legacyBufferedTerminals: Map<string, Map<string, ProviderRuntimeEvent>>;
}) {
  const settleLegacyTurnMemory = (
    key: string,
    pending: LegacyTurnMemoryState,
    event: ProviderRuntimeEvent,
  ) =>
    Effect.sync(() => {
      if (!deps.hasLegacyPending(key, pending)) return;

      const foregroundSucceeded =
        event.type === "turn.completed" && event.payload.state === "completed";

      // Delegated children on legacy providers report back through the same waiter as Mastra.
      const assistantText = pending.assistant.trim();
      deps.resolveChildWaiter(ThreadId.make(key), {
        state: foregroundSucceeded ? "completed" : "failed",
        turnId: event.turnId ?? null,
        ...(foregroundSucceeded && assistantText
          ? { summary: assistantText }
          : {
              error:
                (event.type === "turn.completed" ? event.payload.errorMessage : undefined) ??
                "The delegated turn did not finish.",
            }),
      });

      if (!foregroundSucceeded) {
        deps.removeLegacyPending(key, pending);

        return;
      }

      const mergedPrompts = deps
        .legacyPending(key)
        .filter((entry) => entry.turnId !== undefined && entry.turnId === pending.turnId);

      if (
        mergedPrompts[0] === pending &&
        !pending.persisted &&
        mergedPrompts.some((entry) => entry.assistant.trim()) &&
        deps.bundle.persistExternalTurn
      ) {
        for (const entry of mergedPrompts) entry.persisted = true;

        const assistant = mergedPrompts
          .map((entry) => entry.assistant)
          .toSorted((left, right) => right.length - left.length)[0]!;

        const persistExternalTurn = deps.bundle.persistExternalTurn;
        const turnId = pending.turnId ?? `legacy-${event.eventId}`;
        deps.forkPromise(
          "Otto could not store another provider's turn.",
          () =>
            persistExternalTurn({
              threadId: key,
              turnId,
              modelId: pending.modelId,
              userMessages: mergedPrompts.map((entry) => ({
                id: entry.promptId,
                text: entry.user,
              })),
              assistant,
              createdAt: event.createdAt,
            }),
          { annotations: { threadId: key, turnId } },
        );
      }

      deps.removeLegacyPending(key, pending);
    });

  const drainLegacyTerminals = (key: string) =>
    Effect.gen(function* () {
      const pendingTurns = deps.legacyPending(key);

      if (pendingTurns.some((pending) => !pending.dispatchReturned)) return;
      const terminals = deps.legacyBufferedTerminals.get(key);

      if (!terminals) return;

      for (const [turnId, terminal] of terminals) {
        const matching = deps.legacyPending(key).filter((pending) => pending.turnId === turnId);

        for (const pending of matching) {
          yield* settleLegacyTurnMemory(key, pending, terminal);
        }

        terminals.delete(turnId);
      }

      if (terminals.size === 0) deps.legacyBufferedTerminals.delete(key);
    });

  return {
    settleLegacyTurnMemory,
    drainLegacyTerminals,
  };
}
