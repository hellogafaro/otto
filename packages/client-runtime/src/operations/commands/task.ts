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
