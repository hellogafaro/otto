import { describe, expect, it } from "vite-plus/test";

import {
  formatDuration,
  parseDuration,
  parseProjectSearch,
  parseTaskSearch,
  projectCover,
} from "./work.logic";

describe("parseTaskSearch", () => {
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
  it("keeps only owner and status", () => {
    expect(parseProjectSearch({ owner: "bot:scout", status: "archived", project: "x" })).toEqual({
      owner: "bot:scout",
      status: ["archived"],
    });
  });
});

describe("projectCover", () => {
  it("is stable per seed", () => {
    expect(projectCover("launch")).toEqual(projectCover("launch"));
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
