import type { Tool } from "@mastra/core/tools";
import * as Predicate from "effect/Predicate";
import { createWorkspaceTools, type Workspace } from "@mastra/core/workspace";
import { type OttoToolId } from "@otto/contracts";

export const BACKEND_NAMES: Record<
  Exclude<
    OttoToolId,
    | "CreateAgent"
    | "CheckAgent"
    | "MessageAgent"
    | "StopAgent"
    | "SendToAgent"
    | "SendToUser"
    | "UpdateBotProfile"
    | "SearchPlugins"
    | "GetPlugin"
    | "ReactToMessage"
    | "InstallPlugin"
    | "UninstallPlugin"
    | "GetMcpServerStatus"
    | "TestMcpServer"
    | "ReconnectMcpServer"
    | "AuthenticateMcpServer"
    | "RestartMcpServers"
    | "WebSearch"
    | "WebFetch"
    | "GenerateImage"
    | "generate_image"
    | "SaveToLibrary"
    | "ListLibrary"
    | "ReadLibraryFile"
    | "UpdateLibraryDocument"
    | "ListSkills"
    | "ReadSkillFile"
    | "ListTasks"
    | "ReadTask"
    | "CreateTask"
    | "UpdateTask"
    | "CommentOnTask"
    | "AddMcpServer"
    | "UninstallMcpServer"
    | "RemoveMcpAccount"
    | "RenameMcpAccount"
    | "SetMcpInstructions"
  >,
  ReadonlyArray<string>
> = {
  Shell: ["execute_command", "mastra_workspace_execute_command"],
  Read: ["view", "mastra_workspace_read_file"],
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
