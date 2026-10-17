import type { Tool } from "@mastra/core/tools";
import { type Workspace } from "@mastra/core/workspace";
import {
  type OttoDelegationAccessGrant,
  OttoToolInputSchemas,
  type BotId,
  type OttoToolId,
  type OttoToolReceipt,
  type OttoToolWorkspaceType,
  type RuntimeMode,
} from "@otto/contracts";
import {
  type MemoryToolHandler,
  type MemoryUpdateToolId,
} from "../../memory/memory-update-tool.ts";
import type { OttoCatalogBackendOptions, OttoCatalogToolHandler } from "./otto-catalog-types.ts";
import type { OttoBotStateRuntime } from "../otto-bot-state-runtime.ts";

/** Native and plugin tools use the SDK result contract until tool-specific processing. */
export type OttoToolResult = Awaited<ReturnType<NonNullable<Tool["execute"]>>>;

export type OttoRuntimeToolId = OttoToolId | MemoryUpdateToolId;

export interface OttoRuntimeToolDefinition {
  readonly id: OttoRuntimeToolId;
  readonly description: string;
}

export interface OttoToolSession {
  readonly botId?: BotId;
  readonly botName?: string;
  readonly billedBotId?: BotId;
  readonly runtimeMode: RuntimeMode;
  readonly workspaceType: OttoToolWorkspaceType;
  readonly timezone?: string;
  readonly workspace?: Workspace;
  readonly memoryHandlers?: Record<MemoryUpdateToolId, MemoryToolHandler>;
  readonly delegation?: {
    readonly depth: number;
    readonly activeDelegations: number;
    readonly access: OttoDelegationAccessGrant;
    readonly create?: (
      input: (typeof OttoToolInputSchemas.CreateAgent)["Type"],
    ) => Promise<OttoToolResult>;
    readonly check?: (
      input: (typeof OttoToolInputSchemas.CheckAgent)["Type"],
    ) => Promise<OttoToolResult>;
    readonly send: (
      input: (typeof OttoToolInputSchemas.SendToAgent)["Type"],
    ) => Promise<OttoToolResult>;
    readonly stop?: (
      input: (typeof OttoToolInputSchemas.StopAgent)["Type"],
    ) => Promise<OttoToolResult>;
  };
  readonly postToChat?: (
    input: (typeof OttoToolInputSchemas.message_post)["Type"],
  ) => Promise<OttoToolReceipt>;
  readonly botState?: Pick<OttoBotStateRuntime, "updateProfile">;
  readonly reactToMessage?: (
    input: (typeof OttoToolInputSchemas.ReactToMessage)["Type"],
    toolCallId: string,
  ) => Promise<OttoToolResult>;
  readonly catalogHandlers?: Partial<Record<OttoToolId, OttoCatalogToolHandler>>;
  /** Image providers enabled in Settings; gates the GenerateImage tool. */
  readonly imageGeneration?: { readonly chatgptEnabled: boolean; readonly grokEnabled: boolean };
}

export interface OttoToolRuntimeOptions {
  readonly onReceipt?: (receipt: OttoToolReceipt) => void;
  readonly onProgress?: (input: {
    readonly threadId: string;
    readonly toolId: OttoToolId;
    readonly toolCallId: string;
    readonly summary: string;
    readonly authorizationUrl?: string;
  }) => void | Promise<void>;
  readonly now?: () => string;
  readonly onToolStart?: (input: OttoToolExecution, session: OttoToolSession) => Promise<void>;
  readonly onToolFinish?: (input: OttoToolExecution, session: OttoToolSession) => Promise<void>;
}

export interface OttoToolExecution {
  readonly threadId: string;
  readonly toolId: OttoRuntimeToolId;
  readonly toolCallId: string;
  readonly input: unknown;
  readonly approvalMode: "require-grant";
  /** Search through this turn's model, when its provider has built-in web search. */
  readonly webSearch?: OttoCatalogBackendOptions["webSearch"];
}

export interface OttoToolRuntime {
  readonly registerSession: (threadId: string, session: OttoToolSession) => void;
  readonly unregisterSession: (threadId: string) => void;
  readonly clearApprovals: (threadId: string) => void;
  readonly toolsForThread: (threadId: string) => ReadonlyArray<OttoRuntimeToolDefinition>;
  readonly requiresApproval: (
    threadId: string,
    toolId: OttoRuntimeToolId,
    input: OttoToolExecution["input"],
  ) => Promise<boolean>;
  readonly grantApproval: (input: Omit<OttoToolExecution, "approvalMode">) => void;
  readonly execute: (input: OttoToolExecution) => Promise<OttoToolResult>;
}
