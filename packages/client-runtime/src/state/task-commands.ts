import { WS_METHODS } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
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
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
} from "./runtime.ts";

export type {
  AddTaskTimeInput,
  CreateTaskInput,
  RemoveTaskTimeInput,
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
    /** One page of the bounded task list; the Tasks page asks for each page as it scrolls. */
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tasks:list",
      tag: WS_METHODS.tasksList,
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
