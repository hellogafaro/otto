import { type TaskGetInput, type TaskListQuery, WS_METHODS } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import {
  createTask,
  createTaskTime,
  deleteTask,
  deleteTaskTime,
  updateTask,
  type CreateTaskInput,
  type CreateTaskTimeInput,
  type DeleteTaskInput,
  type DeleteTaskTimeInput,
  type UpdateTaskInput,
} from "../operations/commands.ts";
import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";
import { cacheTasks } from "./task-cache.ts";

export {
  recordTaskShellItem,
  taskCacheAtom,
  taskChangesAtom,
  type CachedTask,
  type TaskCache,
} from "./task-cache.ts";

export type {
  CreateTaskInput,
  CreateTaskTimeInput,
  DeleteTaskInput,
  DeleteTaskTimeInput,
  UpdateTaskInput,
} from "../operations/commands.ts";

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
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:delete",
      execute: (input: DeleteTaskInput) => deleteTask(input),
      scheduler,
      concurrency,
    }),
    createTime: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:time:create",
      execute: (input: CreateTaskTimeInput) => createTaskTime(input),
      scheduler,
      concurrency,
    }),
    deleteTime: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:task:time:delete",
      execute: (input: DeleteTaskTimeInput) => deleteTaskTime(input),
      scheduler,
      concurrency,
    }),
  };
}
