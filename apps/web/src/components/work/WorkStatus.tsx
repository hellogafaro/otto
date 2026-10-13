import type { WorkStatus } from "@otto/contracts";
import { RiArchiveLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WORK_STATUS_ORDER } from "./work.logic";

/** Linear-style status glyph: dashed, open, half, done, crossed out, archived. */
export function WorkStatusIcon({
  status,
  className,
}: {
  readonly status: WorkStatus;
  readonly className?: string;
}) {
  if (status === "archived") {
    return (
      <RiArchiveLine
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn(
        "size-3.5 shrink-0",
        status === "in_progress" && "text-warning",
        status === "completed" && "text-success",
        (status === "backlog" || status === "pending" || status === "cancelled") &&
          "text-muted-foreground",
        className,
      )}
    >
      {status === "backlog" ? (
        <circle
          cx="7"
          cy="7"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.2 2.2"
        />
      ) : null}
      {status === "pending" ? (
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : null}
      {status === "in_progress" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor" />
        </>
      ) : null}
      {status === "completed" ? (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="M4.2 7.2 6.1 9l3.7-3.9"
            fill="none"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {status === "cancelled" ? (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  );
}

export function useWorkStatusLabel(): (status: WorkStatus) => string {
  const { t } = useI18n();

  return (status) => {
    switch (status) {
      case "backlog":
        return t("Backlog");
      case "pending":
        return t("Pending");
      case "in_progress":
        return t("In progress");
      case "completed":
        return t("Completed");
      case "cancelled":
        return t("Cancelled");
      case "archived":
        return t("Archived");
    }
  };
}

function isWorkStatus(value: unknown): value is WorkStatus {
  return WORK_STATUS_ORDER.some((status) => status === value);
}

/** A status pill: the glyph and its name, opening the full status list. */
export function WorkStatusSelect({
  value,
  onChange,
  className,
}: {
  readonly value: WorkStatus;
  readonly onChange: (status: WorkStatus) => void;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const label = useWorkStatusLabel();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isWorkStatus(next)) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className={cn("w-auto min-w-0", className)} aria-label={t("Status")}>
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <WorkStatusIcon status={value} />
            {label(value)}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {WORK_STATUS_ORDER.map((status) => (
          <SelectItem key={status} hideIndicator value={status}>
            <span className="flex items-center gap-2">
              <WorkStatusIcon status={status} />
              {label(status)}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
