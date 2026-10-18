import {
  type OrchestrationProjectShell,
  ProjectListView,
  TaskListView,
  WORK_STATUS_ORDER,
  type WorkStatus,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { localDateKey } from "../../timestamp-format";

/** The statuses a person picks; archiving is its own action. */
export const WORK_STATUS_CHOICES = WORK_STATUS_ORDER.filter((status) => status !== "archived");

/** Projects saved before planning fields existed read as active. */
export function projectStatus(project: Pick<OrchestrationProjectShell, "status">): WorkStatus {
  return project.status ?? "in_progress";
}

/** What the Tasks page puts in its URL: statuses as one comma list. */
export const encodeTaskSearch = Schema.encodeSync(TaskListView);

/** Due-date filters a person picks; each is a date range relative to today. */
export const DUE_PRESETS = ["overdue", "today", "week"] as const;

export type DuePreset = (typeof DUE_PRESETS)[number];

function addDays(day: string, days: number): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);

  return localDateKey(new Date(year, month - 1, date + days));
}

/** Overdue ends yesterday; Due today is today; Due this week is today and the next six days. */
export function duePresetRange(
  preset: DuePreset,
  today: string,
): Pick<TaskListView, "dueFrom" | "dueTo"> {
  switch (preset) {
    case "overdue":
      return { dueTo: addDays(today, -1) };
    case "today":
      return { dueFrom: today, dueTo: today };
    case "week":
      return { dueFrom: today, dueTo: addDays(today, 6) };
  }
}

/** The preset a view's due range is today, if any. */
export function duePresetOf(view: TaskListView, today: string): DuePreset | undefined {
  return DUE_PRESETS.find((preset) => {
    const range = duePresetRange(preset, today);

    return range.dueFrom === view.dueFrom && range.dueTo === view.dueTo;
  });
}

/** URL search to a task view; a malformed URL shows the unfiltered list instead of failing. */
export const parseTaskSearch = (search: Parameters<typeof decodeTaskSearch>[0]) =>
  Option.getOrElse(decodeTaskSearch(search), (): TaskListView => ({}));

const decodeTaskSearch = Schema.decodeUnknownOption(TaskListView);

/** What the Projects page puts in its URL: statuses as one comma list. */
export const encodeProjectSearch = Schema.encodeSync(ProjectListView);

/** URL search to a project view; a malformed URL shows the unfiltered list instead of failing. */
export const parseProjectSearch = (search: Parameters<typeof decodeProjectSearch>[0]) =>
  Option.getOrElse(decodeProjectSearch(search), (): ProjectListView => ({}));

const decodeProjectSearch = Schema.decodeUnknownOption(ProjectListView);

/** A project page's tabs; the overview is the default and stays out of the URL. */
export const PROJECT_TABS = ["overview", "tasks", "chats", "library", "secrets"] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

const ProjectPageSearch = Schema.Struct({ tab: Schema.optional(Schema.Literals(PROJECT_TABS)) });

export type ProjectPageSearch = typeof ProjectPageSearch.Type;

export const parseProjectPageSearch = (search: Parameters<typeof decodeProjectPageSearch>[0]) =>
  Option.getOrElse(decodeProjectPageSearch(search), (): ProjectPageSearch => ({}));

const decodeProjectPageSearch = Schema.decodeUnknownOption(ProjectPageSearch);

/** FNV-1a with a final mix, so neighbouring ids still land on different covers. */
export function hashSeed(seed: string): number {
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
 * Otto: A generated cover is a quiet gray card with a two-tone ordered dither, so it reads as
 * texture rather than colour and photo covers stand out. Dark themes get a gray a step lighter
 * than the page; light themes a step darker. Each project's id picks one of a few dither
 * patterns and where it sits, so the grid varies while every cover stays the same everywhere.
 */
export const GRAY_COVER_TONES = {
  dark: { base: [0x26, 0x26, 0x26], dots: [0x38, 0x38, 0x38] },
  light: { base: [0xeb, 0xeb, 0xeb], dots: [0xdc, 0xdc, 0xdc] },
} as const;

export const GRAY_COVER_PATTERNS = ["glow", "sweep", "arc", "waves", "ring"] as const;

export type GrayCoverPattern = (typeof GRAY_COVER_PATTERNS)[number];

/** The densest a cover's dots get, so even the busiest pattern stays a texture. */
const MAX_DENSITY = 0.62;

/** The pattern a project's cover uses and where it sits, drawn from its id. */
export function grayCoverStyle(seed: string) {
  const hash = hashSeed(seed);
  const pick = (salt: number, size: number) => Math.floor(hash / salt) % size;

  return {
    pattern: GRAY_COVER_PATTERNS[hash % GRAY_COVER_PATTERNS.length]!,
    x: 0.15 + pick(7, 8) / 10,
    y: 0.15 + pick(13, 8) / 10,
    angle: pick(17, 8) * 45,
    frequency: 2 + pick(19, 3),
  };
}

/** How densely the dots fall at u, v (0 to 1) for this style, from none up to MAX_DENSITY. */
export function grayCoverDensity(style: ReturnType<typeof grayCoverStyle>, u: number, v: number) {
  const { pattern, x, y, angle, frequency } = style;
  // Covers are 16:9, so distances are measured with v squashed to keep shapes round.
  const dv = (v - y) * 0.5625;
  let level: number;

  switch (pattern) {
    case "glow":
      level = 1 - Math.hypot(u - x, dv) * 1.4;
      break;

    case "sweep": {
      const radians = (angle * Math.PI) / 180;
      const dx = Math.cos(radians);
      const dy = Math.sin(radians);
      // Steeper than a plain ramp, so one side stays clear and the other fills in.
      level = (((u - 0.5) * dx + (v - 0.5) * dy) / (Math.abs(dx) + Math.abs(dy))) * 1.8 + 0.5;
      break;
    }

    case "arc":
      level = 1 - Math.abs(Math.hypot(u - x, (v - 1.6) * 0.5625) - 0.75) * 4;
      break;

    case "waves":
      level =
        0.5 +
        0.5 *
          Math.sin((u * 0.6 + v + Math.sin(u * Math.PI * 2 + x * 6) * 0.12) * Math.PI * frequency);
      break;

    case "ring":
      level = 1 - Math.abs(Math.hypot(u - x, dv) - 0.28) * 5;
      break;
  }

  return Math.min(1, Math.max(0, level)) * MAX_DENSITY;
}

/** The generated cover's RGBA pixels, already dithered: each cell is the base tone or a dot. */
export function grayCover(
  seed: string,
  width: number,
  height: number,
  appearance: "light" | "dark",
) {
  const { base, dots } = GRAY_COVER_TONES[appearance];
  const style = grayCoverStyle(seed);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = grayCoverDensity(style, x / width, y / height) > bayerThreshold(x, y);
      const tone = on ? dots : base;
      const offset = (y * width + x) * 4;

      pixels[offset] = tone[0];
      pixels[offset + 1] = tone[1];
      pixels[offset + 2] = tone[2];
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

/** The 8x8 Bayer matrix: each cell's threshold for stepping up to the next brightness level. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

const DITHER_LEVELS = 8;

/** The Bayer threshold, between 0 and 1, for the cell at x, y. */
export function bayerThreshold(x: number, y: number) {
  return (BAYER[(y % 8) * 8 + (x % 8)]! + 0.5) / 64;
}

/**
 * Ordered dither in place: each pixel's brightness snaps to one of eight levels by the Bayer
 * threshold and the whole colour shifts with it, so the dots keep the picture's hues.
 */
export function ditherPixels(pixels: Uint8ClampedArray, width: number) {
  const step = 255 / (DITHER_LEVELS - 1);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const x = (offset / 4) % width;
    const y = Math.floor(offset / 4 / width);

    const threshold = bayerThreshold(x, y);

    const luma =
      0.2126 * pixels[offset]! + 0.7152 * pixels[offset + 1]! + 0.0722 * pixels[offset + 2]!;

    const level = Math.floor(luma / step);

    const shift = (luma / step - level > threshold ? level + 1 : level) * step - luma;

    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = pixels[offset + channel]! + shift;
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
