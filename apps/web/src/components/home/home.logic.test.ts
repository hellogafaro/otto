import {
  AuthSessionId,
  type OrchestrationTask,
  type Routine,
  RoutineId,
  TaskId,
} from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickGreeting, routinesToday, tasksDue } from "./home.logic";

const me = AuthSessionId.make("session-me");

const task = (fields: Partial<OrchestrationTask>) =>
  // SAFETY: the Home rules read only the fields each case sets.
  ({
    owner: null,
    assignees: [],
    status: "pending",
    dueDate: null,
    ...fields,
  }) as OrchestrationTask;

const mine = { kind: "person" as const, personId: me, displayName: "Me" };

describe("pickGreeting", () => {
  it("greets by the time of day", () => {
    expect(pickGreeting(8, 0)).toBe("Morning, {name}");

    expect(pickGreeting(14, 0)).toBe("Afternoon, {name}");

    expect(pickGreeting(20, 0)).toBe("Evening, {name}");

    expect(pickGreeting(2, 0.99)).toBe("Quiet hours, {name}");
  });
});

describe("tasksDue", () => {
  it("keeps my open tasks due by today, the most overdue first", () => {
    const tasks = [
      task({ id: TaskId.make("late"), owner: mine, dueDate: "2026-10-01" }),
      task({ id: TaskId.make("today"), assignees: [mine], dueDate: "2026-10-16" }),
      task({ id: TaskId.make("later"), owner: mine, dueDate: "2026-10-20" }),
      task({ id: TaskId.make("done"), owner: mine, dueDate: "2026-10-01", status: "completed" }),
      task({ id: TaskId.make("theirs"), dueDate: "2026-10-01" }),
    ];

    expect(tasksDue(tasks, me, "2026-10-16").map((due) => due.id)).toEqual(["late", "today"]);
  });
});

describe("routinesToday", () => {
  const routine = (fields: Partial<Routine>) =>
    // SAFETY: the Home rules read only the fields each case sets.
    ({
      enabled: true,
      lifecycle: "enabled",
      nextRunAt: null,
      lastRunAt: null,
      ...fields,
    }) as Routine;

  it("keeps live routines that run or ran today", () => {
    const today = "2026-10-16";

    const runs = [
      routine({ id: RoutineId.make("next"), nextRunAt: "2026-10-16T15:00:00" }),
      routine({ id: RoutineId.make("ran"), lastRunAt: "2026-10-16T07:00:00" }),
      routine({ id: RoutineId.make("tomorrow"), nextRunAt: "2026-10-17T07:00:00" }),
      routine({ id: RoutineId.make("paused"), enabled: false, nextRunAt: "2026-10-16T09:00:00" }),
    ];

    expect(routinesToday(runs, today).map((run) => run.id)).toEqual(["ran", "next"]);
  });
});
