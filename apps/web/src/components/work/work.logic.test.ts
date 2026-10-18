import { describe, expect, it } from "vite-plus/test";

import {
  duePresetOf,
  duePresetRange,
  encodeProjectSearch,
  encodeTaskSearch,
  formatDuration,
  parseDuration,
  parseProjectSearch,
  parseTaskSearch,
  GRAY_COVER_TONES,
  grayCover,
  grayCoverDensity,
} from "./work.logic";

describe("duePresetRange", () => {
  it("turns each due filter into a date range and reads it back", () => {
    expect(duePresetRange("overdue", "2026-10-01")).toEqual({ dueTo: "2026-09-30" });
    expect(duePresetRange("today", "2026-10-18")).toEqual({
      dueFrom: "2026-10-18",
      dueTo: "2026-10-18",
    });
    expect(duePresetRange("week", "2026-12-29")).toEqual({
      dueFrom: "2026-12-29",
      dueTo: "2027-01-04",
    });
    expect(duePresetOf({ dueFrom: "2026-10-18", dueTo: "2026-10-24" }, "2026-10-18")).toBe("week");
    expect(duePresetOf({ dueFrom: "2026-10-01" }, "2026-10-18")).toBeUndefined();
  });
});

describe("parseTaskSearch", () => {
  it("reads the sort and order, and writes statuses back as one comma list", () => {
    expect(parseTaskSearch({ sort: "due", order: "desc" })).toEqual({ sort: "due", order: "desc" });
    expect(parseTaskSearch({ sort: "priority" })).toEqual({});
    expect(encodeTaskSearch({ status: ["pending", "in_progress"] })).toEqual({
      status: "pending,in_progress",
    });
  });

  it("reads every filter from the URL", () => {
    expect(
      parseTaskSearch({
        project: "launch",
        owner: "person:ada",
        assignee: "bot:scout",
        status: "pending,in_progress",
        dueFrom: "2026-03-01",
        dueTo: "2026-03-31",
      }),
    ).toEqual({
      project: "launch",
      owner: "person:ada",
      assignee: "bot:scout",
      status: ["pending", "in_progress"],
      dueFrom: "2026-03-01",
      dueTo: "2026-03-31",
    });
  });

  it("ignores unknown params and falls back to no filter on a malformed one", () => {
    expect(parseTaskSearch({ status: "archived", extra: "x" })).toEqual({ status: ["archived"] });
    expect(parseTaskSearch({ owner: "ada" })).toEqual({});
    expect(parseTaskSearch({ status: "done" })).toEqual({});
    expect(parseTaskSearch({ dueTo: "next week" })).toEqual({});
  });
});

describe("parseProjectSearch", () => {
  it("reads the sort and order, and writes statuses back as one comma list", () => {
    expect(parseProjectSearch({ sort: "title", order: "desc" })).toEqual({
      sort: "title",
      order: "desc",
    });
    expect(parseProjectSearch({ sort: "status" })).toEqual({});
    expect(encodeProjectSearch({ status: ["pending", "archived"] })).toEqual({
      status: "pending,archived",
    });
  });

  it("keeps only owner and status", () => {
    expect(parseProjectSearch({ owner: "bot:scout", status: "archived", project: "x" })).toEqual({
      owner: "bot:scout",
      status: ["archived"],
    });
  });
});

describe("grayCover", () => {
  const tonesOf = (pixels: Uint8ClampedArray) => {
    const tones = new Set<string>();

    for (let offset = 0; offset < pixels.length; offset += 4) {
      tones.add(
        `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`,
      );
    }

    return tones;
  };

  it("uses only the base gray and its dot tone, per theme", () => {
    for (const appearance of ["dark", "light"] as const) {
      const { base, dots } = GRAY_COVER_TONES[appearance];

      expect(tonesOf(grayCover(64, 36, appearance))).toEqual(
        new Set([`${base.join(",")},255`, `${dots.join(",")},255`]),
      );
    }
  });

  it("puts more dots toward the lower right than the upper left", () => {
    const width = 64;
    const height = 36;
    const pixels = grayCover(width, height, "dark");
    const dot = GRAY_COVER_TONES.dark.dots[0];

    const dotsIn = (x0: number, y0: number) => {
      let count = 0;

      for (let y = y0; y < y0 + height / 2; y++) {
        for (let x = x0; x < x0 + width / 2; x++) {
          if (pixels[(y * width + x) * 4] === dot) count++;
        }
      }

      return count;
    };

    expect(dotsIn(width / 2, height / 2)).toBeGreaterThan(dotsIn(0, 0));
    expect(grayCoverDensity(0.72, 0.75)).toBeGreaterThan(grayCoverDensity(0, 0));
  });
});

describe("parseDuration", () => {
  it("reads spoken-style durations as milliseconds", () => {
    expect(parseDuration("15m")).toBe(15 * 60_000);
    expect(parseDuration("5 minutes")).toBe(5 * 60_000);
    expect(parseDuration("1h 30m")).toBe(90 * 60_000);
    expect(parseDuration("1 hour and 15 mins")).toBe(75 * 60_000);
    expect(parseDuration("1.5h")).toBe(90 * 60_000);
    expect(parseDuration("2h")).toBe(120 * 60_000);
    expect(parseDuration("1:30")).toBe(90 * 60_000);
    expect(parseDuration("45")).toBe(45 * 60_000);
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("rejects text that is not a positive duration", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("15 parsecs")).toBeNull();
    expect(parseDuration("0m")).toBeNull();
    expect(parseDuration("15m extra")).toBeNull();
    expect(parseDuration("1001h")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("shows hours and minutes", () => {
    expect(formatDuration(20 * 60_000)).toBe("20m");
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(80 * 60_000)).toBe("1h 20m");
    expect(formatDuration(30_000)).toBe("<1m");
    expect(formatDuration(0)).toBe("0m");
  });
});
