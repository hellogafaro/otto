import * as Effect from "effect/Effect";
import {
  type CommandInput,
  type CommandEffect,
  commandId,
  timestampedCommandMetadata,
  dispatch,
} from "./dispatch.ts";

export type CreateTaskInput = CommandInput<"task.create">;

export type UpdateTaskInput = CommandInput<"task.update">;

export type AddTaskTimeInput = CommandInput<"task.time.add">;

export type RemoveTaskTimeInput = CommandInput<"task.time.remove">;

export const createTask: (input: CreateTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createTask",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);

  return yield* dispatch({
    ...input,
    type: "task.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateTask: (input: UpdateTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "task.update",
    commandId: yield* commandId(input),
  });
});

export const addTaskTime: (input: AddTaskTimeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.addTaskTime",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);

  return yield* dispatch({
    ...input,
    type: "task.time.add",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const removeTaskTime: (input: RemoveTaskTimeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.removeTaskTime",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "task.time.remove",
    commandId: yield* commandId(input),
  });
});
