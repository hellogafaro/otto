import type { OttoPluginRuntimeOptions } from "../../OttoCatalogToolHandlers.ts";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";

import type { RuntimeMode } from "@otto/contracts";

import {
  TurnId,
  type BotPersonalityTone,
  type McpServer,
  type ModelSelection,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  type OttoMemoryThreadAccess,
  type OrchestrationReadModel,
} from "@otto/contracts";
import * as Deferred from "effect/Deferred";
import * as Semaphore from "effect/Semaphore";
import { type BotMemoryAccess } from "../../../memory/BotMemory.ts";
import { type OttoMemoryToolHandler } from "../../../memory/BotMemoryToolHandlers.ts";
import { type OttoControllerSession } from "../../mastra/OttoHarnessTypes.ts";
import { type OttoMemoryTurn } from "../../OttoMemoryTurnHarness.ts";
import { type OttoToolSession } from "../../OttoToolRuntime.ts";
import {
  type AgentControllerSendTurnInput,
  type AgentControllerShape,
} from "../../Services/AgentController.ts";

export type MastraSession = OttoControllerSession;

export interface ResolvedEngine {
  readonly modelSelection: ModelSelection;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly mastraModelId: string;
  readonly botConversation: boolean;
  readonly botName?: string;
  readonly personalityTone?: BotPersonalityTone;
}

export interface ActiveAssistantMessage {
  readonly messageId: string;
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
  outputTokens: number;
  reasoningTokens: number;
  memoryQueued: boolean;
  assistantText: string;
}

export interface PendingTurn {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly message: Parameters<MastraSession["sendMessage"]>[0];
  readonly botUsage: AgentControllerSendTurnInput["botUsage"];
  readonly toolSession: OttoToolSession;
  readonly memoryAccess: BotMemoryAccess | undefined;
  readonly entityMemoryAccess: OttoMemoryThreadAccess | undefined;
  readonly reviewInput: string;
  readonly hiddenWake: boolean;
  readonly delegationResults: string | undefined;
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
  readonly connectorSessionApprovals: Set<string>;
  toolSession: OttoToolSession;
  memoryAccess: BotMemoryAccess | undefined;
  entityMemoryAccess: OttoMemoryThreadAccess | undefined;
  configuredToolSession: OttoToolSession;
  configuredMemoryAccess: BotMemoryAccess | undefined;
  configuredEntityMemoryAccess: OttoMemoryThreadAccess | undefined;
  privateBotMemory: boolean;
  readonly workspaceResourceKey: string;
  readonly pendingApprovals: Map<string, PendingApproval>;
  readonly unsubscribe: () => void;
}

export interface PendingApproval {
  readonly toolName: string;
  readonly action: string;
}

export interface LegacyTurnMemoryState {
  readonly observationPromptId: string;
  observationRecorded: boolean;
  readonly seenEventIds: Set<string>;
  readonly user: string;
  readonly modelId: string;
  turnId: string | undefined;
  dispatchReturned: boolean;
  readonly earlyEvents: Array<ProviderRuntimeEvent>;
  assistant: string;
  readonly memoryTurn: OttoMemoryTurn | undefined;
  readonly hiddenWake: boolean;
  priorMemoryHandler?: OttoMemoryToolHandler;
  reviewMemoryHandler?: OttoMemoryToolHandler;
}

export interface LegacyResourceIdentity {
  readonly workspaceResourceKey: string;
  readonly cwd: string | undefined;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  memoryAccess: BotMemoryAccess | undefined;
  entityMemoryAccess: OttoMemoryThreadAccess | undefined;
  readonly botName: string | undefined;
  readonly personalityTone: BotPersonalityTone;
  readonly memoryAccessKey: string | undefined;
  privateBotMemory: boolean;
}

/** Orchestration access for temporary workers and delegation. */
export interface WorkerOrchestration {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  readonly dispatch: OttoPluginRuntimeOptions["dispatch"];
}
