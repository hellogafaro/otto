import { describe, expect, it } from "vite-plus/test";

import { formatRosterTimestamp } from "./roster.logic";

describe("formatRosterTimestamp", () => {
  const now = new Date("2026-08-27T15:00:00").getTime();

  it("shows a clock time today, Yesterday, then weekday, then date", () => {
    expect(formatRosterTimestamp("2026-08-27T09:30:00", "24-hour", now)).toBe("09:30");
    expect(formatRosterTimestamp("2026-08-26T09:30:00", "24-hour", now)).toBe("Yesterday");
    expect(formatRosterTimestamp("2026-08-24T09:30:00", "24-hour", now)).not.toContain(":");
    expect(formatRosterTimestamp("2026-01-02T09:30:00", "24-hour", now)).toContain("2");
  });

  it("shows Tomorrow, then the weekday, for a routine's next run", () => {
    expect(formatRosterTimestamp("2026-08-28T09:30:00", "24-hour", now)).toBe("Tomorrow");
    expect(formatRosterTimestamp("2026-08-31T09:30:00", "24-hour", now)).not.toContain(":");
  });

  it("returns empty for an invalid date", () => {
    expect(formatRosterTimestamp("nope", "24-hour", now)).toBe("");
  });
});
