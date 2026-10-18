import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { RoutineSchedule, RoutineWeekday } from "./types.ts";

export class RoutineScheduleError extends Schema.TaggedErrorClass<RoutineScheduleError>()(
  "RoutineScheduleError",
  { detail: Schema.String },
) {}

const parseTime = (time: string): readonly [hour: number, minute: number] => {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);

  if (match === null) throw new RoutineScheduleError({ detail: `Invalid routine time: ${time}` });

  return [Number(time.slice(0, 2)), Number(time.slice(3, 5))];
};

// Otto: A month shorter than the routine's day runs it on its last day.
const isMonthDay = (scheduleDay: number, day: DateTime.Zoned) =>
  DateTime.toParts(day).day ===
  Math.min(scheduleDay, DateTime.toParts(DateTime.endOf(day, "month")).day);

const matchesDay = (schedule: RoutineSchedule, day: DateTime.Zoned) => {
  const parts = DateTime.toParts(day);

  switch (schedule.kind) {
    case "hourly":
    case "daily":
      return true;
    case "weekdays":
      return parts.weekDay >= 1 && parts.weekDay <= 5;
    case "weekly":
      return schedule.weekdays.includes(weekdays[parts.weekDay]!);
    case "monthly":
      return isMonthDay(schedule.day, day);
    case "quarterly":
      return parts.month % 3 === 1 && isMonthDay(schedule.day, day);
    case "yearly":
      return parts.month === schedule.month && isMonthDay(schedule.day, day);
  }
};

/** Days to look through for the next or latest run: a yearly routine runs once a year. */
const SEARCH_DAYS = 366;

const weekdays: ReadonlyArray<RoutineWeekday> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** The local hours a schedule runs on any matching day, earliest first. */
const hoursOfDay = (schedule: RoutineSchedule, hour: number): ReadonlyArray<number> => {
  if (schedule.kind !== "hourly") return [hour];
  const step = schedule.everyHours;

  return Array.from({ length: 24 / step }, (_, index) => (hour % step) + index * step);
};

const candidatesForDay = (
  day: DateTime.Zoned,
  schedule: RoutineSchedule,
  timezone: string,
): ReadonlyArray<DateTime.Zoned> => {
  const [hour, minute] = parseTime(schedule.time);
  const parts = DateTime.toParts(day);

  return hoursOfDay(schedule, hour).map((slotHour) => {
    const candidate = DateTime.makeZoned(
      { year: parts.year, month: parts.month, day: parts.day, hour: slotHour, minute },
      { timeZone: timezone, adjustForTimeZone: true },
    );

    if (Option.isNone(candidate)) {
      throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
    }

    return candidate.value;
  });
};

export const latestScheduledFor = (
  schedule: RoutineSchedule,
  timezone: string,
  nowEpochMillis: number,
): string => {
  const now = DateTime.makeZoned(nowEpochMillis, { timeZone: timezone });

  if (Option.isNone(now)) {
    throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
  }

  for (let daysBack = 0; daysBack <= SEARCH_DAYS; daysBack += 1) {
    const day = DateTime.subtract(now.value, { days: daysBack });

    if (!matchesDay(schedule, day)) continue;

    const candidate = candidatesForDay(day, schedule, timezone).findLast(
      (slot) => DateTime.toEpochMillis(slot) <= nowEpochMillis,
    );

    if (candidate) return DateTime.formatIso(candidate);
  }

  throw new RoutineScheduleError({ detail: "Routine schedule has no matching day." });
};

export const nextScheduledFor = (
  schedule: RoutineSchedule,
  timezone: string,
  afterEpochMillis: number,
): string => {
  const after = DateTime.makeZoned(afterEpochMillis, { timeZone: timezone });

  if (Option.isNone(after)) {
    throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
  }

  for (let daysAhead = 0; daysAhead <= SEARCH_DAYS; daysAhead += 1) {
    const day = DateTime.add(after.value, { days: daysAhead });

    if (!matchesDay(schedule, day)) continue;

    const candidate = candidatesForDay(day, schedule, timezone).find(
      (slot) => DateTime.toEpochMillis(slot) > afterEpochMillis,
    );

    if (candidate) return DateTime.formatIso(candidate);
  }

  throw new RoutineScheduleError({ detail: "Routine schedule has no matching day." });
};
