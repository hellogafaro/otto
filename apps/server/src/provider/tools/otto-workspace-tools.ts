import type { Tool } from "@mastra/core/tools";
import * as Predicate from "effect/Predicate";
import { createWorkspaceTools, type Workspace } from "@mastra/core/workspace";
import { type OttoToolId } from "@otto/contracts";
import { type OttoToolSession } from "./otto-tool-types.ts";

export const BACKEND_NAMES: Record<
  Exclude<
    OttoToolId,
    | "CopyToBox"
    | "CopyFromBox"
    | "request_box_help"
    | "CreateAgent"
    | "CheckAgent"
    | "MessageAgent"
    | "StopAgent"
    | "SendToAgent"
    | "Task"
    | "CheckSubagent"
    | "MessageSubagent"
    | "StopSubagent"
    | "CreateChannel"
    | "UpdateChannel"
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
  Screenshot: ["mastra_workspace_computer_screenshot"],
  ExternalShell: ["execute_command", "mastra_workspace_execute_command"],
  ExternalRead: ["view", "mastra_workspace_read_file"],
  AwaitShell: ["get_process_output", "mastra_workspace_get_process_output"],
  AwaitExternalShell: ["get_process_output", "mastra_workspace_get_process_output"],
};

export function workspaceForTool(toolId: OttoToolId, session: OttoToolSession) {
  return toolId === "ExternalShell" || toolId === "ExternalRead" || toolId === "AwaitExternalShell"
    ? session.userComputerWorkspace
    : session.workspace;
}

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
