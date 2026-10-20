import type { OttoToolResult } from "./otto-tool-types.ts";
import { type OttoToolId, type OttoToolInputSchemas } from "@otto/contracts";
import type { McpManager } from "@mastra/code-sdk/mcp/index";
import {
  type ApprovalResponder,
  type BotId,
  type ComposioToolkit,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";
import type { RequestHealthStatus } from "../../subscription-auth/service.ts";

/** Otto: The task tools; each one's handler takes its own decoded input. */
export const TASK_TOOL_IDS = [
  "task_read",
  "task_create",
  "task_update",
  "task_delete",
  "task_comment_create",
  "task_comment_list",
  "task_comment_update",
  "task_comment_delete",
  "task_time_create",
  "task_time_delete",
  "task_time_list",
] as const satisfies ReadonlyArray<OttoToolId>;

export type TaskToolId = (typeof TASK_TOOL_IDS)[number];

export interface OttoCatalogToolHandlerInput {
  readonly input: unknown;
  /** The person who approved this call, for tools that act as that person. */
  readonly responder?: ApprovalResponder;
  readonly webSearch?: OttoCatalogBackendOptions["webSearch"];
  /** Aborts when the turn that called the tool is stopped. */
  readonly abortSignal?: AbortSignal;
  readonly emitProgress: (
    summary: string,
    details?: { readonly authorizationUrl?: string },
  ) => void | Promise<void>;
}

export type OttoCatalogToolHandler = (
  input: OttoCatalogToolHandlerInput,
) => Promise<OttoToolResult>;

export interface OttoMcpDependencies {
  readonly dependentBots: ReadonlyArray<{ readonly id: BotId; readonly name: string }>;
  readonly dependentRoutines: ReadonlyArray<string>;
}

export interface OttoMcpHealthHandlerOptions {
  readonly getRequestHealth: (serverId: string) => RequestHealthStatus | undefined;
  readonly recordSuccess: (serverId: string, at: string) => void;
  readonly recordFailure: (serverId: string, message: string, at: string) => void;
  readonly getDependencies: (serverId: string) => Promise<OttoMcpDependencies>;
  readonly onFailure?: (
    serverId: string,
    message: string,
    dependencies: OttoMcpDependencies,
  ) => void | Promise<void>;
  readonly onRecovery?: (
    serverId: string,
    dependencies: OttoMcpDependencies,
  ) => void | Promise<void>;
  readonly authenticationExpiresAt?: (serverId: string) => string | undefined;
  readonly now?: () => string;
}

export type McpRuntimeStatus = ReturnType<McpManager["getServerStatuses"]>[number];

export interface OttoPluginRuntimeOptions {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Promise<{ readonly sequence: number } | void>;
  readonly searchComposioToolkits?: (input: {
    readonly query?: string;
    readonly limit?: number;
    /** The searching bot and its owner, whose accounts count as connected. */
    readonly bot?: { readonly botId: string; readonly ownerPersonId: string | null };
  }) => Promise<{
    readonly status: "available" | "setup-required" | "unavailable";
    readonly toolkits: readonly ComposioToolkit[];
    /** Apps with an active account the bot can use. */
    readonly connectedToolkits?: readonly string[];
  }>;
  readonly now?: () => string;
  readonly id?: () => string;
}

export interface OttoCatalogBackendOptions {
  /** The bot calling the tools, so plugin search can tell which apps it already has. */
  readonly botId?: string;
  readonly webSearch?: (input: {
    readonly query: string;
    readonly domains?: readonly string[];
  }) => Promise<OttoToolResult>;
  readonly webFetch?: (input: { readonly url: string }) => Promise<{ readonly text: string }>;
  readonly generateImage?: (
    input: (typeof OttoToolInputSchemas.image_create)["Type"],
  ) => Promise<OttoToolResult>;
  readonly transcribeAudio?: (
    input: (typeof OttoToolInputSchemas.audio_transcribe)["Type"],
    signal: AbortSignal,
  ) => Promise<OttoToolResult>;
  /** Otto: One permission-checked search over tasks, files, messages and routines. */
  readonly search?: (
    input: (typeof OttoToolInputSchemas.search)["Type"],
  ) => Promise<OttoToolResult>;
  readonly library?: {
    readonly save: (
      input: (typeof OttoToolInputSchemas.library_create)["Type"],
    ) => Promise<OttoToolResult>;
    readonly read: (
      input: (typeof OttoToolInputSchemas.library_read)["Type"],
    ) => Promise<OttoToolResult>;
    readonly updateDocument: (
      input: (typeof OttoToolInputSchemas.library_update)["Type"],
    ) => Promise<OttoToolResult>;
    readonly share: (
      input: (typeof OttoToolInputSchemas.library_share)["Type"],
    ) => Promise<OttoToolResult>;
    readonly unshare: (
      input: (typeof OttoToolInputSchemas.library_unshare)["Type"],
    ) => Promise<OttoToolResult>;
    readonly readSkillFile: (
      input: (typeof OttoToolInputSchemas.skill_read)["Type"],
    ) => Promise<OttoToolResult>;
    readonly proposeSkill: (
      input: (typeof OttoToolInputSchemas.skill_create)["Type"],
      responder: ApprovalResponder | undefined,
    ) => Promise<OttoToolResult>;
    readonly updateSkill: (
      input: (typeof OttoToolInputSchemas.skill_update)["Type"],
      responder: ApprovalResponder | undefined,
    ) => Promise<OttoToolResult>;
  };
  /** Otto: The organization's Tasks page, as the calling bot: one handler per task tool. */
  readonly tasks?: {
    readonly [Id in TaskToolId]: (
      input: (typeof OttoToolInputSchemas)[Id]["Type"],
    ) => Promise<OttoToolResult>;
  };
  /** Adds a remote MCP server; Otto runs no local MCP commands. */
  readonly addMcpServer?: (input: {
    readonly url: string;
    readonly title: string;
  }) => Promise<OttoToolResult>;
  readonly uninstallMcpServer?: (serverId: string) => Promise<OttoToolResult>;
  readonly renameMcpAccount?: (input: {
    readonly serverId: string;
    readonly name: string;
  }) => Promise<OttoToolResult>;
  readonly setMcpInstructions?: (input: {
    readonly serverId: string;
    readonly instructions: string;
  }) => Promise<OttoToolResult>;
}
