import { describe, expect, it } from "vite-plus/test";

import { AuthSessionId, BotId, ProjectId, TaskId } from "../base-schemas.ts";
import * as Schema from "effect/Schema";

import { OrchestrationTask as TaskSchema, type OrchestrationTask, WorkResources } from "./work.ts";

const decodeResources = Schema.decodeUnknownSync(WorkResources);

const decodeTask = Schema.decodeUnknownSync(TaskSchema);

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
  status: "in_progress",
  timeEntries: [],
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
    ]);

    expect(resources.map((resource) => resource.type)).toEqual(["link", "task", "project"]);
  });

  it("gives tasks saved before timesheets an empty one", () => {
    const { timeEntries: _omitted, ...saved } = task();

    expect(decodeTask(saved).timeEntries).toEqual([]);
  });
});
