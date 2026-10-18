import { EnvironmentId, ProjectId, TaskId } from "@otto/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { baseSnapshot } from "./shell-reducer.test-support.ts";
import { recordTaskShellItem, taskCacheAtom, taskChangesAtom } from "./task-cache.ts";

const environmentId = EnvironmentId.make("environment-tasks");

const task = {
  id: TaskId.make("task-1"),
  projectId: ProjectId.make("project-1"),
  title: "Write the launch post",
  description: "",
  owner: null,
  assignees: [],
  resources: [],
  dueDate: null,
  repeat: null,
  status: "pending" as const,
  timeEntries: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("task cache", () => {
  it("caches task events, counts every change and marks tasks stale on a snapshot", () => {
    const registry = AtomRegistry.make();

    recordTaskShellItem(registry, environmentId, { kind: "task-upserted", sequence: 1, task });
    recordTaskShellItem(registry, environmentId, {
      kind: "task-upserted",
      sequence: 2,
      task: { ...task, status: "in_progress", updatedAt: "2026-10-02T00:00:00.000Z" },
    });

    expect(registry.get(taskCacheAtom(environmentId)).tasks.get(task.id)?.status).toBe(
      "in_progress",
    );
    expect(registry.get(taskCacheAtom(environmentId)).current.has(task.id)).toBe(true);
    expect(registry.get(taskChangesAtom(environmentId))).toBe(2);

    recordTaskShellItem(registry, environmentId, { kind: "snapshot", snapshot: baseSnapshot });

    expect(registry.get(taskCacheAtom(environmentId)).tasks.get(task.id)?.status).toBe(
      "in_progress",
    );
    expect(registry.get(taskCacheAtom(environmentId)).current.size).toBe(0);
    expect(registry.get(taskChangesAtom(environmentId))).toBe(3);

    recordTaskShellItem(registry, environmentId, { kind: "synchronized" });

    expect(registry.get(taskChangesAtom(environmentId))).toBe(3);
  });

  it("keeps the newer task when an older one arrives late", () => {
    const registry = AtomRegistry.make();

    recordTaskShellItem(registry, environmentId, {
      kind: "task-upserted",
      sequence: 1,
      task: { ...task, title: "Newer", updatedAt: "2026-10-03T00:00:00.000Z" },
    });
    recordTaskShellItem(registry, environmentId, {
      kind: "task-upserted",
      sequence: 2,
      task: { ...task, title: "Older" },
    });

    expect(registry.get(taskCacheAtom(environmentId)).tasks.get(task.id)?.title).toBe("Newer");
  });
});
