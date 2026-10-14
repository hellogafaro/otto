import {
  type OrchestrationProjectShell,
  type OrchestrationTask,
  ProjectListFilter,
  TaskListFilter,
  type WorkStatus,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { BLOB_COLORS, BLOB_SHAPES, DEFAULT_BLOB_SHAPE } from "../roster/rosterAvatar.logic";

/** Linear's order: what is moving first, then what is waiting, then what is done. */
export const WORK_STATUS_ORDER: readonly WorkStatus[] = [
  "in_progress",
  "pending",
  "backlog",
  "completed",
  "cancelled",
  "archived",
];

/** The statuses a person picks; archiving is its own action. */
export const WORK_STATUS_CHOICES = WORK_STATUS_ORDER.filter((status) => status !== "archived");

/** Projects saved before planning fields existed read as active. */
export function projectStatus(project: Pick<OrchestrationProjectShell, "status">): WorkStatus {
  return project.status ?? "in_progress";
}

/** URL search to a task filter; a malformed URL shows the unfiltered list instead of failing. */
export const parseTaskSearch = (search: Parameters<typeof decodeTaskSearch>[0]) =>
  Option.getOrElse(decodeTaskSearch(search), (): TaskListFilter => ({}));

const decodeTaskSearch = Schema.decodeUnknownOption(TaskListFilter);

export const parseProjectSearch = (search: Parameters<typeof decodeProjectSearch>[0]) =>
  Option.getOrElse(decodeProjectSearch(search), (): ProjectListFilter => ({}));

const decodeProjectSearch = Schema.decodeUnknownOption(ProjectListFilter);

/** A project page's tabs; the overview is the default and stays out of the URL. */
export const PROJECT_TABS = ["overview", "tasks", "chats", "library"] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

const ProjectPageSearch = Schema.Struct({ tab: Schema.optional(Schema.Literals(PROJECT_TABS)) });

export type ProjectPageSearch = typeof ProjectPageSearch.Type;

export const parseProjectPageSearch = (search: Parameters<typeof decodeProjectPageSearch>[0]) =>
  Option.getOrElse(decodeProjectPageSearch(search), (): ProjectPageSearch => ({}));

const decodeProjectPageSearch = Schema.decodeUnknownOption(ProjectPageSearch);

/** What is moving first, then what waits, then what is done; recent first within each. */
export function sortTasks(tasks: readonly OrchestrationTask[]): OrchestrationTask[] {
  return tasks.toSorted(
    (left, right) =>
      WORK_STATUS_ORDER.indexOf(left.status) - WORK_STATUS_ORDER.indexOf(right.status) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
}

function hashSeed(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

/** A project's cover is drawn from its id, so it never changes and never needs an upload. */
export function projectCover(seed: string) {
  const hash = hashSeed(seed);

  return {
    color: BLOB_COLORS[hash % (BLOB_COLORS.length - 1)] ?? "#8E8E93",
    shape:
      BLOB_SHAPES[Math.floor(hash / BLOB_COLORS.length) % BLOB_SHAPES.length] ?? DEFAULT_BLOB_SHAPE,
    rotate: (Math.floor(hash / 97) % 7) * 8 - 24,
  };
}

const MINUTE_MS = 60_000;

const DURATION_UNITS = new Map([
  ...["h", "hr", "hrs", "hour", "hours"].map((unit) => [unit, 60 * MINUTE_MS] as const),
  ...["m", "min", "mins", "minute", "minutes"].map((unit) => [unit, MINUTE_MS] as const),
  ...["s", "sec", "secs", "second", "seconds"].map((unit) => [unit, 1000] as const),
]);

/**
 * Reads a spoken-style duration such as "15m", "1h 30m", "1.5 hours",
 * "5 minutes" or "1:30"; a bare number means minutes. Returns milliseconds,
 * or null when the text is not a positive duration of at most 1,000 hours.
 */
export function parseDuration(text: string): number | null {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/\band\b|,/g, " ");

  const clock = /^(\d+):([0-5]\d)$/.exec(input);

  const total = clock
    ? (Number(clock[1]) * 60 + Number(clock[2])) * MINUTE_MS
    : /^\d+(\.\d+)?$/.test(input)
      ? Number(input) * MINUTE_MS
      : parseUnits(input);

  if (total === null) return null;

  const ms = Math.round(total);

  return ms > 0 && ms <= 1000 * 60 * MINUTE_MS ? ms : null;
}

/** Sums "<amount> <unit>" parts; null when anything else is left over or a unit is unknown. */
function parseUnits(input: string): number | null {
  const pattern = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;

  if (input === "" || input.replace(pattern, "").trim() !== "") return null;

  let total = 0;

  for (const [, amount, unit = ""] of input.matchAll(pattern)) {
    const size = DURATION_UNITS.get(unit);

    if (size === undefined) return null;
    total += Number(amount) * size;
  }

  return total;
}

/** A logged duration as hours and minutes, like "1h 20m", "45m" or "<1m". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS);

  if (minutes === 0) return ms > 0 ? "<1m" : "0m";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
