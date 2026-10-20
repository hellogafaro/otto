import { BotId, RoutineId, ThreadId, Routine, RoutineRun } from "@otto/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  hourlyScheduleText,
  absoluteRunTime,
  relativeRunTime,
  routineFrequencyLabel,
  routineScheduleLabel,
  routineTimeLabel,
  routineTriggerProposalText,
  runStatusTone,
  toRoutinePanelItem,
} from "./routines.ts";

const decodeRoutine = Schema.decodeUnknownSync(Routine);

const decodeRoutineRun = Schema.decodeUnknownSync(RoutineRun);

const routine = decodeRoutine({
  id: RoutineId.make("routine-1"),
  botId: "bot-1",
  targetThreadId: ThreadId.make("thread-1"),
  projectId: "project-1",
  job: "Daily digest",
  procedure: "Summarize the workspace",
  procedureVersion: 2,
  approvalVersion: 2,
  schedule: { kind: "weekly", weekdays: ["friday"], time: "09:00" },
  timezone: "America/New_York",
  skillAssignmentIds: ["assignment-1", "assignment-missing"],
  connectorDependencies: ["mcp-1"],
  sandbox: "local",
  approvalPolicy: "auto",
  delegateToBotId: null,
  enabled: true,
  lifecycle: "enabled",
  nextRunAt: "2026-09-20T13:00:00.000Z",
  lastRunAt: null,
  latestResult: null,
  latestFailure: null,
  createdAt: "2026-09-19T08:00:00.000Z",
  updatedAt: "2026-09-19T08:05:00.000Z",
  deletedAt: null,
});

const run = (id: string, createdAt: string, overrides: Partial<RoutineRun> = {}) =>
  decodeRoutineRun({
    id,
    routineId: routine.id,
    trigger: "manual",
    scheduledFor: null,
    procedureVersion: 2,
    status: "completed",
    threadRef: null,
    result: { summary: "Sent the digest" },
    failure: null,
    usageRef: null,
    startedAt: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

const runs = [
  run("run-old", "2026-09-19T09:00:00.000Z"),
  run("run-new", "2026-09-19T10:00:00.000Z", {
    status: "failed",
    failure: { kind: "provider", message: "Provider timed out" },
  }),
];

describe("toRoutinePanelItem", () => {
  it("resolves names and orders run history newest first", () => {
    const item = toRoutinePanelItem(routine, runs, []);
    expect(item.schedule).toEqual({
      frequency: "weekly",
      time: "09:00",
      timezone: "America/New_York",
      weekday: 5,
      weekdays: [5],
    });
    expect(item.runHistory.map((entry) => entry.id)).toEqual(["run-new", "run-old"]);
    expect(item.latestRun).toMatchObject({ id: "run-new", error: "Provider timed out" });
    expect(item.runHistory[1]?.startedAt).toBe("2026-09-19T09:00:00.000Z");
    expect(item.delegateToBotId).toBeNull();
  });

  it("names every day a weekly routine runs on", () => {
    const item = toRoutinePanelItem(
      {
        ...routine,
        schedule: { kind: "weekly", weekdays: ["monday", "wednesday"], time: "07:30" },
      },
      [],
      [],
    );

    expect(routineScheduleLabel(item.schedule)).toBe(
      "Monday, Wednesday at 07:30 (America/New_York)",
    );
  });

  it("names monthly, quarterly and yearly routines and hourly times in words", () => {
    const schedule = (value: Routine["schedule"]) =>
      toRoutinePanelItem({ ...routine, schedule: value }, [], []).schedule;

    expect(routineFrequencyLabel(schedule({ kind: "monthly", day: 15, time: "09:00" }))).toBe(
      "Monthly on day 15",
    );
    expect(routineFrequencyLabel(schedule({ kind: "quarterly", day: 1, time: "09:00" }))).toBe(
      "Quarterly on day 1",
    );
    expect(
      routineFrequencyLabel(schedule({ kind: "yearly", month: 3, day: 15, time: "09:00" })),
    ).toBe("Yearly on Mar 15");
    expect(routineTimeLabel(schedule({ kind: "hourly", everyHours: 1, time: "09:00" }))).toBe(
      "On the hour",
    );
    expect(routineTimeLabel(schedule({ kind: "hourly", everyHours: 1, time: "09:15" }))).toBe(
      "15 min past",
    );
    expect(routineTimeLabel(schedule({ kind: "hourly", everyHours: 4, time: "10:00" }))).toBe(
      "From 02:00",
    );
  });

  it("pauses a routine an older Otto stopped, not one whose last run failed", () => {
    expect(
      toRoutinePanelItem({ ...routine, enabled: false, lifecycle: "blocked" }, [], []).paused,
    ).toBe(true);
    expect(toRoutinePanelItem({ ...routine, lifecycle: "failed" }, [], []).paused).toBe(false);
  });

  it("carries the bot a routine hands its work to", () => {
    const delegateToBotId = BotId.make("bot-helper");
    expect(toRoutinePanelItem({ ...routine, delegateToBotId }, [], []).delegateToBotId).toBe(
      delegateToBotId,
    );
  });
});

describe("runStatusTone", () => {
  it("names every run status", () => {
    expect(runStatusTone("waiting-for-approval")).toEqual({
      label: "Needs approval",
      variant: "warning",
    });
    expect(runStatusTone("failed").variant).toBe("error");
  });
});

describe("routineTriggerProposalText", () => {
  it("names the app event a proposed routine starts on", () => {
    expect(
      routineTriggerProposalText({
        trigger: { app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", account: " Work " },
      }),
    ).toBe("When GMAIL_NEW_GMAIL_MESSAGE in gmail (Work)");
    expect(routineTriggerProposalText({ trigger: { app: "gmail" } })).toBeNull();
    expect(routineTriggerProposalText(null)).toBeNull();
  });
});

describe("routine run timestamps", () => {
  it("preserves malformed values and relative time boundaries", () => {
    const now = Date.parse("2026-08-11T12:00:00Z");

    expect(absoluteRunTime("invalid")).toBe("");
    expect(relativeRunTime("invalid", now)).toBe("");
    expect(relativeRunTime("2026-08-11T12:00:59Z", now)).toBe("now");
    expect(relativeRunTime("2026-08-11T12:01:00Z", now)).toBe("in 1m");
    expect(relativeRunTime("2026-08-11T11:00:00Z", now)).toBe("1h ago");
    expect(relativeRunTime("2026-08-13T12:00:00Z", now)).toBe("in 2d");
  });

  it("keeps unzoned timestamps in the viewer's local zone", () => {
    const value = "2026-08-11T12:37:00";
    const zoned = new Date(value).toISOString();
    const now = Date.parse("2026-08-11T12:00:00Z");

    expect(absoluteRunTime(value)).toBe(absoluteRunTime(zoned));
    expect(relativeRunTime(value, now)).toBe(relativeRunTime(zoned, now));
  });
});

describe("hourlyScheduleText", () => {
  it("names an hourly schedule by its earliest run of the day", () => {
    expect(hourlyScheduleText(1, "09:15")).toBe("Every hour at 15 min past");
    expect(hourlyScheduleText(1, "09:00")).toBe("Every hour on the hour");
    expect(hourlyScheduleText(3, "09:30")).toBe("Every 3 hours from 00:30");
    expect(hourlyScheduleText(4, "10:00")).toBe("Every 4 hours from 02:00");
  });
});
