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

export type DeleteTaskInput = CommandInput<"task.delete">;

export type CreateTaskTimeInput = CommandInput<"task.time.create">;

export type DeleteTaskTimeInput = CommandInput<"task.time.delete">;

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

/** The server counts days in the organization's time zone, so no device zone is sent. */
export const updateTask: (input: UpdateTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "task.update",
    commandId: yield* commandId(input),
  });
});

export const deleteTask: (input: DeleteTaskInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteTask",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "task.delete",
    commandId: yield* commandId(input),
  });
});

export const createTaskTime: (input: CreateTaskTimeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createTaskTime",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);

  return yield* dispatch({
    ...input,
    type: "task.time.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const deleteTaskTime: (input: DeleteTaskTimeInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteTaskTime",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "task.time.delete",
    commandId: yield* commandId(input),
  });
});
