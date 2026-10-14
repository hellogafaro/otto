import * as Effect from "effect/Effect";
import {
  type CommandInput,
  type CommandEffect,
  commandId,
  timestampedCommandMetadata,
  dispatch,
} from "./dispatch.ts";

export type CreateLibraryFolderInput = CommandInput<"library.folder.create">;

export type UpdateLibraryFolderInput = CommandInput<"library.folder.update">;

export type DeleteLibraryFolderInput = CommandInput<"library.folder.delete">;

export type UpdateLibraryFileInput = CommandInput<"library.file.update">;

export type DeleteLibraryFileInput = CommandInput<"library.file.delete">;

export const createLibraryFolder: (input: CreateLibraryFolderInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createLibraryFolder",
)(function* (input) {
  const metadata = yield* timestampedCommandMetadata(input);

  return yield* dispatch({
    ...input,
    type: "library.folder.create",
    commandId: metadata.commandId,
    createdAt: metadata.createdAt,
  });
});

export const updateLibraryFolder: (input: UpdateLibraryFolderInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateLibraryFolder",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "library.folder.update",
    commandId: yield* commandId(input),
  });
});

export const deleteLibraryFolder: (input: DeleteLibraryFolderInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteLibraryFolder",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "library.folder.delete",
    commandId: yield* commandId(input),
  });
});

export const updateLibraryFile: (input: UpdateLibraryFileInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateLibraryFile",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "library.file.update",
    commandId: yield* commandId(input),
  });
});

export const deleteLibraryFile: (input: DeleteLibraryFileInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.deleteLibraryFile",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "library.file.delete",
    commandId: yield* commandId(input),
  });
});
