import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";
import { actorOf, shortDate } from "@/components/task-meta";

// Activity as a timeline: one straight hairline down the left, under the
// cards' avatars (16px + 10px in). It reaches 16px out of the page column
// (the cards' padding), so their avatars, and the events' text, sit on the
// page title's line. Cards (comments, runs) sit over it at full
// width, so it shows only between them; events hang on it with an 8px dot
// (the size of our other status dots), their text lined up with the cards'
// names (44px in); what is still to come (a schedule's next run) gets a
// hollow one. On tasks and schedules alike.
export function Timeline({ children }: { children: ReactNode }) {
  return (
    <ul className="relative -mx-4 flex flex-col gap-5 before:absolute before:inset-y-0 before:left-[25.5px] before:w-px before:bg-border">
      {children}
    </ul>
  );
}

export function TimelineItem({
  dot,
  className,
  children,
}: {
  /** Events hang on a dot; "next" is hollow, for what is still to come. */
  dot?: "event" | "next";
  className?: string;
  children: ReactNode;
}) {
  return (
    <li className={cn("relative", dot && "pl-11", className)}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "absolute top-1.5 left-[22px] size-2 rounded-full",
            dot === "next"
              ? "border border-muted-foreground bg-background"
              : "bg-muted-foreground",
          )}
        />
      )}
      {children}
    </li>
  );
}

// One activity event, a muted line on a dot: "Name did this · Oct 3".
export function ActivityEvent({
  actorId,
  body,
  createdAt,
}: {
  actorId: string;
  body: string;
  createdAt: string;
}) {
  return (
    <TimelineItem dot="event" className="text-sm text-muted-foreground">
      {actorOf(actorId).name} {body} ·{" "}
      <span className="tabular-nums">
        {shortDate.format(new Date(createdAt))}
      </span>
    </TimelineItem>
  );
}
