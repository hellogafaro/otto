import type {
  AuthSessionId,
  ComposioToolkit,
  ComputerWatchError,
  BotEngine,
  BotId,
  ModelSelection,
  McpServer,
  ProviderInteractionMode,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  ProviderTurnStartResult,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
  OrchestrationCommand,
  TaskWake,
  OrchestrationReadModel,
  OrchestrationThread,
  ThreadId,
} from "@otto/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { MemoryChat } from "../../memory/memories.ts";
import type { OttoDelegationDispatch, OttoDelegationHandle } from "../otto-delegation-runtime.ts";
import type { AgentControllerError, AgentControllerRuntimeError } from "../errors.ts";
import type { ProviderAdapterCapabilities } from "./provider-adapter.ts";
import type { ProviderInstanceRoutingInfo } from "./provider-adapter-registry.ts";

export interface AgentControllerAvailableEngine {
  readonly modelSelection: ModelSelection;
  readonly routing: ProviderInstanceRoutingInfo;
  readonly capabilities: ProviderAdapterCapabilities;
}

export interface AgentControllerEngineSelection extends AgentControllerAvailableEngine {
  readonly mode: ProviderInteractionMode;
}

export type AgentControllerSendTurnInput = ProviderSendTurnInput & {
  readonly botUsage?: {
    readonly botId: BotId;
  };
  /**
   * Finished child work acknowledged for this turn, formatted as context. Each
   * provider path adds it to this turn only; it is never queued as a message.
   */
  readonly delegationResults?: string;
  /** The chat's memory scopes and audience, derived on the server for this turn. */
  readonly memoryChat?: MemoryChat;
  /** The person whose message this turn answers. */
  readonly authorPersonId?: AuthSessionId | null;
  /** The task event this turn answers, sent as signals instead of `input`. */
  readonly taskWake?: TaskWake;
  /** The person the bot acts for on GitHub this turn: the author, else the task or chat owner. */
  readonly askerPersonId?: AuthSessionId | null;
};

export interface AgentControllerShape {
  readonly configurePluginRuntime?: (input: {
    readonly readSnapshot: () => Promise<OrchestrationReadModel>;
    readonly dispatch: (
      command: OrchestrationCommand,
    ) => Promise<{ readonly sequence: number } | void>;
    readonly searchComposioToolkits?: (input: {
      readonly query?: string;
      readonly limit?: number;
      readonly bot?: { readonly botId: string; readonly ownerPersonId: string | null };
    }) => Promise<{
      readonly status: "available" | "setup-required" | "unavailable";
      readonly toolkits: readonly ComposioToolkit[];
      readonly connectedToolkits?: readonly string[];
    }>;
  }) => Effect.Effect<void>;
  readonly configureDelegation?: (input: {
    readonly readSnapshot: () => Promise<OrchestrationReadModel>;
    readonly readThread?: (threadId: ThreadId) => Promise<OrchestrationThread | undefined>;
    readonly dispatch: (command: OrchestrationCommand) => Promise<{ readonly sequence: number }>;
  }) => Effect.Effect<void>;
  readonly failDelegation?: (input: {
    readonly threadId: ThreadId;
    readonly error: string;
  }) => Effect.Effect<void>;
  /** Starts a delegation retry or a scheduled delegation; no live turn owns it. */
  readonly dispatchDelegation?: (
    input: OttoDelegationDispatch,
  ) => Effect.Effect<OttoDelegationHandle, AgentControllerRuntimeError>;

  readonly authenticateMcpServer: (input: {
    readonly server: McpServer;
    readonly onAuthorizationUrl: (url: string) => void;
  }) => Effect.Effect<
    { readonly toolCount: number; readonly recoveryFailures: readonly string[] },
    AgentControllerError
  >;

  /** The tools a remote MCP server offers, from a live session or a short-lived connection. */
  readonly listMcpServerTools?: (input: {
    readonly server: McpServer;
  }) => Effect.Effect<
    { readonly toolNames: readonly string[]; readonly needsSignIn: boolean },
    AgentControllerError
  >;

  /** Resolve a thread's selected mode and model to an available Otto provider instance. */
  readonly resolveEngine: (input: {
    readonly threadId: ThreadId;
    readonly engine: BotEngine | null;
    readonly fallback: ModelSelection;
    readonly mode: ProviderInteractionMode;
    readonly botConversation: boolean;
  }) => Effect.Effect<AgentControllerEngineSelection, AgentControllerError>;

  /** Read routing metadata without changing the thread's active runtime session. */
  readonly inspectEngine: (
    modelSelection: ModelSelection,
  ) => Effect.Effect<AgentControllerAvailableEngine, AgentControllerError>;

  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, AgentControllerError>;

  readonly sendTurn: (
    input: AgentControllerSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, AgentControllerError>;

  /**
   * Adds a person's message to the turn the thread's bot is running, so the bot
   * reads it at its next step. False when no turn is running to take it.
   */
  readonly signalTurn: (
    input: Pick<ProviderSendTurnInput, "threadId" | "input" | "attachments"> & {
      readonly taskWake?: TaskWake;
    },
  ) => Effect.Effect<boolean, AgentControllerError>;

  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, AgentControllerError>;

  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, AgentControllerError>;

  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, AgentControllerError>;

  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, AgentControllerError>;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, AgentControllerError>;

  readonly uploadFeedback: (
    input: ProviderUploadFeedbackInput,
  ) => Effect.Effect<ProviderUploadFeedbackResult, AgentControllerError>;

  /** The computer a chat's bot is using, for the people allowed to watch it live. */
  readonly computerWatch: (threadId: ThreadId) => Effect.Effect<
    {
      readonly botId: BotId;
      readonly turnRunning: boolean;
      readonly url: Effect.Effect<string, ComputerWatchError>;
    },
    ComputerWatchError
  >;

  /**
   * Codex events are normalized from Mastra controller sessions. Other provider
   * adapters already produce the canonical event contract. Runtime ingestion
   * consumes the merged stream once.
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

export class AgentController extends Context.Service<AgentController, AgentControllerShape>()(
  "@otto/server/provider/services/agent-controller/AgentController",
) {}
