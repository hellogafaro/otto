import { AuthSessionId, ProjectId, TaskId, type WorkStatus } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionTaskRepositoryLive } from "../persistence/layers/projection-tasks.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { ProjectionTaskRepository } from "../persistence/services/projection-tasks.ts";
import { getTask } from "./task-get.ts";

const seed = (id: string, status: WorkStatus) =>
  Effect.gen(function* () {
    const tasks = yield* ProjectionTaskRepository;

    yield* tasks.upsert({
      id: TaskId.make(id),
      projectId: ProjectId.make("launch"),
      title: id,
      description: "",
      owner: null,
      assignees: [],
      resources: [],
      dueDate: null,
      repeat: null,
      priority: null,
      status,
      timeEntries: [],
      createdBy: null,
      updatedBy: null,
      completedAt: null,
      completedBy: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

const logTime = (id: string, taskId: string, createdAt: string) =>
  Effect.gen(function* () {
    const tasks = yield* ProjectionTaskRepository;

    yield* tasks.insertTimeEntry({
      id,
      taskId: TaskId.make(taskId),
      duration: 15,
      description: "",
      personId: AuthSessionId.make("ada"),
      date: createdAt.slice(0, 10),
      createdBy: { type: "person", id: AuthSessionId.make("ada") },
      createdAt,
    });
  });

const get = (taskId: string) =>
  Effect.gen(function* () {
    const projectionTasks = yield* ProjectionTaskRepository;

    return yield* getTask({ taskId: TaskId.make(taskId) }, { projectionTasks });
  });

const layer = it.layer(
  ProjectionTaskRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("getTask", (it) => {
  it.effect("reads one task with only its own timesheet, oldest entry first", () =>
    Effect.gen(function* () {
      yield* seed("a", "in_progress");
      yield* seed("b", "pending");
      yield* logTime("a-2", "a", "2026-10-03T00:00:00.000Z");
      yield* logTime("a-1", "a", "2026-10-02T00:00:00.000Z");
      yield* logTime("b-1", "b", "2026-10-02T00:00:00.000Z");

      const task = yield* get("a");
      assert.strictEqual(task.id, "a");
      assert.strictEqual(task.status, "in_progress");
      assert.deepStrictEqual(
        task.timeEntries.map((entry) => entry.id),
        ["a-1", "a-2"],
      );
    }),
  );

  it.effect("reads an archived task, which lists leave out by default", () =>
    Effect.gen(function* () {
      yield* seed("old", "archived");

      assert.strictEqual((yield* get("old")).status, "archived");
    }),
  );

  it.effect("refuses a task that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(get("missing"));

      assert.strictEqual(error._tag, "TaskNotFoundError");
      assert.strictEqual(error.taskId, "missing");
    }),
  );
});
