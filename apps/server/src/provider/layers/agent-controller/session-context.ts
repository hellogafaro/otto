import { type BotId, ThreadId, type OttoDelegationRecord } from "@otto/contracts";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { isWorkerThreadId } from "../../otto-worker-runtime.ts";

import type { SessionLifecycleDependencies } from "./session-lifecycle-dependencies.ts";

export function createSessionContext(
  deps: Pick<SessionLifecycleDependencies, "projectionSnapshotQuery" | "workerRuntime" | "wired">,
) {
  const isOpenDelegation = (delegation: OttoDelegationRecord) =>
    !["Completed", "Failed", "Canceled"].includes(delegation.phase._tag);

  const isChildOf = (delegation: OttoDelegationRecord, threadId: ThreadId) =>
    "childThreadId" in delegation.phase && delegation.phase.childThreadId === threadId;

  // Resolves the thread's bot, group boss, and delegation links with by-id
  // reads. Falls back to the command read model for query doubles that do
  // not implement the narrow lookups.
  const readSessionStartContext = Effect.fn("AgentController.readSessionStartContext")(function* (
    threadId: ThreadId,
    fallbackBotId: BotId | null,
  ) {
    if (Option.isNone(deps.projectionSnapshotQuery)) {
      return {
        parentDelegation: undefined,
        bot: undefined,
        botId: fallbackBotId,
        activeChildDelegations: 0,
      };
    }

    const query = deps.projectionSnapshotQuery.value;
    const { getBotById, getGroupById, listThreadDelegations } = query;

    if (getBotById && getGroupById && listThreadDelegations) {
      const thread = Option.getOrUndefined(yield* query.getThreadRuntimeContext(threadId));
      const delegations = (yield* listThreadDelegations(threadId)).filter(isOpenDelegation);

      const group = thread?.groupId
        ? Option.getOrUndefined(yield* getGroupById(thread.groupId))
        : undefined;

      const botId =
        thread?.respondingBotId ?? thread?.botId ?? fallbackBotId ?? group?.bossBotId ?? null;

      const bot = botId ? Option.getOrUndefined(yield* getBotById(botId)) : undefined;
      const workerParentThreadId = isWorkerThreadId(threadId) ? thread?.parentThreadId : null;

      return {
        parentDelegation: delegations.find((candidate) => isChildOf(candidate, threadId)),
        workerParent: workerParentThreadId
          ? {
              delegatedAccess: (yield* listThreadDelegations(workerParentThreadId)).find(
                (candidate) => isChildOf(candidate, workerParentThreadId),
              )?.access,
            }
          : undefined,
        bot,
        botId,
        activeChildDelegations: delegations.filter(
          (candidate) => candidate.parentThreadId === threadId,
        ).length,
      };
    }

    const snapshot = yield* query.getCommandReadModel();
    const thread = snapshot.threads.find((candidate) => candidate.id === threadId);

    const group = thread?.groupId
      ? snapshot.groups.find((candidate) => candidate.id === thread.groupId)
      : undefined;

    const botId =
      thread?.respondingBotId ?? thread?.botId ?? fallbackBotId ?? group?.bossBotId ?? null;

    const workerParentThreadId = isWorkerThreadId(threadId) ? thread?.parentThreadId : null;

    return {
      parentDelegation: snapshot.delegations.find(
        (candidate) => isChildOf(candidate, threadId) && isOpenDelegation(candidate),
      ),
      workerParent: workerParentThreadId
        ? {
            delegatedAccess: snapshot.delegations.find((candidate) =>
              isChildOf(candidate, workerParentThreadId),
            )?.access,
          }
        : undefined,
      bot: snapshot.bots.find((candidate) => candidate.id === botId),
      botId,
      activeChildDelegations: snapshot.delegations.filter(
        (candidate) => candidate.parentThreadId === threadId && isOpenDelegation(candidate),
      ).length,
    };
  });

  return { isOpenDelegation, isChildOf, readSessionStartContext };
}
