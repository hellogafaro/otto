import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { type ToolsInput } from "@mastra/core/agent";
import {
  AgentController as MastraAgentController,
  type MastraDBMessage,
  type Session,
} from "@mastra/core/agent-controller";
import {
  type OttoCreateRoutineInput as OttoCreateRoutineInputValue,
  type OttoUpdateRoutineInput as OttoUpdateRoutineInputValue,
} from "@otto/contracts";
import type { SubscriptionAuthService } from "../../subscription-auth/service.ts";
import type { OttoOpenCodeGoAccess } from "../otto-open-code-go-provider.ts";
import { type OttoKimiAccess } from "../otto-kimi-provider.ts";
import type { OttoToolRuntime, OttoToolResult } from "../tools/otto-tool-types.ts";
import {
  type OttoRoutineListResult,
  type OttoRoutineDeleteResult,
  type OttoRoutinePausedResult,
  type OttoRoutineUpdateResult,
} from "./otto-routine-schemas.ts";

import type { OttoModelOptions } from "../reasoning-options.ts";

export interface OttoMastraState {
  readonly providerInstanceId?: string;
  // Undefined clears a previous directory when a reused session loses its cwd.
  readonly projectPath?: string | undefined;
  readonly yolo?: boolean;
  readonly botConversation?: boolean;
  readonly botName?: string;
  readonly botId?: string;
  // Undefined clears the instructions when the bot's owner removes them.
  readonly botInstructions?: string | undefined;
  readonly persistentMemoryContext?: string;
  readonly mcpInstructions?: string;
  // Undefined clears the catalog when the bot no longer has skills.
  readonly skillsContext?: string | undefined;
  // Undefined clears the roster when a reused session leaves its group chat.
  readonly groupContext?: string | undefined;
  // Otto: undefined clears the project when a reused session moves to the general project.
  readonly projectContext?: string | undefined;
  readonly workspaceName?: string | undefined;
  /** The workspace's people and projects. */
  readonly workspaceContext?: string | undefined;
  /** The person's timezone for this turn's date and time. */
  readonly timezone?: string | undefined;
  /** Why the bot is answering now, sent last and never stored: group turn, memory review, results. */
  readonly turnContext?: string | undefined;
  readonly modelOptions?: OttoModelOptions;
}

export type OttoMastraSession = Session<OttoMastraState>;

/** Session methods used by Otto's injected controller boundary. */
export type OttoControllerSession = Pick<
  OttoMastraSession,
  | "subscribe"
  | "sendMessage"
  | "sendSignal"
  | "queueSignal"
  | "grantTool"
  | "abort"
  | "respondToToolApproval"
  | "respondToToolSuspension"
> & {
  readonly stream: Pick<OttoMastraSession["stream"], "isActive" | "waitForTeardown">;
  readonly run: Pick<OttoMastraSession["run"], "getRunId" | "waitForTeardown">;
  readonly state: Pick<OttoMastraSession["state"], "get" | "set">;
  readonly mode: Pick<OttoMastraSession["mode"], "get" | "switch">;
  readonly model: Pick<OttoMastraSession["model"], "get" | "switch">;
  readonly permissions: Pick<OttoMastraSession["permissions"], "setForCategory" | "setForTool">;
};

export interface OttoMastraHarnessOptions {
  readonly authStorage: AuthStorage;
  readonly getKimiAccess?: (
    instanceId?: string,
    threadId?: string,
  ) => Promise<OttoKimiAccess | undefined>;
  readonly getOpenCodeGoApiKey?: (
    instanceId?: string,
    threadId?: string,
  ) => Promise<OttoOpenCodeGoAccess | undefined>;
  readonly getSubscriptionApiKey?: SubscriptionAuthService["getApiKeyCredential"];
  readonly getSubscriptionOAuth?: SubscriptionAuthService["getOAuthCredential"];
  readonly getSubscriptionAccessToken?: SubscriptionAuthService["getAccessToken"];
  readonly getModelConnection?: (providerInstanceId: string) =>
    | {
        readonly environment: NodeJS.ProcessEnv;
        readonly instanceEnvironment: NodeJS.ProcessEnv;
        readonly useSavedCredential: boolean;
        readonly instanceId?: string;
      }
    | undefined;
  /** The store that holds every chat's messages. */
  readonly memoryDbPath: string;
  /** Reserves usage for a history compaction; returns the call id to finish it with. */
  readonly startCompaction?: (input: {
    readonly threadId: string;
    readonly modelId: string;
  }) => Promise<string | undefined>;
  readonly finishCompaction?: (input: {
    readonly callId: string;
    readonly usage?: {
      readonly inputTokens: number;
      readonly cachedInputTokens: number;
      readonly cacheCreationTokens: number;
      readonly outputTokens: number;
    };
    readonly error?: Error;
  }) => Promise<void>;
  readonly getThreadTools: (threadId: string) => ToolsInput;
  /** Called before a failed model stream for this thread is retried from the start. */
  readonly onStreamRetry?: (threadId: string) => void;
  readonly toolRuntime: OttoToolRuntime;
  readonly createRoutine?: (
    threadId: string,
    input: OttoCreateRoutineInputValue,
  ) => Promise<OttoToolResult>;
  readonly listRoutines?: (threadId: string) => Promise<OttoRoutineListResult>;
  readonly deleteRoutines?: (
    threadId: string,
    routineIds: ReadonlyArray<string>,
  ) => Promise<OttoRoutineDeleteResult>;
  readonly updateRoutine?: (
    threadId: string,
    routineId: string,
    input: OttoUpdateRoutineInputValue,
  ) => Promise<OttoRoutineUpdateResult>;
  readonly setRoutinePaused?: (
    threadId: string,
    routineId: string,
    paused: boolean,
  ) => Promise<OttoRoutinePausedResult>;
  /** Names of the secrets a chat's commands get, from its project and from the chat itself. */
  readonly secretNames?: (threadId: string) => Promise<ReadonlyArray<string>>;
}

export type OttoControllerHarness = OttoMastraHarness<OttoControllerSession>;

export interface OttoMastraHarness<SessionType = OttoMastraSession> {
  readonly rebuildConversation?: (
    threadId: string,
    messages: ReadonlyArray<MastraDBMessage>,
  ) => Promise<() => Promise<void>>;
  readonly controller: Pick<MastraAgentController<OttoMastraState>, "init" | "deleteSession"> & {
    createSession(
      ...args: Parameters<MastraAgentController<OttoMastraState>["createSession"]>
    ): Promise<SessionType>;
  };
  /** Stores a turn another provider ran, so the chat keeps one history across providers. */
  readonly persistExternalTurn?: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly modelId: string;
    readonly userMessages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
    readonly assistant: string;
    readonly createdAt: string;
  }) => Promise<void>;
}

export type OttoMastraToolOptions = Pick<
  OttoMastraHarnessOptions,
  | "authStorage"
  | "getKimiAccess"
  | "getOpenCodeGoApiKey"
  | "getThreadTools"
  | "toolRuntime"
  | "createRoutine"
  | "listRoutines"
  | "deleteRoutines"
  | "updateRoutine"
  | "setRoutinePaused"
  | "secretNames"
>;
