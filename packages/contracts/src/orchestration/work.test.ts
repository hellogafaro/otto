import { describe, expect, it } from "vite-plus/test";

import { AuthSessionId, BotId, ProjectId, TaskId } from "../base-schemas.ts";
import * as Schema from "effect/Schema";

import { OrchestrationTask as TaskSchema, type OrchestrationTask, WorkResources } from "./work.ts";

const decodeResources = Schema.decodeUnknownSync(WorkResources);

const decodeTask = Schema.decodeUnknownSync(TaskSchema);

const encodeTask = Schema.encodeSync(TaskSchema);

const ada = { kind: "person" as const, personId: AuthSessionId.make("ada"), displayName: "Ada" };

const scout = { kind: "bot" as const, botId: BotId.make("scout") };

const task = (overrides: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id: TaskId.make("task-1"),
  projectId: ProjectId.make("launch"),
  title: "Write the post",
  description: "",
  owner: ada,
  assignees: [scout],
  resources: [],
  dueDate: "2026-03-10",
  repeat: null,
  priority: null,
  status: "in_progress",
  timeEntries: [],
  createdBy: null,
  updatedBy: null,
  completedAt: null,
  completedBy: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

describe("work resources", () => {
  it("reads saved links without a type and accepts internal items", () => {
    const resources = decodeResources([
      { title: "Spec", url: "https://example.com/spec" },
      { type: "task", id: "task-2" },
      { type: "project", id: "launch" },
      { type: "file", id: "file-1" },
    ]);

    expect(resources.map((resource) => resource.type)).toEqual(["link", "task", "project", "file"]);
  });

  it("gives tasks saved before timesheets an empty one", () => {
    const { timeEntries: _omitted, ...saved } = task();

    expect(decodeTask(saved).timeEntries).toEqual([]);
  });

  it("reads tasks saved before priorities and completion with neither", () => {
    const {
      priority: _priority,
      createdBy: _createdBy,
      updatedBy: _updatedBy,
      completedAt: _completedAt,
      completedBy: _completedBy,
      ...saved
    } = task();

    expect(decodeTask(saved)).toMatchObject({
      priority: null,
      createdBy: null,
      updatedBy: null,
      completedAt: null,
      completedBy: null,
    });
  });

  it("reads time saved before bots logged it as the person's own, on its creation day", () => {
    const saved = {
      id: "entry-1",
      taskId: "task-1",
      duration: 30 * 60_000,
      description: "Outline",
      createdBy: "ada",
      createdAt: "2026-03-02T10:00:00.000Z",
    };

    const decoded = decodeTask({ ...task(), timeEntries: [saved] });

    expect(decoded.timeEntries).toEqual([
      {
        id: "entry-1",
        taskId: "task-1",
        duration: 30 * 60_000,
        description: "Outline",
        personId: "ada",
        date: "2026-03-02",
        createdBy: { type: "person", id: "ada" },
        createdAt: "2026-03-02T10:00:00.000Z",
      },
    ]);
    expect(encodeTask(decoded).timeEntries?.at(0)).toMatchObject({
      personId: "ada",
      createdBy: { type: "person", id: "ada" },
    });
  });
});
