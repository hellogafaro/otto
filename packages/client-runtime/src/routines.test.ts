import {
  BotId,
  SkillAssignmentId,
  McpServerId,
  RoutineId,
  ThreadId,
  Routine,
  RoutineRun,
  SkillId,
} from "@otto/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { createTranslator } from "./i18n/index.ts";
import { zhCNCatalog } from "./i18n/zh-cn.ts";
import {
  hourlyScheduleText,
  absoluteRunTime,
  relativeRunTime,
  botRoutinesView,
  routineApprovalSummary,
  routineLifecycleAction,
  routineFrequencyLabel,
  routineScheduleLabel,
  routineStateNote,
  routineTimeLabel,
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

const snapshot = {
  routines: [
    routine,
    { ...routine, id: RoutineId.make("routine-deleted"), lifecycle: "deleted" as const },
    { ...routine, id: RoutineId.make("routine-other"), botId: BotId.make("bot-2") },
  ],
  routineRuns: [
    run("run-old", "2026-09-19T09:00:00.000Z"),
    run("run-new", "2026-09-19T10:00:00.000Z", {
      status: "failed",
      failure: { kind: "provider", message: "Provider timed out" },
    }),
  ],
  skillAssignments: [
    {
      id: SkillAssignmentId.make("assignment-1"),
      name: "research",
      botId: routine.botId,
      skillId: SkillId.make("research"),
      description: null,
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    },
  ],
  mcpServers: [
    {
      id: McpServerId.make("mcp-1"),
      name: "Gmail",
      transport: "stdio",
      command: "gmail",
      enabled: true,
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt,
    },
  ],
} satisfies Parameters<typeof botRoutinesView>[0];

describe("toRoutinePanelItem", () => {
  it("resolves names and orders run history newest first", () => {
    const item = toRoutinePanelItem(routine, snapshot!.routineRuns!, [], []);
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
      [],
    );

    expect(routineScheduleLabel(item.schedule)).toBe(
      "Monday, Wednesday at 07:30 (America/New_York)",
    );
  });

  it("names monthly, quarterly and yearly routines and hourly times in words", () => {
    const schedule = (value: Routine["schedule"]) =>
      toRoutinePanelItem({ ...routine, schedule: value }, [], [], []).schedule;

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

  it("carries the bot a routine hands its work to", () => {
    const delegateToBotId = BotId.make("bot-helper");
    expect(toRoutinePanelItem({ ...routine, delegateToBotId }, [], [], []).delegateToBotId).toBe(
      delegateToBotId,
    );
  });
});

describe("botRoutinesView", () => {
  it("waits for the snapshot before claiming anything", () => {
    expect(botRoutinesView(null, "bot-1")).toEqual({ kind: "loading" });
  });

  it("separates an environment without routines from a bot without routines", () => {
    expect(botRoutinesView({}, "bot-1")).toEqual({ kind: "unavailable" });
    expect(botRoutinesView({ routines: [] }, "bot-1")).toEqual({ kind: "ready", routines: [] });
  });

  it("keeps only the bot's live routines with their skills and connectors", () => {
    const view = botRoutinesView(snapshot, "bot-1");
    expect(view.kind).toBe("ready");

    if (view.kind !== "ready") return;
    expect(view.routines.map((item) => item.id)).toEqual(["routine-1"]);
    expect(view.routines[0]).toMatchObject({
      skills: ["research"],
      connectors: ["Gmail"],
      procedureApproved: true,
    });
  });
});

describe("routineLifecycleAction", () => {
  const item = toRoutinePanelItem(routine, [], [], []);

  it("offers only the reverse of the state a routine is in", () => {
    expect(routineLifecycleAction(item)).toBe("pause");
    expect(routineLifecycleAction({ ...item, paused: true })).toBe("resume");
    expect(routineLifecycleAction({ ...item, enabled: false })).toBe("enable");
  });

  it("offers nothing for a draft until its procedure is approved", () => {
    expect(routineLifecycleAction({ ...item, enabled: false, procedureApproved: false })).toBe(
      null,
    );
  });
});

describe("routineStateNote", () => {
  const item = toRoutinePanelItem(routine, [], [], []);

  it("says nothing while a routine runs on schedule", () => {
    expect(routineStateNote(item)).toBe(null);
  });

  it("says how to resume a paused routine, including one an older Otto stopped", () => {
    expect(routineStateNote({ ...item, paused: true })).toBe("Paused until you resume it.");

    const blocked = toRoutinePanelItem(
      { ...routine, enabled: false, lifecycle: "blocked" },
      [],
      [],
      [],
    );

    expect(routineStateNote(blocked)).toBe("Paused until you resume it.");
  });

  it("keeps a routine whose last run failed on its schedule", () => {
    const failed = toRoutinePanelItem({ ...routine, lifecycle: "failed" }, [], [], []);

    expect(failed.paused).toBe(false);
    expect(routineStateNote(failed)).toBeNull();
  });

  it("names the way back for a routine that is off or still a draft", () => {
    expect(routineStateNote({ ...item, enabled: false })).toBe("Off until you turn it back on.");
    expect(routineStateNote({ ...item, enabled: false, procedureApproved: false })).toBe(
      "Draft. Approve its procedure to schedule it.",
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

describe("routineApprovalSummary", () => {
  it("summarizes a proposed weekly routine", () => {
    expect(
      routineApprovalSummary({
        name: "Friday review",
        instructions: "Review the week.",
        schedule: { kind: "weekly", weekdays: ["monday", "friday"], time: "14:00" },
      }),
    ).toEqual({
      name: "Friday review",
      instructions: "Review the week.",
      schedule: "Monday, Friday at 14:00",
    });
  });

  it("still renders a malformed proposal as a reviewable approval", () => {
    expect(routineApprovalSummary(null)).toEqual({
      name: "New routine",
      instructions: null,
      schedule: null,
    });
    expect(routineApprovalSummary({ schedule: { kind: "weekdays", time: "09:00" } })).toEqual({
      name: "New routine",
      instructions: null,
      schedule: "Weekdays at 09:00",
    });
  });

  it("shows the proposed timezone beside a wall-clock schedule", () => {
    expect(
      routineApprovalSummary({
        schedule: { kind: "weekdays", time: "09:00" },
        timezone: "America/New_York",
      }).schedule,
    ).toBe("Weekdays at 09:00 (America/New_York)");
    expect(
      routineApprovalSummary({
        schedule: { kind: "weekdays", time: "09:00" },
        timezone: { invalid: true },
      }).schedule,
    ).toBe("Weekdays at 09:00");
  });

  it("follows the interface language", () => {
    const { t } = createTranslator("zh-CN", zhCNCatalog);
    expect(
      routineApprovalSummary({ name: "Brief", schedule: { kind: "daily", time: "08:00" } }, t)
        .schedule,
    ).toBe(t("{schedule} at {time}", { schedule: t("Daily"), time: "08:00" }));
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
