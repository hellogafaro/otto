import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { vi } from "vite-plus/test";
import type { OttoBotWorkspace } from "../bot-workspace.ts";

export function makebotWorkspacePoolTestSupport() {
  const localWorkspace = () =>
    new Workspace({
      filesystem: new LocalFilesystem({ basePath: process.cwd() }),
      sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
    });

  function remoteWorkspace(overrides: Partial<OttoBotWorkspace> = {}): OttoBotWorkspace {
    return {
      id: "otto-persistent",
      provider: "boat",
      workspace: localWorkspace(),
      inspect: vi.fn(async () => "running" as const),
      wake: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  return { localWorkspace, remoteWorkspace };
}
