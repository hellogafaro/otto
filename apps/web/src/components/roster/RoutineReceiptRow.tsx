import { RiErrorWarningLine, RiCheckboxCircleLine, RiTimeLine } from "@remixicon/react";
import { Match } from "effect";

import { cn } from "~/lib/utils";

import { useI18n } from "../../i18n";
import type { RoutineReceipt } from "./routineReceipts";

/** A routine run note in the routine's own chat. */
export function RoutineReceiptRow({ receipt }: { readonly receipt: RoutineReceipt }) {
  const { formatDate } = useI18n();

  const Icon = Match.value(receipt).pipe(
    Match.when({ tone: "error" }, () => RiErrorWarningLine),
    Match.when({ tone: "success" }, () => RiCheckboxCircleLine),
    Match.orElse(() => RiTimeLine),
  );

  const error = receipt.tone === "error";

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl items-start gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground",
        error && "bg-destructive/8 text-destructive-foreground",
      )}
      data-testid="routine-receipt"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-normal break-words text-left leading-5">
        {receipt.text}
      </span>
      <time className="shrink-0 text-11px text-muted-foreground/60" dateTime={receipt.createdAt}>
        {formatDate(new Date(receipt.createdAt), { hour: "numeric", minute: "2-digit" })}
      </time>
    </div>
  );
}
