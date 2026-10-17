import type { OttoToolResult } from "./otto-tool-types.ts";
import { type OttoToolInputSchemas } from "@otto/contracts";
import type { McpManager } from "@mastra/code-sdk/mcp/index";
import {
  type BotId,
  type ComposioToolkit,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@otto/contracts";
import type { RequestHealthStatus } from "../../subscription-auth/service.ts";

export interface OttoCatalogToolHandlerInput {
  readonly input: unknown;
  readonly webSearch?: OttoCatalogBackendOptions["webSearch"];
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
  readonly webFetch?: (input: { readonly url: string }) => Promise<OttoToolResult>;
  readonly generateImage?: (
    input: (typeof OttoToolInputSchemas.image_create)["Type"],
  ) => Promise<OttoToolResult>;
  readonly library?: {
    readonly save: (
      input: (typeof OttoToolInputSchemas.library_create)["Type"],
    ) => Promise<OttoToolResult>;
    readonly list: (
      input: (typeof OttoToolInputSchemas.ListLibrary)["Type"],
    ) => Promise<OttoToolResult>;
    readonly read: (
      input: (typeof OttoToolInputSchemas.library_read)["Type"],
    ) => Promise<OttoToolResult>;
    readonly updateDocument: (
      input: (typeof OttoToolInputSchemas.library_update)["Type"],
    ) => Promise<OttoToolResult>;
    readonly listSkills: () => Promise<OttoToolResult>;
    readonly readSkillFile: (
      input: (typeof OttoToolInputSchemas.skill_read)["Type"],
    ) => Promise<OttoToolResult>;
  };
  /** Otto: The organization's Tasks page, as the calling bot. */
  readonly tasks?: {
    readonly list: (
      input: (typeof OttoToolInputSchemas.ListTasks)["Type"],
    ) => Promise<OttoToolResult>;
    readonly read: (
      input: (typeof OttoToolInputSchemas.task_read)["Type"],
    ) => Promise<OttoToolResult>;
    readonly create: (
      input: (typeof OttoToolInputSchemas.task_create)["Type"],
    ) => Promise<OttoToolResult>;
    readonly update: (
      input: (typeof OttoToolInputSchemas.task_update)["Type"],
    ) => Promise<OttoToolResult>;
    readonly comment: (
      input: (typeof OttoToolInputSchemas.task_comment)["Type"],
    ) => Promise<OttoToolResult>;
  };
  readonly addMcpServer?: (
    input: (typeof OttoToolInputSchemas.AddMcpServer)["Type"],
  ) => Promise<OttoToolResult>;
  readonly uninstallMcpServer?: (serverId: string) => Promise<OttoToolResult>;
  readonly removeMcpAccount?: (serverId: string) => Promise<OttoToolResult>;
  readonly renameMcpAccount?: (
    input: (typeof OttoToolInputSchemas.RenameMcpAccount)["Type"],
  ) => Promise<OttoToolResult>;
  readonly setMcpInstructions?: (input: {
    readonly serverId: string;
    readonly instructions: string;
  }) => Promise<OttoToolResult>;
}
