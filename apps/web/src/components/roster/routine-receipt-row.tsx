import { RiArrowRightSLine, RiTimeLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { Match } from "effect";

import { cn } from "~/lib/utils";

import { useI18n } from "../../i18n";
import { StatusIcon, type StatusKind } from "../status-icon";
import type { RoutineReceipt, RoutineReceiptStatus } from "./routine-receipts";

const STATUS_ICON: Record<Exclude<RoutineReceiptStatus, "created">, StatusKind> = {
  running: "in_progress",
  completed: "completed",
  failed: "error",
  canceled: "cancelled",
};

/**
 * A routine's creation or one of its runs in the routine's chat: a two-line card that opens
 * the routine, with the run's live status, or why it failed in place of the status word.
 * It sits in the bot's content column, past the avatar gutter, like the bot's own rows.
 */
export function RoutineReceiptRow({ receipt }: { readonly receipt: RoutineReceipt }) {
  const { formatDate, t } = useI18n();
  const time = formatDate(new Date(receipt.settledAt), { hour: "numeric", minute: "2-digit" });

  const label = Match.value(receipt.status).pipe(
    Match.when("created", () => (receipt.archived ? t("Routine deleted") : t("Routine created"))),
    Match.when("running", () => t("Running")),
    Match.when("completed", () => t("Run finished")),
    Match.when("failed", () => t("Run failed")),
    Match.when("canceled", () => t("Run canceled")),
    Match.exhaustive,
  );

  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <RiTimeLine aria-hidden="true" className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{receipt.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {receipt.status === "created" ? null : (
            <StatusIcon status={STATUS_ICON[receipt.status]} className="size-3 shrink-0" />
          )}
          <span className="flex min-w-0">
            {receipt.detail ? (
              <span className="min-w-0 truncate text-destructive-foreground">{receipt.detail}</span>
            ) : (
              <span className="shrink-0">{label}</span>
            )}
            <span className="shrink-0 whitespace-pre"> · {time}</span>
          </span>
        </span>
      </span>
      {receipt.archived ? null : (
        <RiArrowRightSLine aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const cardClassName =
    "flex w-full max-w-sm items-center gap-2.5 rounded-lg border bg-card p-2 pr-3 text-left";

  return (
    <div className="w-full py-1 pl-10" data-testid="routine-receipt">
      {receipt.archived ? (
        <div className={cardClassName}>{content}</div>
      ) : (
        <Link
          to="/routines/$routineId"
          params={{ routineId: receipt.routineId }}
          aria-label={receipt.text}
          className={cn(cardClassName, "transition-colors hover:bg-accent")}
        >
          {content}
        </Link>
      )}
    </div>
  );
}
