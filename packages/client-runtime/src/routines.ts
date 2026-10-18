import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { asRecord } from "./work-log-command.ts";
import type { PendingApproval } from "./pending-requests.ts";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import type {
  BotId,
  McpServer,
  Routine,
  RoutineApprovalPolicy,
  RoutineHourInterval,
  RoutineRun,
  RoutineRunStatus,
  RoutineSandbox,
  RoutineSchedule,
  RoutineSkillAssignment,
} from "@otto/contracts";
import { withoutErrorStack } from "@otto/shared/errorText";

import { createTranslator, type MessageKey } from "./i18n/index.ts";

export type RoutineAdapterFrequency = RoutineSchedule["kind"];

export type RoutineAdapterApproval = RoutineApprovalPolicy;

export type RoutineAdapterSandbox = RoutineSandbox;

export type RoutineAdapterRunStatus = RoutineRunStatus;

export interface RoutineAdapterProject {
  readonly id: string;
  readonly name: string;
}

/** A bot a routine can hand its work to. */
export interface RoutineAdapterBot {
  readonly id: string;
  readonly name: string;
  /** False when the bot's provider cannot take handed-off work. Defaults to true. */
  readonly canTakeWork?: boolean;
}

export interface RoutineAdapterSchedule {
  readonly frequency: RoutineAdapterFrequency;
  readonly time: string;
  readonly timezone: string;
  readonly weekday: number | null;
  /** Every day a weekly routine runs on, Sunday as 0. */
  readonly weekdays?: readonly number[];
  /** Hours between runs of an hourly routine. */
  readonly everyHours?: RoutineHourInterval | null;
  /** The day of the month a monthly, quarterly or yearly routine runs on. */
  readonly day?: number;
  /** The month, January as 1, a yearly routine runs in. */
  readonly month?: number;
}

export const ROUTINE_HOUR_INTERVALS: ReadonlyArray<RoutineHourInterval> = [1, 2, 3, 4, 6, 8, 12];

export interface RoutineAdapterRun {
  readonly id: string;
  readonly status: RoutineAdapterRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly summary: string | null;
  readonly error: string | null;
  readonly usage: string | null;
  /** The chat the run posted into. */
  readonly threadId: string | null;
}

/** A routine as clients render it: names resolved, runs attached newest first. */
export interface RoutineAdapterItem {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly projectId: string;
  readonly sandbox: RoutineAdapterSandbox;
  readonly schedule: RoutineAdapterSchedule;
  readonly approval: RoutineAdapterApproval;
  readonly skills: readonly string[];
  readonly connectors: readonly string[];
  /** The bot each run hands its work to, or null when the owner does it. */
  readonly delegateToBotId: string | null;
  readonly procedureApproved: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly latestRun: RoutineAdapterRun | null;
  readonly runHistory: readonly RoutineAdapterRun[];
}

export interface RoutineAdapterDraft {
  readonly name: string;
  readonly prompt: string;
  readonly projectId: string;
  readonly sandbox: RoutineAdapterSandbox;
  readonly schedule: RoutineAdapterSchedule;
  readonly approval: RoutineAdapterApproval;
  readonly skills: readonly string[];
  readonly connectors: readonly string[];
  readonly delegateToBotId: string | null;
}

const WEEKDAY_IDS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const WEEKDAY_LABELS: readonly MessageKey[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function toRoutineSchedule(draft: RoutineAdapterDraft): RoutineSchedule {
  if (draft.schedule.frequency === "hourly") {
    return {
      kind: "hourly",
      everyHours: draft.schedule.everyHours ?? 1,
      time: draft.schedule.time,
    };
  }

  const { frequency, time, day = 1, month = 1 } = draft.schedule;

  if (frequency === "monthly" || frequency === "quarterly") return { kind: frequency, day, time };

  if (frequency === "yearly") return { kind: "yearly", month, day, time };

  if (frequency !== "weekly") return { kind: frequency, time };

  return {
    kind: "weekly",
    weekdays: [WEEKDAY_IDS[draft.schedule.weekday ?? 1]!],
    time: draft.schedule.time,
  };
}

function toAdapterSchedule(routine: Routine): RoutineAdapterSchedule {
  return {
    frequency: routine.schedule.kind,
    time: routine.schedule.time,
    timezone: routine.timezone,
    weekday:
      routine.schedule.kind === "weekly"
        ? WEEKDAY_IDS.indexOf(routine.schedule.weekdays[0] ?? "monday")
        : null,
    ...(routine.schedule.kind === "weekly"
      ? { weekdays: routine.schedule.weekdays.map((day) => WEEKDAY_IDS.indexOf(day)) }
      : {}),
    ...(routine.schedule.kind === "hourly" ? { everyHours: routine.schedule.everyHours } : {}),
    ...("day" in routine.schedule ? { day: routine.schedule.day } : {}),
    ...(routine.schedule.kind === "yearly" ? { month: routine.schedule.month } : {}),
  };
}

function toAdapterRun(run: RoutineRun): RoutineAdapterRun {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt ?? run.createdAt,
    finishedAt: run.completedAt,
    summary: run.result?.summary ?? null,
    error: run.failure ? withoutErrorStack(run.failure.message) : null,
    usage: run.usageRef,
    threadId: run.threadRef,
  };
}

export function toRoutinePanelItem(
  routine: Routine,
  runs: readonly RoutineRun[],
  assignments: readonly RoutineSkillAssignment[],
  mcpServers: readonly McpServer[],
): RoutineAdapterItem {
  // .sort() on a copy, not .toSorted(): Hermes lacks ES2023 change-by-copy.
  const history = [...runs]
    .filter((run) => run.routineId === routine.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toAdapterRun);

  const assignmentNames = new Map(
    assignments.map((assignment) => [assignment.id, assignment.name]),
  );

  const connectorNames = new Map(mcpServers.map((server) => [server.id, server.name]));

  return {
    id: routine.id,
    name: routine.job,
    prompt: routine.procedure,
    projectId: routine.projectId,
    sandbox: routine.sandbox,
    schedule: toAdapterSchedule(routine),
    approval: routine.approvalPolicy,
    skills: routine.skillAssignmentIds.flatMap((id) => {
      const name = assignmentNames.get(id);

      return name ? [name] : [];
    }),
    connectors: routine.connectorDependencies.flatMap((id) => {
      const name = connectorNames.get(id);

      return name ? [name] : [];
    }),
    delegateToBotId: routine.delegateToBotId,
    procedureApproved: routine.approvalVersion === routine.procedureVersion,
    enabled: routine.enabled,
    paused:
      !routine.enabled &&
      (routine.lifecycle === "paused" ||
        routine.lifecycle === "blocked" ||
        routine.lifecycle === "failed"),
    nextRunAt: routine.nextRunAt,
    lastRunAt: routine.lastRunAt,
    latestRun: history[0] ?? null,
    runHistory: history,
  };
}

/** The slice of an environment snapshot a bot's routine list reads. */
export interface BotRoutineSource {
  readonly routines?: readonly Routine[] | undefined;
  readonly routineRuns?: readonly RoutineRun[] | undefined;
  readonly skillAssignments?: readonly RoutineSkillAssignment[] | undefined;
  readonly mcpServers?: readonly McpServer[] | undefined;
}

export type BotRoutinesView =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly routines: readonly RoutineAdapterItem[] };

/**
 * One bot's live routines. A snapshot without a routines list comes from an environment
 * that predates routines, which is different from a bot that has none.
 */
export function botRoutinesView(
  snapshot: BotRoutineSource | null | undefined,
  botId: BotId | string,
): BotRoutinesView {
  if (!snapshot) return { kind: "loading" };

  if (snapshot.routines === undefined) return { kind: "unavailable" };

  return {
    kind: "ready",
    routines: snapshot.routines
      .filter((routine) => routine.botId === botId && routine.lifecycle !== "deleted")
      .map((routine) =>
        toRoutinePanelItem(
          routine,
          snapshot.routineRuns ?? [],
          snapshot.skillAssignments ?? [],
          snapshot.mcpServers ?? [],
        ),
      ),
  };
}

/** The translator slice routine labels need. Helpers default to English outside React. */
export type RoutineTranslator = Pick<ReturnType<typeof createTranslator>, "t" | "formatDate">;

const englishTranslator: RoutineTranslator = createTranslator("en");

/**
 * Names an hourly schedule by its earliest run of the day, since it repeats
 * around the clock from `time`.
 */
export function hourlyScheduleText(
  everyHours: number,
  time: string,
  t: RoutineTranslator["t"] = englishTranslator.t,
): string {
  if (everyHours > 1) {
    return t("Every {count} hours from {time}", {
      count: everyHours,
      time: firstHourlyTime(everyHours, time),
    });
  }

  const minute = Number(time.slice(3, 5));

  return minute === 0
    ? t("Every hour on the hour")
    : t("Every hour at {count} min past", { count: minute });
}

const firstHourlyTime = (everyHours: number, time: string) =>
  `${String(Number(time.slice(0, 2)) % everyHours).padStart(2, "0")}:${time.slice(3, 5)}`;

/**
 * When a routine runs, without how often: the time of day, or for an hourly one where in the
 * hour (On the hour, 15 min past) or, every few hours, its first run of the day (From 02:00).
 */
export function routineTimeLabel(
  schedule: RoutineAdapterSchedule,
  i18n: RoutineTranslator = englishTranslator,
) {
  if (schedule.frequency !== "hourly") return schedule.time;
  const everyHours = schedule.everyHours ?? 1;

  if (everyHours > 1)
    return i18n.t("From {time}", { time: firstHourlyTime(everyHours, schedule.time) });

  const minute = Number(schedule.time.slice(3, 5));

  return minute === 0 ? i18n.t("On the hour") : i18n.t("{count} min past", { count: minute });
}

/**
 * How often a routine runs, without its time or timezone: Daily, Weekdays, Monday, Hourly,
 * Monthly on day 15, Yearly on Mar 15.
 */
export function routineFrequencyLabel(
  schedule: RoutineAdapterSchedule,
  i18n: RoutineTranslator = englishTranslator,
) {
  const everyHours = schedule.everyHours ?? 1;
  const day = schedule.day ?? 1;

  return Match.value(schedule.frequency).pipe(
    Match.when("hourly", () =>
      everyHours <= 1 ? i18n.t("Hourly") : i18n.t("Every {count} hours", { count: everyHours }),
    ),
    Match.when("daily", () => i18n.t("Daily")),
    Match.when("weekdays", () => i18n.t("Weekdays")),
    Match.when("monthly", () => i18n.t("Monthly on day {count}", { count: day })),
    Match.when("quarterly", () => i18n.t("Quarterly on day {count}", { count: day })),
    Match.when("yearly", () =>
      i18n.t("Yearly on {date}", {
        date: i18n.formatDate(
          DateTime.toDateUtc(DateTime.makeUnsafe({ year: 2024, month: schedule.month ?? 1, day })),
          { month: "short", day: "numeric", timeZone: "UTC" },
        ),
      }),
    ),
    Match.orElse(() =>
      (schedule.weekdays ?? [schedule.weekday ?? 1])
        .map((day) => i18n.t(WEEKDAY_LABELS[day] ?? "Monday"))
        .join(", "),
    ),
  );
}

export function routineScheduleLabel(
  schedule: RoutineAdapterSchedule,
  i18n: RoutineTranslator = englishTranslator,
) {
  if (schedule.frequency === "hourly") {
    return i18n.t("{schedule} ({timezone})", {
      schedule: hourlyScheduleText(schedule.everyHours ?? 1, schedule.time, i18n.t),
      timezone: schedule.timezone,
    });
  }

  return i18n.t("{frequency} at {time} ({timezone})", {
    frequency: routineFrequencyLabel(schedule, i18n),
    time: schedule.time,
    timezone: schedule.timezone,
  });
}

export function boundedRunHistory(history: readonly RoutineAdapterRun[]) {
  return history.slice(0, 5);
}

/**
 * The lifecycle state a routine is actually in, as the card and detail both label it.
 * A routine that was never approved is a Draft; one that was turned off is Off, and
 * the two take different routes back on.
 */
type RoutineStatusResult = {
  readonly label: MessageKey & ("Active" | "Paused" | "Off" | "Draft");
  readonly variant: "success" | "warning" | "secondary";
};

export function routineStatus(routine: RoutineAdapterItem): RoutineStatusResult {
  if (routine.paused) return { label: "Paused", variant: "warning" };

  if (routine.enabled) return { label: "Active", variant: "success" };

  if (routine.procedureApproved) return { label: "Off", variant: "secondary" };

  return { label: "Draft", variant: "secondary" };
}

/** Why a routine is not running on schedule, or null when it is. */
export function routineStateNote(routine: RoutineAdapterItem): (MessageKey & string) | null {
  if (routine.paused) return "Paused until you resume it.";

  if (routine.enabled) return null;

  return routine.procedureApproved
    ? "Off until you turn it back on."
    : "Draft. Approve its procedure to schedule it.";
}

/**
 * The one lifecycle control a routine offers: the reverse of the state it is in. A draft
 * offers none, because approving its procedure comes first.
 */
export function routineLifecycleAction(
  routine: RoutineAdapterItem,
): "resume" | "enable" | "pause" | null {
  if (routine.paused) return "resume";

  if (routine.enabled) return "pause";

  if (routine.procedureApproved) return "enable";

  return null;
}

const RUN_STATUS_TONE = {
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  running: { label: "Running", variant: "info" },
  queued: { label: "Queued", variant: "secondary" },
  "waiting-for-approval": { label: "Needs approval", variant: "warning" },
  blocked: { label: "Blocked", variant: "warning" },
  canceled: { label: "Canceled", variant: "secondary" },
} as const satisfies Record<
  RoutineAdapterRunStatus,
  {
    readonly label: MessageKey;
    readonly variant: "success" | "error" | "info" | "secondary" | "warning";
  }
>;

/** How one run reads at a glance: its chip wording and its semantic tone. */
export function runStatusTone(status: RoutineAdapterRunStatus) {
  return RUN_STATUS_TONE[status];
}

/** The absolute wall-clock label a relative time is paired with. */
export function absoluteRunTime(value: string, i18n: RoutineTranslator = englishTranslator) {
  const date = DateTime.make(Date.parse(value));

  if (Option.isNone(date)) return "";

  return i18n.formatDate(DateTime.toDateUtc(date.value), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** An absolute run time, or "Not scheduled" when there is none. */
export function routineDateLabel(value: string | null, i18n: RoutineTranslator) {
  if (!value) return i18n.t("Not scheduled");

  return absoluteRunTime(value, i18n);
}

/**
 * "in 3h" ahead of an instant, "3h ago" behind it. Routine times land on both sides
 * of now — the next run is future, every run in the history is past.
 */
export function relativeRunTime(
  value: string,
  nowMs: number = DateTime.toEpochMillis(DateTime.nowUnsafe()),
  i18n: RoutineTranslator = englishTranslator,
) {
  const target = Option.match(DateTime.make(Date.parse(value)), {
    onNone: () => Number.NaN,
    onSome: DateTime.toEpochMillis,
  });

  if (Number.isNaN(target)) return "";
  const diffMs = target - nowMs;
  const seconds = Math.floor(Math.abs(diffMs) / 1000);

  if (seconds < 60) return i18n.t("now");
  const minutes = Math.floor(seconds / 60);

  const span =
    minutes < 60
      ? i18n.t("{count}m", { count: minutes })
      : minutes < 1440
        ? i18n.t("{count}h", { count: Math.floor(minutes / 60) })
        : i18n.t("{count}d", { count: Math.floor(minutes / 1440) });

  return diffMs >= 0 ? i18n.t("in {span}", { span }) : i18n.t("{span} ago", { span });
}

/** The single line a run gets in the history: its error, else its summary, else its status. */
export function runSummaryLine(
  run: RoutineAdapterRun,
  i18n: RoutineTranslator = englishTranslator,
) {
  const detail = run.error ?? run.summary ?? "";
  const line = detail.split("\n").find((part) => part.trim().length > 0);

  return line?.trim() || i18n.t(runStatusTone(run.status).label);
}

export interface RoutineApprovalSummary {
  readonly name: string;
  readonly instructions: string | null;
  /** "Weekdays at 09:00", or null when the proposal has no time. */
  readonly schedule: string | null;
}

/**
 * What a bot's `routine_create` request proposes, read defensively from the raw
 * tool arguments so a malformed request still renders as a reviewable approval.
 */
export function routineApprovalSummary(
  args: PendingApproval["args"],
  t: RoutineTranslator["t"] = englishTranslator.t,
): RoutineApprovalSummary {
  const record = asRecord(args);
  const schedule = asRecord(record?.schedule);

  const time = Predicate.isString(schedule?.time) ? schedule.time : null;

  const weekdays = Array.isArray(schedule?.weekdays)
    ? schedule.weekdays.filter((day): day is string => Predicate.isString(day))
    : [];

  const day = Predicate.isNumber(schedule?.day) ? schedule.day : 1;

  const kind = Match.value(schedule?.kind).pipe(
    Match.when("weekdays", () => t("Weekdays")),
    Match.when("monthly", () => t("Monthly on day {count}", { count: day })),
    Match.when("quarterly", () => t("Quarterly on day {count}", { count: day })),
    Match.when("yearly", () => t("Yearly")),
    Match.when("weekly", () =>
      weekdays.length > 0
        ? weekdays
            .map((day) => {
              const index = WEEKDAY_IDS.findIndex((weekday) => weekday === day);

              return index === -1 ? day : t(WEEKDAY_LABELS[index]!);
            })
            .join(", ")
        : t("Weekly"),
    ),
    Match.orElse(() => t("Daily")),
  );

  const everyHours = Predicate.isNumber(schedule?.everyHours) ? schedule.everyHours : 1;

  const base = !time
    ? null
    : schedule?.kind === "hourly"
      ? hourlyScheduleText(everyHours, time, t)
      : t("{schedule} at {time}", { schedule: kind, time });

  const timezone =
    Predicate.isString(record?.timezone) && record.timezone.trim() ? record.timezone.trim() : null;

  return {
    name: Predicate.isString(record?.name) && record.name.trim() ? record.name : t("New routine"),
    instructions:
      Predicate.isString(record?.instructions) && record.instructions.trim()
        ? record.instructions
        : null,
    schedule: base && timezone ? `${base} (${timezone})` : base,
  };
}
