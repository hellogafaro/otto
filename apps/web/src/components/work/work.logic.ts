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
 * Otto: A generated cover is a quiet gray card with a dithered dot texture, so it reads as
 * texture rather than colour and photo covers stand out. Dark themes get a gray a step lighter
 * than the page; light themes a step darker. Each project's id picks one of a few scatter
 * patterns at about the same density, so covers differ in how the dots sit, not how dark they
 * are, and every cover stays the same everywhere.
 */
export const GRAY_COVER_TONES = {
  dark: { base: [0x26, 0x26, 0x26], dots: [0x38, 0x38, 0x38] },
  light: { base: [0xeb, 0xeb, 0xeb], dots: [0xdc, 0xdc, 0xdc] },
} as const;

/**
 * grid: an ordered Bayer lattice. scatter: dots dropped at random. jitter: one dot somewhere
 * in each small square. cluster: small 2x2 dots, one somewhere in each larger square.
 */
export const GRAY_COVER_PATTERNS = ["grid", "scatter", "jitter", "cluster"] as const;

export type GrayCoverPattern = (typeof GRAY_COVER_PATTERNS)[number];

/** About one cell in eight is a dot, whatever the pattern: 8 of 64 for grid, 12% for scatter. */
const GRID_DOTS_PER_TILE = 8;

const SCATTER_CHANCE = 0.12;

/** jitter puts one dot in each 3x3 square; cluster one 2x2 dot in each 6x6 square. */
const JITTER_SQUARE = 3;

const CLUSTER_SQUARE = 6;

/** The scatter pattern a project's cover uses, drawn from its id. */
export function grayCoverPattern(seed: string): GrayCoverPattern {
  return GRAY_COVER_PATTERNS[hashSeed(seed) % GRAY_COVER_PATTERNS.length]!;
}

/** A stable pseudo-random number for one spot on one project's cover. */
function spotHash(seed: number, x: number, y: number) {
  let hash = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);

  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Whether the cell at x, y is a dot in this pattern. */
function isDot(pattern: GrayCoverPattern, seed: number, x: number, y: number) {
  switch (pattern) {
    case "grid":
      return GRID_DOTS_PER_TILE / 64 > bayerThreshold(x, y);

    case "scatter":
      return spotHash(seed, x, y) / 0x1_0000_0000 < SCATTER_CHANCE;

    case "jitter": {
      const spot = spotHash(seed, Math.floor(x / JITTER_SQUARE), Math.floor(y / JITTER_SQUARE));
      const area = JITTER_SQUARE * JITTER_SQUARE;

      return spot % area === (y % JITTER_SQUARE) * JITTER_SQUARE + (x % JITTER_SQUARE);
    }

    case "cluster": {
      const spot = spotHash(seed, Math.floor(x / CLUSTER_SQUARE), Math.floor(y / CLUSTER_SQUARE));
      // The 2x2 dot's top-left corner, kept inside its square.
      const left = spot % (CLUSTER_SQUARE - 1);
      const top = Math.floor(spot / CLUSTER_SQUARE) % (CLUSTER_SQUARE - 1);
      const dx = (x % CLUSTER_SQUARE) - left;
      const dy = (y % CLUSTER_SQUARE) - top;

      return dx >= 0 && dx < 2 && dy >= 0 && dy < 2;
    }
  }
}

/** The generated cover's RGBA pixels, already dithered: each cell is the base tone or a dot. */
export function grayCover(
  seed: string,
  width: number,
  height: number,
  appearance: "light" | "dark",
) {
  const { base, dots } = GRAY_COVER_TONES[appearance];
  const pattern = grayCoverPattern(seed);
  const spotSeed = hashSeed(`${seed}:spots`);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tone = isDot(pattern, spotSeed, x, y) ? dots : base;
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
