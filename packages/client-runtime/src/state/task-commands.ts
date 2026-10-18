import {
  type EnvironmentId,
  type OrchestrationShellStreamItem,
  type OrchestrationTask,
  type TaskGetInput,
  type TaskId,
  type TaskListItem,
  type TaskListQuery,
  WS_METHODS,
} from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import {
  addTaskTime,
  createTask,
  removeTaskTime,
  updateTask,
  type AddTaskTimeInput,
  type CreateTaskInput,
  type RemoveTaskTimeInput,
  type UpdateTaskInput,
} from "../operations/commands.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";

export type {
  AddTaskTimeInput,
  CreateTaskInput,
  RemoveTaskTimeInput,
  UpdateTaskInput,
} from "../operations/commands.ts";

/** A task as this client last read it; a list row has no timesheet until the task itself is read. */
export type CachedTask = TaskListItem & Partial<Pick<OrchestrationTask, "timeEntries">>;

export interface TaskCache {
  readonly tasks: ReadonlyMap<TaskId, CachedTask>;
  /** The tasks read whole or changed since the last snapshot, so their timesheet is current. */
  readonly current: ReadonlySet<TaskId>;
}

const EMPTY_TASK_CACHE: TaskCache = { tasks: new Map(), current: new Set() };

/**
 * Otto: The tasks this client has read, by id. The shell snapshot no longer carries tasks, so
 * `tasks.get` and `tasks.list` results fill this and task events keep it current.
 */
export const taskCacheAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(EMPTY_TASK_CACHE).pipe(Atom.keepAlive, Atom.withLabel(`task-cache:${environmentId}`)),
);

/** Otto: Counts every task event and snapshot, so a task list reloads whenever any task changes. */
export const taskChangesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`task-changes:${environmentId}`)),
);

/** Keeps the newer of a cached and an incoming task; a list row keeps the cached timesheet. */
function cacheTasks(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  tasks: ReadonlyArray<CachedTask>,
) {
  if (tasks.length === 0) return;

  registry.update(taskCacheAtom(environmentId), (cache) => {
    const next = new Map(cache.tasks);
    const current = new Set(cache.current);

    for (const task of tasks) {
      const cached = next.get(task.id);

      if (cached === undefined || cached.updatedAt <= task.updatedAt) {
        next.set(task.id, { ...cached, ...task });
      }

      if (task.timeEntries !== undefined) current.add(task.id);
    }

    return { tasks: next, current };
  });
}

/**
 * Feeds the task cache from the shell: an event replaces its task, and a snapshot, which may
 * follow missed events, leaves every cached task to be read again.
 */
export function applyTaskShellItem(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  item: OrchestrationShellStreamItem,
) {
  if (item.kind === "snapshot") {
    registry.update(taskCacheAtom(environmentId), (cache) => ({
      tasks: cache.tasks,
      current: new Set<TaskId>(),
    }));
  } else if (item.kind === "task-upserted") {
    cacheTasks(registry, environmentId, [item.task]);
  } else {
    return;
  }

  registry.update(taskChangesAtom(environmentId), (count) => count + 1);
}

export function createTaskEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();

  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { taskId: string } }) =>
      JSON.stringify([environmentId, input.taskId]),
  };

  return {
    /** One page of the bounded task list; its rows fill the task cache. */
    list: createEnvironmentCommand(runtime, {
      label: "environment-data:tasks:list",
      execute: (input: TaskListQuery, registry, environmentId) =>
        request(WS_METHODS.tasksList, input).pipe(
          Effect.tap((result) =>
            Effect.sync(() => cacheTasks(registry, environmentId, result.tasks)),
          ),
        ),
    }),
    /** One task with its timesheet, into the task cache. */
    get: createEnvironmentCommand(runtime, {
      label: "environment-data:tasks:get",
      execute: (input: TaskGetInput, registry, environmentId) =>
        request(WS_METHODS.tasksGet, input).pipe(
          Effect.tap((task) => Effect.sync(() => cacheTasks(registry, environmentId, [task]))),
        ),
    }),
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:create",
      execute: (input: CreateTaskInput) => createTask(input),
      scheduler,
      concurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:update",
      execute: (input: UpdateTaskInput) => updateTask(input),
      scheduler,
      concurrency,
    }),
    addTime: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:time:add",
      execute: (input: AddTaskTimeInput) => addTaskTime(input),
      scheduler,
      concurrency,
    }),
    removeTime: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:time:remove",
      execute: (input: RemoveTaskTimeInput) => removeTaskTime(input),
      scheduler,
      concurrency,
    }),
  };
}
