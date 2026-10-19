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
    | "audio_transcribe"
    | "generate_image"
    | "library_create"
    | "library_read"
    | "library_update"
    | "library_share"
    | "library_unshare"
    | "skill_read"
    | "skill_create"
    | "skill_update"
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

function bound<T extends object, K extends keyof T>(target: T, key: K): T[K] {
  const value = target[key];

  return Predicate.isFunction(value) ? value.bind(target) : value;
}

/**
 * The workspace as one turn's shell sees it: every command also gets `environment`, and one
 * that names no folder, or a relative one, runs in or under `cwd`, the computer's root.
 */
export function withCommandEnvironment(
  workspace: Workspace,
  environment: Readonly<Record<string, string>>,
  cwd?: string,
): Workspace {
  const sandbox = workspace.sandbox;

  if (!sandbox?.executeCommand) return workspace;
  const run = sandbox.executeCommand.bind(sandbox);

  const scoped = new Proxy(sandbox, {
    get: (target, key: keyof typeof sandbox) =>
      key === "executeCommand"
        ? (...[command, args, options]: Parameters<typeof run>) =>
            run(command, args, {
              ...options,
              ...(cwd && !options?.cwd?.startsWith("/")
                ? { cwd: options?.cwd ? `${cwd.replace(/\/+$/, "")}/${options.cwd}` : cwd }
                : {}),
              env: { ...options?.env, ...environment },
            })
        : bound(target, key),
  });

  return new Proxy(workspace, {
    get: (target, key: keyof Workspace) => (key === "sandbox" ? scoped : bound(target, key)),
  });
}

export function executable(
  value: unknown,
): value is Pick<Tool, "execute"> & { execute: NonNullable<Tool["execute"]> } {
  return Predicate.isObject(value) && Predicate.isFunction(value.execute);
}
