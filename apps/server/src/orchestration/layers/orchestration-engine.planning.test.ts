import { AuthSessionId, CommandId, TaskId } from "@otto/contracts";
import { expect, it } from "vite-plus/test";
import {
  botId,
  createRestartSystem,
  nowIso,
  projectId,
} from "./test-support/orchestration-restart-system.ts";

const person = {
  kind: "person" as const,
  personId: AuthSessionId.make("session-ada"),
  displayName: "Ada",
};

it("persists project planning fields and tasks through restart", async () => {
  const system = await createRestartSystem();

  try {
    await system.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make("plan-project"),
      projectId,
      description: "Ship the beta",
      owner: { kind: "bot", botId },
      resources: [{ type: "link", title: "Spec", url: "https://example.test/spec" }],
      status: "pending",
    });
    await system.dispatch({
      type: "task.create",
      commandId: CommandId.make("create-task"),
      taskId: TaskId.make("task-1"),
      projectId,
      title: "Write the launch post",
      owner: person,
      assignees: [person, { kind: "bot", botId }],
      dueDate: "2026-02-01",
      createdAt: nowIso(),
    });
    await system.dispatch({
      type: "task.update",
      commandId: CommandId.make("start-task"),
      taskId: TaskId.make("task-1"),
      status: "in_progress",
    });
    await system.restart();

    const snapshot = await system.readShellSnapshot();

    expect(snapshot.projects.find((project) => project.id === projectId)).toMatchObject({
      description: "Ship the beta",
      owner: { kind: "bot", botId },
      resources: [{ type: "link", title: "Spec", url: "https://example.test/spec" }],
      status: "pending",
    });
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        projectId,
        title: "Write the launch post",
        owner: person,
        assignees: [person, { kind: "bot", botId }],
        dueDate: "2026-02-01",
        status: "in_progress",
      }),
    ]);

    await expect(
      system.dispatch({
        type: "task.create",
        commandId: CommandId.make("create-task-again"),
        taskId: TaskId.make("task-1"),
        projectId,
        title: "Duplicate",
        createdAt: nowIso(),
      }),
    ).rejects.toThrow("already exists");
  } finally {
    await system.dispose();
  }
});
