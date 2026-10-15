import {
  type OrchestrationProjectShell,
  type OrchestrationTask,
  ProjectListFilter,
  TaskListFilter,
  type WorkStatus,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

/** FNV-1a with a final mix, so neighbouring ids still land on different covers. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < seed.length; index++) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193);
  }

  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;

  return hash >>> 0;
}

/**
 * Otto: Generated covers are a gradient through three tones of one colour family, ordered-dithered
 * so every pixel is one of the three, the way a halftone print looks.
 */
const COVER_PALETTES = [
  ["#0B2E44", "#1B7FAF", "#7FD0E6"],
  ["#15124F", "#3F4BC9", "#A9B6FF"],
  ["#2A0C40", "#8E3592", "#F29AC4"],
  ["#3A0E0B", "#C2432A", "#FFB06B"],
  ["#0B2A20", "#2A8456", "#A6E09C"],
  ["#161C2A", "#46577A", "#B5C3DD"],
  ["#200F47", "#6538C9", "#C9A6FF"],
  ["#351C02", "#C97C17", "#FFD585"],
] as const;

/** The 8x8 Bayer matrix: each cell's threshold for switching to the next tone. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/** A project's generated cover is drawn from its id, so it stays the same everywhere. */
export function projectCover(seed: string) {
  const hash = hashSeed(seed);
  const pick = (salt: number, size: number) => Math.floor(hash / salt) % size;

  return {
    tones: COVER_PALETTES[hash % COVER_PALETTES.length]!,
    angle: pick(3, 8) * 45,
    glow: { x: 0.2 + pick(29, 7) / 10, y: 0.2 + pick(31, 7) / 10 },
  };
}

/**
 * The cover's pixels, RGBA rows of `width` by `height`: a linear sweep along the cover's angle
 * lifted by a soft glow, each pixel snapped to one of the three tones by the Bayer threshold.
 */
export function ditheredCover(seed: string, width: number, height: number) {
  const { tones, angle, glow } = projectCover(seed);
  const rgb = tones.map((tone) => [1, 3, 5].map((at) => parseInt(tone.slice(at, at + 2), 16)));
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const reach = (Math.abs(dx) + Math.abs(dy)) / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const v = y / Math.max(1, height - 1);
      const sweep = ((u - 0.5) * dx + (v - 0.5) * dy) / (2 * reach) + 0.5;
      const lift = Math.max(0, 1 - Math.hypot(u - glow.x, (v - glow.y) * 0.5625) * 1.6);
      const level = Math.min(1, Math.max(0, sweep * 0.75 + lift * 0.4)) * (rgb.length - 1);
      const base = Math.min(rgb.length - 2, Math.floor(level));
      const threshold = (BAYER[(y % 8) * 8 + (x % 8)]! + 0.5) / 64;
      const color = rgb[level - base > threshold ? base + 1 : base]!;
      const offset = (y * width + x) * 4;

      pixels.set([color[0]!, color[1]!, color[2]!, 255], offset);
    }
  }

  return pixels;
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
