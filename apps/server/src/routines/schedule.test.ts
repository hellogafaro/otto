import { assert, it } from "@effect/vitest";

import { latestScheduledFor, nextScheduledFor } from "./schedule.ts";

it("keeps daily wall time across daylight saving changes", () => {
  assert.equal(
    nextScheduledFor(
      { kind: "daily", time: "09:00" },
      "America/New_York",
      Date.parse("2026-03-07T15:00:00.000Z"),
    ),
    "2026-03-08T13:00:00.000Z",
  );
});

it("finds the latest weekday slot for missed-run coalescing", () => {
  assert.equal(
    latestScheduledFor(
      { kind: "weekdays", time: "09:00" },
      "America/New_York",
      Date.parse("2026-08-31T20:00:00.000Z"),
    ),
    "2026-08-31T13:00:00.000Z",
  );
});

it("runs an hourly routine every interval, lined up with its time", () => {
  const schedule = { kind: "hourly", everyHours: 3, time: "09:30" } as const;

  assert.equal(
    nextScheduledFor(schedule, "Europe/Madrid", Date.parse("2026-10-13T13:40:00.000Z")),
    "2026-10-13T16:30:00.000Z",
  );
  assert.equal(
    nextScheduledFor(schedule, "Europe/Madrid", Date.parse("2026-10-13T22:00:00.000Z")),
    "2026-10-13T22:30:00.000Z",
  );
  assert.equal(
    latestScheduledFor(schedule, "Europe/Madrid", Date.parse("2026-10-13T13:40:00.000Z")),
    "2026-10-13T13:30:00.000Z",
  );
});

it("runs an every-hour routine at the next minute mark", () => {
  assert.equal(
    nextScheduledFor(
      { kind: "hourly", everyHours: 1, time: "00:15" },
      "UTC",
      Date.parse("2026-10-13T23:20:00.000Z"),
    ),
    "2026-10-14T00:15:00.000Z",
  );
});
