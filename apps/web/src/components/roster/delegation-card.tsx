import { Match } from "effect";
import { isTagged } from "../tagged";
import type {
  OttoDelegationRecord,
  OttoDelegationState,
  OrchestrationThreadActivity,
} from "@otto/contracts";
import {
  type DelegationAction,
  delegationActions,
  delegationElapsedMs,
  presentDelegation,
} from "@otto/client-runtime/delegation-presentation";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import { formatDuration } from "@otto/shared/orchestrationTiming";
import { formatTokens } from "@otto/shared/usageFormat";
import { useMemo, useState, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { deriveLatestContextWindowSnapshot } from "../../lib/context-window";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadActivities, useThreadShell } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../chat-markdown";
import { StatusIcon, type StatusKind } from "../status-icon";
import { Button } from "../ui/button";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "../ui/trace";
import { toast } from "sonner";
import { BotAvatarView } from "./bot-avatar-view";
import {
  DelegationDetail,
  delegationStateLabel,
  formatDelegationAccess,
} from "./delegation-detail";
import { useDelegationClock } from "./delegation-clock";
import type { Bot } from "./types";

const STATUS_ICON: Record<OttoDelegationState, StatusKind> = {
  queued: "pending",
  running: "in_progress",
  blocked: "waiting",
  failed: "error",
  canceled: "cancelled",
  completed: "completed",
};

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

function DelegationElapsed({
  delegation,
  live,
}: {
  readonly delegation: OttoDelegationRecord;
  readonly live: boolean;
}) {
  const now = useDelegationClock(live);
  const elapsed = delegationElapsedMs(delegation, now);

  return elapsed === null ? null : <TraceDescription>{formatDuration(elapsed)}</TraceDescription>;
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
 * One piece of delegated work in the parent chat's timeline, quoted under a left
 * rule: who is working and the task, then one trace line with the status icon,
 * elapsed time and tokens that opens like a reply's "Worked for" line onto the
 * expected result and access, then the bot's result clamped to six lines. The actions
 * and View work, which opens the child's chat read-only, sit after the trace line.
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

  const childThreadRef = useMemo(
    () =>
      environmentId && presentation.childThreadId
        ? scopeThreadRef(environmentId, presentation.childThreadId)
        : null,
    [presentation.childThreadId, environmentId],
  );

  const childThread = useThreadShell(childThreadRef);
  const childActivities = useThreadActivities(childThreadRef);
  const activeChildBot = childBot?.archivedAt === null ? childBot : null;
  const state = presentation.state;
  const childName = activeChildBot?.name ?? t("Unknown bot");
  const parentName = parentBot?.name ?? t("Unknown bot");
  const usageTokens = childThread ? delegationUsageTokens(delegation, childActivities) : null;

  const outcome = presentation.outcome;
  const resultText = outcome?.kind === "result" ? outcome.text || t("Result unavailable") : null;

  const noteText = outcome
    ? Match.value(outcome.kind).pipe(
        Match.when("failure", () => outcome.text || t("Failure details unavailable")),
        Match.when("blocked", () => outcome.text),
        Match.orElse(() => null),
      )
    : null;

  return (
    <article
      aria-label={t("Delegation to {name}", { name: childName })}
      className="mt-2 ml-10 max-w-min-42rem-pct-2.5rem border-l-2 border-border py-1 pl-3"
      data-testid="delegation-card"
      data-delegation-id={delegation.delegationId}
    >
      <div className="flex min-w-0 items-center gap-2">
        <BotAvatarView
          avatar={activeChildBot?.avatar ?? { kind: "dither", seed: delegation.childBotId }}
          name={childName}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 truncate text-sm font-medium">
          {variant === "group"
            ? t("{parent} asked {child}", { parent: parentName, child: childName })
            : childName}
        </span>
        {presentation.trigger === "scheduled" ? (
          <span className="shrink-0 text-xs text-muted-foreground">{t("Scheduled")}</span>
        ) : null}
        {presentation.retried ? (
          <span className="shrink-0 text-xs text-muted-foreground">{t("Retried")}</span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{delegation.task}</p>
      <Trace className="mt-1">
        <TraceCollapsible>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <TraceCollapsibleTrigger>
              <TraceLine {...(state === "running" ? { status: "running" as const } : {})}>
                <StatusIcon status={STATUS_ICON[state]} />
                <TraceTitle aria-live="polite">{delegationStateLabel(state, t)}</TraceTitle>
                <DelegationElapsed delegation={delegation} live={!presentation.terminal} />
                {usageTokens === null ? null : (
                  <TraceDescription
                    aria-label={t("{tokens} tokens billed to {name}", {
                      tokens: usageTokens.toLocaleString(),
                      name: childName,
                    })}
                  >
                    {t("{tokens} tokens", { tokens: formatTokens(usageTokens) })}
                  </TraceDescription>
                )}
              </TraceLine>
            </TraceCollapsibleTrigger>
            {presentation.delivery ? (
              <span
                className="min-w-0 truncate text-xs/relaxed text-muted-foreground"
                data-delivery={presentation.delivery}
              >
                {presentation.delivery === "pending"
                  ? t("Result waiting for the next reply")
                  : t("Result delivered to {name}", { name: parentName })}
              </span>
            ) : null}
            <div className="flex items-center gap-1" data-delegation-actions>
              {actions ?? (
                <DelegationActions
                  delegation={delegation}
                  delegations={delegations}
                  childName={childName}
                />
              )}
              <Button
                size="xs"
                variant="ghost-muted"
                aria-label={t("View {name}'s work", { name: childName })}
                disabled={presentation.childThreadId === null || environmentId === null}
                onClick={() => setDetailOpen(true)}
              >
                {t("View work")}
              </Button>
            </div>
          </div>
          <TraceCollapsibleContent>
            <dl className="flex flex-col gap-1.5 text-xs/relaxed" data-delegation-details>
              <div>
                <dt className="font-medium">{t("Expected result")}</dt>
                <dd className="whitespace-pre-wrap">{delegation.expectedResult}</dd>
              </div>
              <div>
                <dt className="font-medium">{t("Access")}</dt>
                <dd>{formatDelegationAccess(delegation.access, t)}</dd>
              </div>
            </dl>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
      {resultText ? (
        <ChatMarkdown
          className="mt-1 line-clamp-6"
          cwd={undefined}
          threadRef={childThreadRef ?? undefined}
          text={resultText}
        />
      ) : null}
      {noteText ? (
        <p
          className={`mt-1 text-sm whitespace-pre-wrap ${state === "failed" ? "text-destructive-foreground" : "text-foreground/80"}`}
        >
          {noteText}
        </p>
      ) : null}
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
