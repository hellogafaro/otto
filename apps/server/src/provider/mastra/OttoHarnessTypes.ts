import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { type ToolsInput } from "@mastra/core/agent";
import {
  AgentController as MastraAgentController,
  type MastraDBMessage,
  type Session,
} from "@mastra/core/agent-controller";
import {
  type OttoConversationMemorySnapshot,
  type BotPersonalityTone,
  type OttoCreateRoutineInput as OttoCreateRoutineInputValue,
  type OttoUpdateRoutineInput as OttoUpdateRoutineInputValue,
} from "@otto/contracts";
import * as Duration from "effect/Duration";
import type { SubscriptionAuthService } from "../../subscription-auth/service.ts";
import type { OttoOpenCodeGoAccess } from "../OttoOpenCodeGoProvider.ts";
import { type OttoKimiAccess } from "../OttoKimiProvider.ts";
import type { OttoToolRuntime, OttoToolResult } from "../tools/OttoToolTypes.ts";
import {
  type OttoRoutineListResult,
  type OttoRoutineDeleteResult,
  type OttoRoutinePausedResult,
  type OttoRoutineUpdateResult,
} from "./OttoRoutineSchemas.ts";

import type { OttoModelOptions } from "../ReasoningOptions.ts";

export interface OttoMastraState {
  readonly providerInstanceId?: string;
  // Undefined clears a previous directory when a reused session loses its cwd.
  readonly projectPath?: string | undefined;
  readonly yolo?: boolean;
  readonly botConversation?: boolean;
  readonly botName?: string;
  readonly personalityTone?: BotPersonalityTone;
  readonly persistentMemoryContext?: string;
  readonly mcpInstructions?: string;
  // Undefined clears the roster when a reused session leaves its group chat.
  readonly groupContext?: string | undefined;
  readonly modelOptions?: OttoModelOptions;
}

export type OttoMastraSession = Session<OttoMastraState>;

/** Session methods used by Otto's injected controller boundary. */
export type OttoControllerSession = Pick<
  OttoMastraSession,
  | "subscribe"
  | "sendMessage"
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
  readonly memoryDbPath: string;
  /**
   * How long closing the harness waits for admitted memory work before it
   * interrupts that work. Defaults to five seconds.
   */
  readonly observationCloseGrace?: Duration.Input;
  readonly startMemoryCall?: (input: {
    readonly threadId: string;
    readonly category: "observer" | "reflector";
  }) => Promise<string | undefined>;
  readonly finishMemoryCall?: (input: {
    readonly callId: string;
    readonly category: "observer" | "reflector";
    readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
    };
    readonly error?: Error;
  }) => Promise<void>;
  readonly getThreadTools: (threadId: string) => ToolsInput;
  /** Called before a failed model stream for this thread is retried from the start. */
  readonly onStreamRetry?: (threadId: string) => void;
  readonly syncThreadToolApproval?: (
    threadId: string,
    toolName: string,
    protectedAction: boolean,
  ) => Promise<void>;
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
  readonly onObservationDropped?: (input: {
    /** Stable queue-row id; retried notices reuse it. */
    readonly observationId: string;
    readonly threadId: string;
    readonly turnId?: string;
    readonly resourceId: string;
    readonly modelId: string;
    readonly attempts: number;
    readonly error: Error;
  }) => Promise<void> | void;
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
  readonly clearObservationalMemory?: (threadId: string, resourceId?: string) => Promise<void>;
  readonly readObservationalMemory?: (
    threadId: string,
    resourceId?: string,
  ) => Promise<OttoConversationMemorySnapshot>;
  readonly restoreObservationalMemory?: (
    threadId: string,
    snapshot: OttoConversationMemorySnapshot,
    resourceId?: string,
    expectedSnapshot?: OttoConversationMemorySnapshot,
  ) => Promise<void>;
  readonly observeAfterTurn?: (input: OttoBackgroundObservationInput) => Promise<void>;
  readonly observeExternalTurn?: (input: {
    readonly threadId: string;
    readonly turnId: string;
    readonly modelId: string;
    readonly userMessages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
    readonly assistant: string;
    readonly createdAt: string;
  }) => Promise<void>;
  readonly drainObservationQueue?: () => Promise<void>;
}

export interface OttoBackgroundObservationInput {
  readonly threadId: string;
  readonly resourceId?: string;
  readonly modelId: string;
  /** Routes the observer to this instance's own credentials. */
  readonly providerInstanceId?: string;
  readonly turnId?: string;
}

export type OttoMastraToolOptions = Pick<
  OttoMastraHarnessOptions,
  | "authStorage"
  | "getKimiAccess"
  | "getOpenCodeGoApiKey"
  | "getThreadTools"
  | "syncThreadToolApproval"
  | "toolRuntime"
  | "createRoutine"
  | "listRoutines"
  | "deleteRoutines"
  | "updateRoutine"
  | "setRoutinePaused"
>;
