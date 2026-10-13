import { describe, expect, it } from "vite-plus/test";

import { AuthSessionId, BotId, ProjectId, TaskId } from "../baseSchemas.ts";
import { matchesProjectFilter, matchesTaskFilter, type OrchestrationTask } from "./work.ts";

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
  status: "in_progress",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ...overrides,
});

describe("matchesTaskFilter", () => {
  it("hides archived tasks unless the status asks for them", () => {
    expect(matchesTaskFilter(task({ status: "archived" }), {})).toBe(false);
    expect(matchesTaskFilter(task({ status: "archived" }), { status: ["archived"] })).toBe(true);
    expect(matchesTaskFilter(task(), { status: ["completed", "cancelled"] })).toBe(false);
  });

  it("narrows by project, owner and assignee keys", () => {
    expect(matchesTaskFilter(task(), { project: ProjectId.make("launch") })).toBe(true);
    expect(matchesTaskFilter(task(), { project: ProjectId.make("other") })).toBe(false);
    expect(matchesTaskFilter(task(), { owner: "person:ada" })).toBe(true);
    expect(matchesTaskFilter(task({ owner: null }), { owner: "person:ada" })).toBe(false);
    expect(matchesTaskFilter(task(), { assignee: "bot:scout" })).toBe(true);
    expect(matchesTaskFilter(task(), { assignee: "person:ada" })).toBe(false);
  });

  it("treats due bounds as inclusive and skips undated tasks", () => {
    expect(matchesTaskFilter(task(), { dueTo: "2026-03-10" })).toBe(true);
    expect(matchesTaskFilter(task(), { dueTo: "2026-03-09" })).toBe(false);
    expect(matchesTaskFilter(task(), { dueFrom: "2026-03-10" })).toBe(true);
    expect(matchesTaskFilter(task({ dueDate: null }), { dueFrom: "2026-01-01" })).toBe(false);
  });
});

describe("matchesProjectFilter", () => {
  it("reads projects without planning fields as active and unowned", () => {
    expect(matchesProjectFilter({}, {})).toBe(true);
    expect(matchesProjectFilter({}, { status: ["in_progress"] })).toBe(true);
    expect(matchesProjectFilter({}, { owner: "bot:scout" })).toBe(false);
    expect(matchesProjectFilter({ owner: scout, status: "archived" }, { owner: "bot:scout" })).toBe(
      false,
    );
  });
});
