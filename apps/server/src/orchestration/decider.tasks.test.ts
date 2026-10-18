import {
  AuthSessionId,
  BotId,
  CommandId,
  TaskId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "./decider.ts";
import { nextTaskDueDate } from "./decider/tasks.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { asProjectId } from "./test-support/project-decider-fixtures.ts";

const now = "2026-01-01T00:00:00.000Z";

const projectId = asProjectId("project-planning");

const taskId = TaskId.make("task-1");

const person = {
  kind: "person" as const,
  personId: AuthSessionId.make("session-ada"),
  displayName: "Ada",
};

const decideAndProject = (
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
  actor?: { readonly personId: AuthSessionId },
) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({
      command,
      readModel,
      ...(actor ? { actor: { personId: actor.personId, canManageGroups: false } } : {}),
    });

    const planned = Array.isArray(result) ? result : [result];
    let next = readModel;

    for (const [index, event] of planned.entries()) {
      next = yield* projectEvent(next, {
        ...event,
        sequence: next.snapshotSequence + index + 1,
      } as OrchestrationEvent);
    }

    return { events: planned, readModel: next };
  });

const withProject = Effect.gen(function* () {
  const { readModel } = yield* decideAndProject(createEmptyReadModel(now), {
    type: "project.create",
    commandId: CommandId.make("cmd-project-create"),
    projectId,
    title: "Launch",
    workspaceRoot: "/tmp/launch",
    createdAt: now,
  });

  return readModel;
});

it.layer(NodeServices.layer)("decider tasks", (it) => {
  it.effect("creates projects active and unowned unless told otherwise", () =>
    Effect.gen(function* () {
      const readModel = yield* withProject;

      expect(readModel.projects[0]).toMatchObject({
        description: "",
        owner: null,
        resources: [],
        status: "in_progress",
      });
    }),
  );

  it.effect("rejects a project owned by a bot that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.make("cmd-project-ghost-owner"),
          projectId,
          title: "Launch",
          workspaceRoot: "/tmp/launch",
          owner: { kind: "bot", botId: BotId.make("bot-ghost") },
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }).pipe(Effect.flip, Effect.map(String));

      expect(error).toContain("bot-ghost");
    }),
  );

  it.effect("updates project planning fields without touching the rest", () =>
    Effect.gen(function* () {
      const { readModel } = yield* decideAndProject(yield* withProject, {
        type: "project.meta.update",
        commandId: CommandId.make("cmd-project-plan"),
        projectId,
        description: "Ship the beta",
        owner: person,
        resources: [{ type: "link", title: "Spec", url: "https://example.test/spec" }],
        status: "pending",
      });

      expect(readModel.projects[0]).toMatchObject({
        title: "Launch",
        workspaceRoot: "/tmp/launch",
        description: "Ship the beta",
        owner: person,
        resources: [{ type: "link", title: "Spec", url: "https://example.test/spec" }],
        status: "pending",
      });
    }),
  );

  it.effect("creates a task in backlog with unique assignees", () =>
    Effect.gen(function* () {
      const { events, readModel } = yield* decideAndProject(yield* withProject, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-create"),
        taskId,
        projectId,
        title: "Write the launch post",
        assignees: [person, person],
        createdAt: now,
      });

      expect(events[0]?.type).toBe("task.created");
      expect(events[0]?.aggregateKind).toBe("task");
      expect(readModel.tasks).toEqual([
        {
          id: taskId,
          projectId,
          title: "Write the launch post",
          description: "",
          owner: null,
          assignees: [person],
          resources: [],
          dueDate: null,
          repeat: null,
          status: "backlog",
          timeEntries: [],
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }),
  );

  it.effect("rejects tasks for unknown or deleted projects", () =>
    Effect.gen(function* () {
      const missing = yield* decideOrchestrationCommand({
        command: {
          type: "task.create",
          commandId: CommandId.make("cmd-task-orphan"),
          taskId,
          projectId: asProjectId("project-missing"),
          title: "Orphan",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }).pipe(Effect.flip, Effect.map(String));

      expect(missing).toContain("project-missing");

      const { readModel } = yield* decideAndProject(yield* withProject, {
        type: "project.delete",
        commandId: CommandId.make("cmd-project-delete"),
        projectId,
      });

      const deleted = yield* decideOrchestrationCommand({
        command: {
          type: "task.create",
          commandId: CommandId.make("cmd-task-deleted-project"),
          taskId,
          projectId,
          title: "Too late",
          createdAt: now,
        },
        readModel,
      }).pipe(Effect.flip, Effect.map(String));

      expect(deleted).toContain("was deleted");
    }),
  );

  it.effect("rejects an assignee bot that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "task.create",
          commandId: CommandId.make("cmd-task-ghost-bot"),
          taskId,
          projectId,
          title: "Ghost work",
          assignees: [{ kind: "bot", botId: BotId.make("bot-ghost") }],
          createdAt: now,
        },
        readModel: yield* withProject,
      }).pipe(Effect.flip, Effect.map(String));

      expect(error).toContain("bot-ghost");
    }),
  );

  it.effect("applies partial task updates and clears the due date with null", () =>
    Effect.gen(function* () {
      const created = yield* decideAndProject(yield* withProject, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-create"),
        taskId,
        projectId,
        title: "Write the launch post",
        dueDate: "2026-02-01",
        createdAt: now,
      });

      const { readModel } = yield* decideAndProject(created.readModel, {
        type: "task.update",
        commandId: CommandId.make("cmd-task-update"),
        taskId,
        status: "in_progress",
        owner: person,
        dueDate: null,
      });

      expect(readModel.tasks?.[0]).toMatchObject({
        title: "Write the launch post",
        status: "in_progress",
        owner: person,
        dueDate: null,
        createdAt: now,
      });
      expect(readModel.tasks?.[0]?.updatedAt).not.toBe(now);
    }),
  );

  it.effect("logs time as the signed-in person and only they remove it", () =>
    Effect.gen(function* () {
      const ada = { personId: AuthSessionId.make("user-ada") };
      const ben = { personId: AuthSessionId.make("user-ben") };

      const created = yield* decideAndProject(yield* withProject, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-time-create"),
        taskId,
        projectId,
        title: "Write the launch post",
        createdAt: now,
      });

      const logTime = (readModel: OrchestrationReadModel, entryId: string, duration: number) =>
        decideAndProject(
          readModel,
          {
            type: "task.time.add",
            commandId: CommandId.make(`cmd-${entryId}`),
            taskId,
            entryId,
            duration,
            description: "Outline",
            createdAt: now,
          },
          ada,
        );

      const first = yield* logTime(created.readModel, "entry-1", 15 * 60_000);
      const second = yield* logTime(first.readModel, "entry-2", 5 * 60_000);

      expect(second.events[0]?.type).toBe("task.time-added");
      expect(second.readModel.tasks?.[0]?.timeEntries.map((entry) => entry.duration)).toEqual([
        15 * 60_000,
        5 * 60_000,
      ]);
      expect(second.readModel.tasks?.[0]?.timeEntries[0]?.createdBy).toBe(ada.personId);

      const remove = {
        type: "task.time.remove" as const,
        commandId: CommandId.make("cmd-time-remove"),
        taskId,
        entryId: "entry-1",
      };

      const byOther = yield* Effect.flip(decideAndProject(second.readModel, remove, ben));
      expect(byOther.message).toContain("Only the person who logged this time");

      const removed = yield* decideAndProject(second.readModel, remove, ada);
      expect(removed.readModel.tasks?.[0]?.timeEntries.map((entry) => entry.id)).toEqual([
        "entry-2",
      ]);
    }),
  );
  it("schedules the next occurrence after today, counted from the due date", () => {
    expect(nextTaskDueDate("daily", "2026-03-10", "2026-03-09")).toBe("2026-03-11");
    expect(nextTaskDueDate("daily", "2026-03-10", "2026-03-14")).toBe("2026-03-15");
    expect(nextTaskDueDate("weekdays", "2026-03-13", "2026-03-13")).toBe("2026-03-16");
    expect(nextTaskDueDate("weekly", "2026-03-02", "2026-03-18")).toBe("2026-03-23");
    expect(nextTaskDueDate("monthly", "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(nextTaskDueDate("monthly", "2026-01-31", "2026-03-01")).toBe("2026-03-31");
    expect(nextTaskDueDate("weekly", null, "2026-03-18")).toBe("2026-03-25");
    expect(nextTaskDueDate("quarterly", "2026-01-09", "2026-01-09")).toBe("2026-04-09");
    expect(nextTaskDueDate("quarterly", "2025-11-30", "2026-03-01")).toBe("2026-05-30");
    expect(nextTaskDueDate("quarterly", "2026-08-31", "2026-08-31")).toBe("2026-11-30");
    expect(nextTaskDueDate("yearly", "2026-10-18", "2026-10-18")).toBe("2027-10-18");
    expect(nextTaskDueDate("yearly", "2024-02-29", "2024-02-29")).toBe("2025-02-28");
    expect(nextTaskDueDate("yearly", "2024-02-29", "2027-06-01")).toBe("2028-02-29");
  });

  it.effect("completing a repeating task creates the next one and hands it the repeat", () =>
    Effect.gen(function* () {
      const ada = { personId: AuthSessionId.make("user-ada") };

      const created = yield* decideAndProject(yield* withProject, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-repeat-create"),
        taskId,
        projectId,
        title: "Send the monthly report",
        owner: person,
        assignees: [person],
        dueDate: "2099-01-31",
        createdAt: now,
      });

      const repeating = yield* decideAndProject(
        created.readModel,
        {
          type: "task.update",
          commandId: CommandId.make("cmd-task-repeat-set"),
          taskId,
          repeat: "monthly",
        },
        ada,
      );

      expect(repeating.events).toHaveLength(1);
      expect(repeating.events[0]?.payload).toMatchObject({
        changes: { repeat: { from: null, to: "monthly" } },
      });

      const complete = (readModel: OrchestrationReadModel, id: string) =>
        decideAndProject(
          readModel,
          { type: "task.update", commandId: CommandId.make(id), taskId, status: "completed" },
          ada,
        );

      const completed = yield* complete(repeating.readModel, "cmd-task-repeat-complete");

      expect(completed.events.map((event) => event.type)).toEqual(["task.updated", "task.created"]);
      expect(completed.events[0]?.payload).toMatchObject({
        changes: { status: { from: "backlog", to: "completed" } },
      });

      const [done, next] = completed.readModel.tasks ?? [];

      expect(done).toMatchObject({ id: taskId, status: "completed", repeat: null });
      expect(next).toMatchObject({
        projectId,
        title: "Send the monthly report",
        owner: person,
        assignees: [person],
        dueDate: "2099-02-28",
        repeat: "monthly",
        status: "pending",
        timeEntries: [],
      });
      expect(next?.id).not.toBe(taskId);

      const reopened = yield* decideAndProject(
        completed.readModel,
        {
          type: "task.update",
          commandId: CommandId.make("cmd-task-repeat-reopen"),
          taskId,
          status: "pending",
        },
        ada,
      );

      const again = yield* complete(reopened.readModel, "cmd-task-repeat-complete-again");

      expect(again.events.map((event) => event.type)).toEqual(["task.updated"]);
      expect(again.readModel.tasks).toHaveLength(2);
    }),
  );
  it.effect("counts the next due day from the sender's today", () =>
    Effect.gen(function* () {
      const created = yield* decideAndProject(yield* withProject, {
        type: "task.create",
        commandId: CommandId.make("cmd-task-zone-create"),
        taskId,
        projectId,
        title: "Water the plants",
        createdAt: now,
      });

      const repeating = yield* decideAndProject(created.readModel, {
        type: "task.update",
        commandId: CommandId.make("cmd-task-zone-repeat"),
        taskId,
        repeat: "daily",
      });

      const nextDueIn = (timezone: string) =>
        decideAndProject(repeating.readModel, {
          type: "task.update",
          commandId: CommandId.make(`cmd-task-zone-${timezone}`),
          taskId,
          status: "completed",
          timezone,
        }).pipe(Effect.map(({ readModel }) => readModel.tasks?.[1]?.dueDate ?? ""));

      // The test clock reads 1970-01-01T00:00Z: already the 1st at UTC+14, still Dec 31 at UTC-12.
      const ahead = yield* nextDueIn("Etc/GMT-14");
      const behind = yield* nextDueIn("Etc/GMT+12");

      expect(ahead).toBe("1970-01-02");
      expect(behind).toBe("1970-01-01");
    }),
  );
});
