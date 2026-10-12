import type { BotWorkspaceIO } from "./BotWorkspaceIO.ts";
import { Workspace } from "@mastra/core/workspace";
import type { BotSandbox } from "@otto/contracts";
import { WorkspaceComputer } from "../workspaceComputer.ts";

export const REMOTE_BOT_SANDBOXES = [
  "e2b",
  "daytona",
  "vercel",
  "upstash",
  "ascii",
  "railway",
  "tenki",
] as const;

export type RemoteBotSandbox = (typeof REMOTE_BOT_SANDBOXES)[number];

export type OttoWorkspaceState = "running" | "sleeping" | "missing";

export interface OttoBrowserEndpoint {
  readonly url: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
}

export interface OttoBotWorkspace {
  readonly id: string;
  readonly provider: BotSandbox;
  readonly providerId?: string;
  readonly computer?: WorkspaceComputer;
  readonly workspace: Workspace;
  readonly browserEndpoint?: (port: number) => Promise<OttoBrowserEndpoint>;
  readonly inspect: () => Promise<OttoWorkspaceState>;
  readonly wake: () => Promise<void>;
  readonly sleep: () => Promise<void>;
  readonly destroy: () => Promise<void>;
}

export interface OttoRemoteSession {
  readonly providerId: string;
  readonly computer?: WorkspaceComputer;
  readonly inspect: () => Promise<OttoWorkspaceState>;
  readonly run: (
    command: string,
    args: readonly string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readonly browserEndpoint: (port: number) => Promise<OttoBrowserEndpoint>;
  readonly wake: () => Promise<void>;
  readonly sleep: () => Promise<void>;
  readonly destroy: () => Promise<void>;
}

export interface CreateRemoteBotWorkspaceInput {
  readonly io: BotWorkspaceIO;
  readonly threadId: string;
  readonly sandbox: RemoteBotSandbox;
  readonly identityFile?: string;
  readonly workspaceId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly openSession?: (providerId?: string) => Promise<OttoRemoteSession>;
}

export interface CreateBotWorkspaceInput {
  readonly io: BotWorkspaceIO;
  readonly threadId: string;
  readonly cwd?: string;
  readonly identityFile?: string;
  readonly localRoot?: string;
  readonly sandbox?: BotSandbox | null;
  readonly workspaceId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly makeRemoteWorkspace?: (
    input: CreateRemoteBotWorkspaceInput,
  ) => Promise<OttoBotWorkspace | Workspace>;
}
