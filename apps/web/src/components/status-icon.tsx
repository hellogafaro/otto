import { useId } from "react";

import { cn } from "../lib/utils";

/**
 * The one set of statuses every surface maps onto: a task's In progress, a chat's
 * Working and a routine's Running are all in progress; a task's Pending, a queued run
 * and an active routine waiting for its next run are all pending.
 */
export type StatusKind =
  | "backlog"
  | "pending"
  | "in_progress"
  | "waiting"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

/**
 * One color per meaning: gray is not started or was stopped, violet
 * is happening, yellow needs you, green is done and red failed.
 */
const STATUS_TONE = {
  backlog: "text-muted-foreground",
  pending: "text-muted-foreground",
  in_progress: "text-progress",
  waiting: "text-warning",
  paused: "text-muted-foreground",
  completed: "text-success",
  cancelled: "text-muted-foreground",
  error: "text-destructive",
} as const satisfies Record<StatusKind, string>;

/** Outcomes and calls for you are filled discs with this mark cut out of them. */
const DISC_MARK: Partial<Record<StatusKind, string>> = {
  completed: "M4.2 7.2 6.1 9l3.7-3.9",
  cancelled: "m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2",
  error: "m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2",
  waiting: "M7 3.7v3.6M7 10.2v.1",
};

/** Open rings carry this mark inside. */
const RING_MARK: Partial<Record<StatusKind, string>> = {
  paused: "M5.6 5v4M8.4 5v4",
};

/**
 * Otto: The one status icon set, Linear-style 12px glyphs. Open rings are not finished:
 * dashed backlog, solid while pending, pause bars while paused, and a still half disc
 * inside the ring while in progress. Filled discs are an outcome or a call for
 * you, their mark cut through so any row background shows; cancelled and error share
 * the cross in gray and red.
 */
export function StatusIcon({
  status,
  label,
  className,
}: {
  readonly status: StatusKind;
  /** Names the icon for assistive tech when no visible text says the status. */
  readonly label?: string;
  readonly className?: string | undefined;
}) {
  const maskId = `status-${useId().replace(/[^\w-]/g, "")}`;
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  const discMark = DISC_MARK[status];
  const ringMark = RING_MARK[status];

  return (
    <svg
      viewBox="0 0 14 14"
      {...named}
      className={cn("size-3 shrink-0", STATUS_TONE[status], className)}
    >
      {discMark ? (
        <>
          <mask id={maskId}>
            <circle cx="7" cy="7" r="7" fill="var(--color-zinc-25)" />
            <path
              d={discMark}
              fill="none"
              stroke="var(--color-black)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
          <circle cx="7" cy="7" r="7" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <circle
          cx="7"
          cy="7"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={status === "backlog" ? "2.2 2.2" : undefined}
        />
      )}
      {status === "in_progress" ? (
        <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor" />
      ) : null}
      {ringMark ? (
        <path
          d={ringMark}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
