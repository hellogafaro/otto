import { cn } from "../lib/utils";

/**
 * Every status in the app. Tasks and projects use backlog, pending, in progress,
 * completed and cancelled; chats use working, waiting and completed (an idle chat shows
 * none); routines add paused and error.
 */
export type StatusKind =
  | "backlog"
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "error"
  | "working"
  | "waiting"
  | "paused";

/**
 * Otto: The one status icon set, Linear-style 12px glyphs: dashed, open and half rings
 * for work not done, filled discs for an outcome, a turning arc while a bot works.
 * In progress and working are violet, completed green, error red, waiting blue.
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
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <svg
      viewBox="0 0 14 14"
      {...named}
      className={cn(
        "size-3 shrink-0",
        (status === "in_progress" || status === "working") && "text-progress",
        status === "completed" && "text-success",
        status === "error" && "text-destructive",
        status === "waiting" && "text-info",
        (status === "backlog" ||
          status === "pending" ||
          status === "cancelled" ||
          status === "paused") &&
          "text-muted-foreground",
        status === "working" && "animate-spin motion-reduce:animate-none",
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
      {status === "working" ? (
        <>
          <circle
            cx="7"
            cy="7"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.5"
          />
          <path
            d="M7 1a6 6 0 0 1 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {status === "paused" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M5.6 5v4M8.4 5v4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {status === "completed" ||
      status === "cancelled" ||
      status === "error" ||
      status === "waiting" ? (
        <circle cx="7" cy="7" r="7" fill="currentColor" />
      ) : null}
      {status === "completed" ? (
        <path
          d="M4.2 7.2 6.1 9l3.7-3.9"
          fill="none"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {status === "cancelled" || status === "error" ? (
        <path
          d="m4.9 4.9 4.2 4.2m0-4.2-4.2 4.2"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
      {status === "waiting" ? (
        <path
          d="M4.3 7h.01M7 7h.01M9.7 7h.01"
          stroke="var(--background)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
