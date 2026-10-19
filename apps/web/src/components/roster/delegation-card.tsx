import { isTagged } from "../tagged";
import type { OttoDelegationRecord, OrchestrationThreadActivity } from "@otto/contracts";
import {
  type DelegationAction,
  delegationActions,
  delegationElapsedMs,
  presentDelegation,
} from "@otto/client-runtime/delegation-presentation";
import { formatDuration } from "@otto/shared/orchestrationTiming";
import { useState, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { deriveLatestContextWindowSnapshot } from "../../lib/context-window";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { BotAvatarView } from "./bot-avatar-view";
import { DelegationDetail } from "./delegation-detail";
import { useDelegationClock } from "./delegation-clock";
import type { Bot } from "./types";

export function delegationUsageTokens(
  delegation: OttoDelegationRecord,
  childActivities: ReadonlyArray<OrchestrationThreadActivity>,
): number | null {
  const childTurnId = isTagged(delegation.phase, "Queued") ? null : delegation.phase.childTurnId;

  if (!childTurnId) return null;
  const activities = childActivities.filter((activity) => activity.turnId === childTurnId);
  const usage = deriveLatestContextWindowSnapshot(activities);

  return usage?.totalProcessedTokens ?? usage?.usedTokens ?? null;
}

/**
 * The reverse-state controls for one piece of bot work. Only the moves
 * `delegationActions` allows show: Let it finish and Cancel while the work is
 * live, Try again once it failed or was canceled and has not been retried yet.
 * Every button stays disabled
 * while a command is in flight.
 */
function DelegationActions({
  delegation,
  delegations,
  childName,
}: {
  readonly delegation: OttoDelegationRecord;
  readonly delegations: ReadonlyArray<OttoDelegationRecord>;
  readonly childName: string;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const [pending, setPending] = useState<DelegationAction | null>(null);

  const cancelDelegation = useAtomCommand(orchestrationEnvironment.cancelDelegation, {
    reportFailure: false,
  });

  const retryDelegation = useAtomCommand(orchestrationEnvironment.retryDelegation, {
    reportFailure: false,
  });

  const actions = delegationActions(delegation, delegations);

  if (environmentId === null || actions.length === 0) return null;

  const run = (action: DelegationAction) => {
    const { delegationId } = delegation;
    setPending(action);

    const request =
      action === "retry"
        ? retryDelegation({ environmentId, input: { delegationId } })
        : cancelDelegation({ environmentId, input: { delegationId, keep: action === "keep" } });

    return request
      .then((result) => {
        if (isTagged(result, "Failure")) toast.error(actionCopy(action, t, childName).failure);
      })
      .finally(() => setPending(null));
  };

  return actions.map((action) => {
    const copy = actionCopy(action, t, childName);

    return (
      <Button
        key={action}
        size="xs"
        variant="ghost-muted"
        disabled={pending !== null}
        aria-busy={pending === action || undefined}
        aria-label={copy.ariaLabel}
        onClick={() => run(action)}
      >
        {copy.label}
      </Button>
    );
  });
}

type Translate = ReturnType<typeof useI18n>["t"];

function actionCopy(action: DelegationAction, t: Translate, name: string) {
  switch (action) {
    case "keep":
      return {
        label: t("Let it finish"),
        ariaLabel: t("Let {name} finish the work", { name }),
        failure: t("Work couldn't be kept running"),
      };
    case "cancel":
      return {
        label: t("Cancel"),
        ariaLabel: t("Cancel delegation to {name}", { name }),
        failure: t("Delegation couldn't be cancelled"),
      };
    case "retry":
      return {
        label: t("Try again"),
        ariaLabel: t("Ask {name} to try again", { name }),
        failure: t("Work couldn't be retried"),
      };
  }
}

/**
 * Otto: One piece of delegated work in the parent chat is a single small line: the child's
 * avatar and "Radar · Working for 26s" while it runs (same shimmer as a bot's own turn), then
 * "New message from Radar · 1m 17s". The line opens the read-only agent-to-agent chat; the
 * task, result and access live there, not in the thread.
 *
 * The actions slot defaults to the reverse-state controls (let it finish,
 * cancel, try again); a caller can pass `actions` to replace them.
 * `variant="group"` names the bot that asked, because a group room has several
 * bots who can delegate. `delegations` is the chat's full list, so a card that
 * was already retried stops offering Try again.
 */
export function DelegationCard({
  delegation,
  delegations,
  childBot,
  parentBot,
  variant = "bot",
  actions,
}: {
  readonly delegation: OttoDelegationRecord;
  readonly delegations: ReadonlyArray<OttoDelegationRecord>;
  readonly childBot: Bot | null;
  readonly parentBot: Bot | null;
  readonly variant?: "bot" | "group";
  readonly actions?: ReactNode;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const [detailOpen, setDetailOpen] = useState(false);
  const presentation = presentDelegation(delegation);

  const activeChildBot = childBot?.archivedAt === null ? childBot : null;
  const state = presentation.state;
  const childName = activeChildBot?.name ?? t("Unknown bot");
  const now = useDelegationClock(!presentation.terminal);
  const elapsed = delegationElapsedMs(delegation, now);
  const duration = elapsed === null ? null : formatDuration(elapsed);
  const working = !presentation.terminal;

  const line = working
    ? t("Working for {duration}", { duration: duration ?? "0s" })
    : t("New message from {name}", { name: childName });

  return (
    <article
      aria-label={t("Delegation to {name}", { name: childName })}
      className="group/delegation mt-2 ml-10 flex max-w-min-42rem-pct-2.5rem items-center gap-1"
      data-testid="delegation-card"
      data-delegation-id={delegation.delegationId}
      data-delegation-state={state}
      data-variant={variant}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground hover:bg-foreground/5"
        aria-label={t("View {name}'s work", { name: childName })}
        disabled={presentation.childThreadId === null || environmentId === null}
        onClick={() => setDetailOpen(true)}
      >
        <BotAvatarView
          avatar={activeChildBot?.avatar ?? { kind: "dither", seed: delegation.childBotId }}
          name={childName}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 truncate">
          {working ? (
            <>
              <span className="font-medium text-foreground">{childName}</span>
              <span> · </span>
              <span className="shimmer motion-reduce:shimmer-none">{line}</span>
            </>
          ) : (
            <>
              {line}
              {duration ? <span className="tabular-nums"> · {duration}</span> : null}
            </>
          )}
        </span>
      </button>
      <div
        className="flex items-center opacity-0 group-hover/delegation:opacity-100"
        data-delegation-actions
      >
        {actions ?? (
          <DelegationActions
            delegation={delegation}
            delegations={delegations}
            childName={childName}
          />
        )}
      </div>
      {detailOpen ? (
        <DelegationDetail
          delegation={delegation}
          childBot={childBot}
          parentBot={parentBot}
          onOpenChange={setDetailOpen}
        />
      ) : null}
    </article>
  );
}
