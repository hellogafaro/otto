import type { BotWorkspaceIO } from "./bot-workspace-io.ts";
import { Workspace } from "@mastra/core/workspace";
import type { BotSandbox } from "@otto/contracts";

export const REMOTE_BOT_SANDBOXES = ["boat"] as const;

export type RemoteBotSandbox = (typeof REMOTE_BOT_SANDBOXES)[number];

export type OttoWorkspaceState = "running" | "sleeping" | "missing";

export interface OttoBotWorkspace {
  readonly id: string;
  readonly provider: BotSandbox;
  readonly providerId?: string;
  readonly workspace: Workspace;
  readonly inspect: () => Promise<OttoWorkspaceState>;
  readonly wake: () => Promise<void>;
  readonly sleep: () => Promise<void>;
  readonly destroy: () => Promise<void>;
  /** A fresh secret link to the computer's live desktop, where the provider streams one. */
  readonly desktopUrl?: () => Promise<string>;
  /** While a turn runs: wakes the computer if the provider stopped it and pushes its auto-stop back. */
  readonly keepAlive?: () => Promise<void>;
  /** After a turn: shortens the provider's auto-stop so an idle computer stops soon. */
  readonly idle?: () => Promise<void>;
  /** Writes a file at an absolute path through a file API, never a command, so secrets stay out of command logs. */
  readonly writePrivateFile?: (path: string, content: string) => Promise<void>;
}

export interface OttoRemoteSession {
  readonly providerId: string;
  readonly inspect: () => Promise<OttoWorkspaceState>;
  readonly run: (
    command: string,
    args: readonly string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readonly wake: () => Promise<void>;
  readonly sleep: () => Promise<void>;
  readonly destroy: () => Promise<void>;
  readonly desktopUrl?: () => Promise<string>;
  readonly keepAlive?: () => Promise<void>;
  readonly idle?: () => Promise<void>;
  readonly writePrivateFile?: (path: string, content: string) => Promise<void>;
}

export interface CreateRemoteBotWorkspaceInput {
  readonly io: BotWorkspaceIO;
  readonly threadId: string;
  readonly sandbox: RemoteBotSandbox;
  readonly identityFile?: string;
  /** Where the record lived before it moved beside the computer's folder. */
  readonly legacyIdentityFile?: string;
  readonly workspaceId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly openSession?: (providerId?: string) => Promise<OttoRemoteSession>;
}

export interface CreateBotWorkspaceInput {
  readonly io: BotWorkspaceIO;
  readonly threadId: string;
  readonly cwd?: string;
  readonly identityFile?: string;
  readonly legacyIdentityFile?: string;
  readonly localRoot?: string;
  /** Server-owned directory for local isolation profiles, outside every bot-writable path. */
  readonly sandboxProfileDirectory?: string;
  readonly sandbox?: BotSandbox | null;
  readonly workspaceId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly makeRemoteWorkspace?: (
    input: CreateRemoteBotWorkspaceInput,
  ) => Promise<OttoBotWorkspace | Workspace>;
}
