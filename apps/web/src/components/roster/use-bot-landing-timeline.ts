import { threadDelegations } from "@otto/client-runtime/delegation-presentation";
import { botChatTimeline } from "@otto/client-runtime/state/bot-chat-timeline";
import type {
  OrchestrationShellSnapshot,
  RoutineRun,
  RoutineRunId,
  ScopedThreadRef,
} from "@otto/contracts";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { useEnvironmentQuery } from "../../state/query";
import { routineCacheAtom, withRoutines } from "../../state/routines";
import { serverEnvironment } from "../../state/server";
import type { BotConversationEntry } from "./bot-conversation-presentation";
import { deriveRoutineReceipts, mergeRoutineRunHistory } from "./routine-receipts";

/**
 * Merges a bot chat's messages, routine run notes, and delegations into one ordered
 * timeline. The chat's routines come with its run history and land in the routine cache, which
 * live events keep current; history pages in older notes on request and refreshes when an event
 * changes a run for this chat.
 */
export function useBotLandingTimeline(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly snapshot: OrchestrationShellSnapshot | null;
  readonly entries: ReadonlyArray<BotConversationEntry>;
}) {
  const { entries, snapshot, threadRef } = input;
  const { t } = useI18n();

  const routineRunHistory = useEnvironmentQuery(
    threadRef
      ? serverEnvironment.routineThreadRuns({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );

  const threadId = threadRef?.threadId ?? null;
  const environmentId = threadRef?.environmentId ?? null;
  const registry = useContext(RegistryContext);
  // SAFETY: the empty environment ID is an inactive sentinel; its cache stays empty.
  const cache = useAtomValue(routineCacheAtom(environmentId ?? ("" as never)));

  const [routineHistory, setRoutineHistory] = useState<{
    threadId: string | null;
    runs: RoutineRun[];
    requestedCursor: RoutineRunId | null;
    loadedCursor: RoutineRunId | null;
    nextCursor: RoutineRunId | null;
  }>({ threadId: null, runs: [], requestedCursor: null, loadedCursor: null, nextCursor: null });

  const currentHistory =
    routineHistory.threadId === threadId
      ? routineHistory
      : { threadId, runs: [], requestedCursor: null, loadedCursor: null, nextCursor: null };

  const olderRoutineRuns = useEnvironmentQuery(
    threadRef && currentHistory.requestedCursor
      ? serverEnvironment.routineThreadRuns({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            beforeRunId: currentHistory.requestedCursor,
          },
        })
      : null,
  );

  useEffect(() => {
    setRoutineHistory({
      threadId,
      runs: [],
      requestedCursor: null,
      loadedCursor: null,
      nextCursor: null,
    });
  }, [threadId]);
  useEffect(() => {
    const page = routineRunHistory.data;

    if (!page || !environmentId) return;
    registry.update(routineCacheAtom(environmentId), (current) =>
      withRoutines(current, page.routines, page.receiptSources),
    );
  }, [environmentId, registry, routineRunHistory.data]);
  useEffect(() => {
    const page = routineRunHistory.data;

    if (!page || !threadId) return;
    setRoutineHistory((previous) =>
      previous.threadId === threadId
        ? {
            ...previous,
            runs: mergeRoutineRunHistory(previous.runs, page.runs),
            nextCursor: previous.loadedCursor === null ? page.nextCursor : previous.nextCursor,
          }
        : previous,
    );
  }, [routineRunHistory.data, threadId]);
  useEffect(() => {
    const page = olderRoutineRuns.data;
    const cursor = currentHistory.requestedCursor;

    if (!page || !cursor || currentHistory.loadedCursor === cursor) return;
    setRoutineHistory((previous) =>
      previous.threadId === threadId && previous.requestedCursor === cursor
        ? {
            ...previous,
            runs: mergeRoutineRunHistory(previous.runs, page.runs),
            loadedCursor: cursor,
            nextCursor: page.nextCursor,
          }
        : previous,
    );
  }, [
    currentHistory.loadedCursor,
    currentHistory.requestedCursor,
    olderRoutineRuns.data,
    threadId,
  ]);

  const nextRoutineCursor =
    currentHistory.loadedCursor === null
      ? (routineRunHistory.data?.nextCursor ?? null)
      : currentHistory.nextCursor;

  const threadRoutines = useMemo(
    () =>
      [...cache.routines.values(), ...cache.receiptSources.values()].filter(
        (routine) => routine.targetThreadId === threadId,
      ),
    [cache.routines, cache.receiptSources, threadId],
  );

  const routineRunRevision = useMemo(() => {
    if (!threadId) return null;

    const relevantIds = new Set(threadRoutines.map((routine) => routine.id));

    const runs = [...cache.runs.values()]
      .flatMap((run) => (relevantIds.has(run.routineId) ? [[run.id, run.updatedAt] as const] : []))
      .toSorted(([left], [right]) => left.localeCompare(right));

    return JSON.stringify(runs);
  }, [threadId, threadRoutines, cache.runs]);

  const observedRoutineRevision = useRef<{
    threadId: string | null;
    revision: string | null;
  }>({ threadId: null, revision: null });

  useEffect(() => {
    const threadId = threadRef?.threadId ?? null;
    const previous = observedRoutineRevision.current;
    observedRoutineRevision.current = { threadId, revision: routineRunRevision };

    if (threadId === previous.threadId && routineRunRevision !== previous.revision) {
      routineRunHistory.refresh();
    }
  }, [threadRef?.threadId, routineRunRevision, routineRunHistory.refresh]);

  const routineReceipts = useMemo(
    () =>
      threadRef
        ? deriveRoutineReceipts(
            threadRef.threadId,
            threadRoutines,
            mergeRoutineRunHistory(currentHistory.runs, [...cache.runs.values()]),
            { t },
          )
        : [],
    [threadRef, threadRoutines, cache.runs, currentHistory.runs, t],
  );

  const { delegations, waitingOnChildren } = useMemo(
    () =>
      threadRef && snapshot
        ? threadDelegations(snapshot.delegations, threadRef.threadId)
        : { delegations: [], waitingOnChildren: false },
    [threadRef, snapshot],
  );

  // Each message row carries the index it had in `messages`, because the merge
  // reorders it away from that position and a row must not go looking for itself.
  const timelineItems = useMemo(
    () =>
      botChatTimeline({
        messages: entries.map((entry) => ({
          id: entry.message.id,
          turnId: entry.message.turnId,
          createdAt: entry.message.createdAt,
          entry,
        })),
        receipts: routineReceipts,
        delegations,
      }),
    [entries, routineReceipts, delegations],
  );

  const loadOlderRoutineNotes = () => {
    if (currentHistory.requestedCursor === nextRoutineCursor) {
      olderRoutineRuns.refresh();
    } else {
      setRoutineHistory((previous) => ({
        ...previous,
        requestedCursor: nextRoutineCursor,
      }));
    }
  };

  return {
    timelineItems,
    delegations,
    waitingOnChildren,
    olderRoutineNotes: {
      nextCursor: nextRoutineCursor,
      isPending: olderRoutineRuns.isPending,
      error: olderRoutineRuns.error,
      load: loadOlderRoutineNotes,
    },
  };
}
