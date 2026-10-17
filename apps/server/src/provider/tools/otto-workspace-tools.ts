import type { Tool } from "@mastra/core/tools";
import * as Predicate from "effect/Predicate";
import { createWorkspaceTools, type Workspace } from "@mastra/core/workspace";
import { type OttoToolId } from "@otto/contracts";

export const BACKEND_NAMES: Record<
  Exclude<
    OttoToolId,
    | "bot_create"
    | "edit"
    | "delegate_check"
    | "delegate_stop"
    | "delegate"
    | "message_post"
    | "bot_update"
    | "connection_search"
    | "connection_read"
    | "connection_create"
    | "connection_update"
    | "connection_check"
    | "connection_delete"
    | "message_react"
    | "web_search"
    | "web_fetch"
    | "image_create"
    | "generate_image"
    | "library_create"
    | "library_read"
    | "library_update"
    | "skill_read"
    | "search"
    | "task_read"
    | "task_create"
    | "task_update"
    | "task_comment"
  >,
  ReadonlyArray<string>
> = {
  shell: ["execute_command", "mastra_workspace_execute_command"],
  read: ["view", "mastra_workspace_read_file"],
};

export async function toolsForWorkspace(workspace: Workspace | undefined) {
  if (!workspace) return {};

  return createWorkspaceTools(workspace, {
    requestContext: {},
    workspace,
  });
}

export function executable(
  value: unknown,
): value is Pick<Tool, "execute"> & { execute: NonNullable<Tool["execute"]> } {
  return Predicate.isObject(value) && Predicate.isFunction(value.execute);
}
