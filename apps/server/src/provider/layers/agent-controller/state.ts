import type { MastraDBMessage } from "@mastra/core/agent-controller";
import type { OttoPluginRuntimeOptions } from "../../otto-catalog-tool-handlers.ts";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";

import type { RuntimeMode } from "@otto/contracts";

import {
  TurnId,
  type McpServer,
  type ModelSelection,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  type AuthSessionId,
  type OrchestrationReadModel,
  type RoutineWake,
  type TaskWake,
} from "@otto/contracts";
import * as Deferred from "effect/Deferred";
import type { ChatMemory } from "../../../memory/memories.ts";
import * as Semaphore from "effect/Semaphore";
import { type OttoControllerSession } from "../../mastra/otto-harness-types.ts";
import { type OttoToolSession } from "../../otto-tool-runtime.ts";
import {
  type AgentControllerSendTurnInput,
  type AgentControllerShape,
} from "../../services/agent-controller.ts";

export type MastraSession = OttoControllerSession;

export interface ResolvedEngine {
  readonly modelSelection: ModelSelection;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly mastraModelId: string;
  readonly botConversation: boolean;
  readonly botName?: string;
  readonly botInstructions?: string;
}

export interface ActiveAssistantMessage {
  readonly messageId: string;
  /** The live parts Mastra mutates while it streams this message. */
  parts: MastraDBMessage["content"]["parts"];
  text: string;
  publishedText: string;
  revision: number;
}

export interface ActiveTurn {
  readonly turnId: TurnId;
  readonly assistantMessages: Map<string, ActiveAssistantMessage>;
  waiting: boolean;
  /** Suspended tool calls still waiting for a user answer. */
  readonly suspendedToolCalls: Set<string>;
  finished: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  assistantText: string;
  /** Set once message_post posts; the turn's remaining text then stays private. */
  posted: boolean;
}

export interface PendingTurn {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly message: Parameters<MastraSession["sendMessage"]>[0];
  readonly botUsage: AgentControllerSendTurnInput["botUsage"];
  readonly toolSession: OttoToolSession;
  /** What this chat remembers. */
  readonly memory: ChatMemory | undefined;
  /** The person whose GitHub login the bot's computer gets this turn. */
  readonly askerPersonId: AuthSessionId | null;
  readonly hiddenWake: boolean;
  readonly delegationResults: string | undefined;
  /** What is going on for the bot right now, sent in the turn block. */
  readonly nowContext: string | undefined;
  /** The group turn note, sent in the turn block instead of the stored message. */
  readonly turnNote: string;
  /** The task event this turn answers, sent as signals instead of `message`. */
  readonly taskWake: TaskWake | undefined;
  /** The routine run this turn carries out, sent as a signal instead of `message`. */
  readonly routineWake?: RoutineWake | undefined;
}

export interface ActiveSession {
  startInput: Parameters<AgentControllerShape["startSession"]>[1];
  readonly session: MastraSession;
  readonly turnPreparation: Semaphore.Semaphore;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  cwd: string | undefined;
  readonly createdAt: string;
  readonly mcpServerIds: readonly McpServer["id"][];
  readonly mcpServers: readonly McpServer[];
  runtimeMode: RuntimeMode;
  model: string;
  status: ProviderSession["status"];
  turnAdmissionGeneration: number;
  /** Completes when the current admission generation ends, cancelling turns still preparing. */
  turnPreparationCancelled: Deferred.Deferred<void>;
  activeTurn: ActiveTurn | null;
  admittingTurn: PendingTurn | null;
  readonly pendingTurns: PendingTurn[];
  readonly pendingDispatches: Set<Promise<void>>;
  readonly toolNames: Map<string, string>;
  readonly approvalRequests: Map<string, { readonly name: string; readonly input: unknown }>;
  toolSession: OttoToolSession;
  configuredToolSession: OttoToolSession;
  /** Whether this session's turns get memory: Memory is on and the work is not delegated. */
  configuredMemory: boolean;
  readonly workspaceResourceKey: string;
  readonly pendingApprovals: Map<string, PendingApproval>;
  readonly unsubscribe: () => void;
}

export interface PendingApproval {
  readonly toolName: string;
  readonly action: string;
}

export interface LegacyTurnMemoryState {
  readonly promptId: string;
  persisted: boolean;
  readonly seenEventIds: Set<string>;
  readonly user: string;
  readonly modelId: string;
  turnId: string | undefined;
  dispatchReturned: boolean;
  readonly earlyEvents: Array<ProviderRuntimeEvent>;
  assistant: string;
  readonly hiddenWake: boolean;
}

export interface LegacyResourceIdentity {
  readonly workspaceResourceKey: string;
  readonly cwd: string | undefined;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  memory: boolean;
  readonly botName: string | undefined;
  readonly botInstructions: string | undefined;
}

/** Orchestration access for delegation. */
export interface OrchestrationAccess {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  readonly dispatch: OttoPluginRuntimeOptions["dispatch"];
}
