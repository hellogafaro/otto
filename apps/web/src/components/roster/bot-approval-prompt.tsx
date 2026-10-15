import { OTTO_CREATE_ROUTINE_TOOL_NAME, type ProviderApprovalDecision } from "@otto/contracts";
import { Predicate } from "effect";
import { cn } from "~/lib/utils";

import { useI18n } from "../../i18n";
import type { PendingApproval } from "../../session-logic";
import { ComposerPendingApprovalActions } from "../chat/composer-pending-approval-actions";
import { ComposerPendingApprovalPanel } from "../chat/composer-pending-approval-panel";
import {
  BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME,
  BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME,
} from "./bot-conversation-presentation";

export function BotApprovalPrompt({
  approval,
  pendingCount,
  responding,
  error,
  onRespond,
}: {
  readonly approval: PendingApproval;
  readonly pendingCount: number;
  readonly responding: boolean;
  readonly error: string | null;
  readonly onRespond: (decision: ProviderApprovalDecision) => Promise<boolean | void>;
}) {
  const { t } = useI18n();

  const isSpecialReview = approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME;

  const oneUse =
    !isSpecialReview &&
    (approval.options?.every(
      (option) => option.decision !== "acceptForSession" && option.decision !== "acceptAlways",
    ) ??
      false);

  const toolCommand =
    approval.args && Predicate.isObject(approval.args) && "command" in approval.args;

  const heading =
    approval.toolName === "SendToUser"
      ? t("Send this message?")
      : approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME
        ? t("Review routine")
        : approval.toolName === "Computer Use"
          ? t("Use the computer?")
          : approval.requestKind === "command" && approval.toolName && !toolCommand
            ? t("Allow {tool}?", { tool: approval.toolName })
            : approval.requestKind === "command"
              ? t("Run this command?")
              : approval.requestKind === "file-read"
                ? t("Read this file?")
                : approval.requestKind === "file-change"
                  ? t("Change this file?")
                  : t("Allow app access?");

  return (
    <section
      aria-label={t("Approval required")}
      className={cn(
        BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME,
        BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME,
        "px-4 pt-4 pb-0",
      )}
      data-testid="bot-approval-prompt"
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{heading}</p>
        {approval.appName ? (
          <span className="max-w-32 truncate text-xs text-muted-foreground">
            {approval.appName}
          </span>
        ) : null}
        {oneUse ? <span className="text-xs text-muted-foreground">{t("Runs once")}</span> : null}
        {pendingCount > 1 ? (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {t("1 of {count}", { count: pendingCount })}
          </span>
        ) : null}
      </div>
      <ComposerPendingApprovalPanel
        approval={approval}
        pendingCount={pendingCount}
        className="mt-2"
        hideLabel
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="-mx-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        <ComposerPendingApprovalActions
          requestId={approval.requestId}
          requestKind={approval.requestKind}
          toolName={approval.toolName}
          isResponding={responding}
          options={approval.options}
          onRespondToApproval={(_requestId, decision) => onRespond(decision)}
        />
      </div>
    </section>
  );
}
