import { Predicate } from "effect";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { ApprovalRequestId, ProviderApprovalDecision, ScopedThreadRef } from "@otto/contracts";
import { useCallback, useMemo, useRef, useState } from "react";

import { deriveApprovalRecords } from "../../session-logic";
import { useThreadActivities } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function rosterApprovalResponseKey(
  threadRef: ScopedThreadRef,
  requestId: ApprovalRequestId,
): string {
  return JSON.stringify([threadRef.environmentId, threadRef.threadId, requestId]);
}

const IDLE = { responding: false, error: null } as const;

/**
 * Every approval the chat asked for, each answered on its own: answered ones keep their
 * resolution so the transcript shows them in place, and a response in flight or a failed one
 * belongs to its own request only.
 */
export function useRosterApprovals(threadRef: ScopedThreadRef | null) {
  const activities = useThreadActivities(threadRef);
  const approvals = useMemo(() => deriveApprovalRecords(activities), [activities]);
  const pending = useMemo(() => approvals.filter((approval) => !approval.resolution), [approvals]);

  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });

  const respondingRef = useRef(new Set<string>());

  const [responses, setResponses] = useState<
    ReadonlyMap<string, { readonly responding: boolean; readonly error: string | null }>
  >(() => new Map());

  const respond = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision): Promise<boolean> => {
      if (!threadRef) return false;
      const responseKey = rosterApprovalResponseKey(threadRef, requestId);

      if (respondingRef.current.has(responseKey)) return false;
      respondingRef.current.add(responseKey);
      setResponses((current) =>
        new Map(current).set(responseKey, { responding: true, error: null }),
      );
      let error: string | null = null;

      try {
        const result = await respondToApproval({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, requestId, decision },
        });

        if (Predicate.isTagged(result, "Failure")) {
          const cause = squashAtomCommandFailure(result);
          error = cause instanceof Error ? cause.message : "Could not answer approval.";

          return false;
        }

        return true;
      } finally {
        respondingRef.current.delete(responseKey);
        setResponses((current) => {
          const next = new Map(current);

          if (error) next.set(responseKey, { responding: false, error });
          else next.delete(responseKey);

          return next;
        });
      }
    },
    [respondToApproval, threadRef],
  );

  const responseFor = (requestId: ApprovalRequestId) =>
    (threadRef ? responses.get(rosterApprovalResponseKey(threadRef, requestId)) : undefined) ??
    IDLE;

  return { approvals, pending, respond, responseFor };
}
