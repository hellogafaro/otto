import type { ProjectScript } from "@otto/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(input: ProjectScriptRuntimeEnvInput) {
  return {
    OTTO_LEGACY_PROJECT_ROOT: input.project.cwd,
    ...(input.worktreePath ? { OTTO_LEGACY_WORKTREE_PATH: input.worktreePath } : {}),
    ...input.extraEnv,
  };
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
