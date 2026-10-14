import {
  absoluteRunTime,
  runStatusTone,
  runSummaryLine,
  type RoutineAdapterRun,
  type RoutineAdapterRunStatus,
} from "@otto/client-runtime/routines";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { CONTENT_ROW_CLASS } from "../contentRow";
import { StatusIcon, type StatusKind } from "../StatusIcon";
import { WorkSectionHeader } from "../work/WorkDetail";

const RUN_STATUS_ICON = {
  completed: "completed",
  failed: "error",
  running: "working",
  queued: "pending",
  "waiting-for-approval": "waiting",
  blocked: "waiting",
  canceled: "cancelled",
} as const satisfies Record<RoutineAdapterRunStatus, StatusKind>;

const RUN_BAR_CLASS = {
  completed: "bg-success",
  failed: "bg-destructive",
  running: "animate-pulse bg-progress motion-reduce:animate-none",
  queued: "bg-muted-foreground/40",
  "waiting-for-approval": "bg-info",
  blocked: "bg-info",
  canceled: "bg-muted-foreground/40",
} as const satisfies Record<RoutineAdapterRunStatus, string>;

/** The runs listed and drawn; the chat keeps every receipt. */
const HISTORY_LIMIT = 30;

/** Enough slots to fill the widest content column; the strip clips the rest. */
const STRIP_SLOTS = 120;

/**
 * Otto: A routine's run history. A full-width strip of 6px bars with 2px corners shows its
 * health at a glance: past runs oldest to newest in their status colors, then light gray
 * slots still to come out to the column's edge,
 * with the success count beside the heading. Below, each run is a 32px content row with
 * its status icon, its result without closing punctuation (errors in the destructive tone)
 * and its short date and time on the right. Every row opens the run in the routine's chat.
 */
export function RoutineHistory({
  runs,
  onOpenRun,
}: {
  readonly runs: readonly RoutineAdapterRun[];
  readonly onOpenRun: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const shown = runs.slice(0, HISTORY_LIMIT);
  const finished = shown.filter((run) => run.status === "completed" || run.status === "failed");
  const passed = finished.filter((run) => run.status === "completed").length;

  return (
    <section className="flex flex-col">
      <WorkSectionHeader
        label={t("History")}
        aside={
          finished.length > 0
            ? t("{passed} of {total} succeeded", { passed, total: finished.length })
            : undefined
        }
      />
      <div className="mb-3 ps-4 pe-2.5">
        {/* Bars that no longer fit wrap out of sight, so the strip ends on a whole bar. */}
        <div aria-hidden className="flex h-6 flex-wrap gap-x-0.5 overflow-hidden">
          {shown.toReversed().map((run) => (
            <span
              key={run.id}
              className={cn("h-6 w-1.5 shrink-0 rounded-xs", RUN_BAR_CLASS[run.status])}
            />
          ))}
          {Array.from({ length: STRIP_SLOTS - shown.length }, (_, slot) => (
            <span key={slot} className="h-6 w-1.5 shrink-0 rounded-xs bg-muted-foreground/15" />
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="ps-4 text-13px text-muted-foreground">
          {t("No runs yet. Each run posts its result in the routine's chat.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((run) => (
            <li key={run.id} className="list-none">
              <button type="button" onClick={onOpenRun} className={cn(CONTENT_ROW_CLASS, "gap-3")}>
                <StatusIcon
                  status={RUN_STATUS_ICON[run.status]}
                  label={t(runStatusTone(run.status).label)}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    run.status === "failed" ? "text-destructive-foreground" : "text-foreground",
                  )}
                >
                  {runSummaryLine(run, i18n).replace(/[.:。：]$/, "")}
                </span>
                <time
                  dateTime={run.startedAt}
                  className="shrink-0 tabular-nums text-muted-foreground"
                >
                  {absoluteRunTime(run.startedAt, i18n)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
