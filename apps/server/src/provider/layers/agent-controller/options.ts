import type { OttoControllerHarness } from "../../mastra/otto-harness-types.ts";
import { runImageGenerationTool } from "../../../image-generation/image-generation-runtime.ts";
import { createMcpManager } from "@mastra/code-sdk/mcp/index";

import { Workspace } from "@mastra/core/workspace";

import * as Effect from "effect/Effect";

import type * as Scope from "effect/Scope";

import { BotMemoryStore } from "../../../memory/bot-memory.ts";

import { type EntityMemoryRepositoryShape } from "../../../memory/services/entity-memory-repository.ts";

import * as McpSessionRegistry from "../../../mcp/mcp-session-registry.ts";

import {
  type OttoMastraHarnessError,
  type OttoMastraHarnessOptions,
} from "../../otto-mastra-harness.ts";

import { type OttoDelegationRuntime } from "../../otto-delegation-runtime.ts";

import { type OttoWebFetchOptions } from "../../otto-web-fetch.ts";

import type { BotBrowser, CreateBotBrowserInput } from "../../bot-browser.ts";

import { resolveCodexComputerUseServer } from "../../codex-computer-use.ts";
import { type OttoBotWorkspace, type CreateRemoteBotWorkspaceInput } from "../../bot-workspace.ts";

export interface AgentControllerLiveOptions {
  /** Builds the harness in the layer scope; closing the scope shuts it down. */
  readonly makeMastraHarness?: (
    options: OttoMastraHarnessOptions,
  ) => Effect.Effect<OttoControllerHarness, OttoMastraHarnessError, Scope.Scope>;
  readonly makeMcpManager?: typeof createMcpManager;
  readonly makeRemoteWorkspace?: (
    input: CreateRemoteBotWorkspaceInput,
  ) => Promise<OttoBotWorkspace | Workspace>;
  readonly makeBotBrowser?: (input: CreateBotBrowserInput) => BotBrowser;
  readonly resolveComputerUseServer?: typeof resolveCodexComputerUseServer;
  readonly issueMcpCredential?: typeof McpSessionRegistry.issueActiveMcpCredential;
  readonly revokeMcpCredential?: typeof McpSessionRegistry.revokeActiveMcpThread;
  readonly entityMemoryRepository?: EntityMemoryRepositoryShape;
  readonly botMemoryStore?: BotMemoryStore;
  readonly delegationRuntime?: Pick<
    OttoDelegationRuntime,
    "send" | "sendToUser" | "parentFinished" | "accessForThread"
  > &
    Partial<Pick<OttoDelegationRuntime, "create" | "check" | "stop" | "dispatchDelegation">>;
  readonly readAttachment?: (path: string) => Promise<Uint8Array>;
  /** Overrides the WebFetch resolver and address policy in tests. */
  readonly webFetch?: OttoWebFetchOptions;
  /**
   * Overrides the image generation entry for tests. Defaults to
   * `runImageGenerationTool`, which calls the active ImageGenerationRuntime.
   */
  readonly generateImage?: (
    threadId: Parameters<typeof runImageGenerationTool>[0],
    input: Parameters<typeof runImageGenerationTool>[1],
  ) => Effect.Effect<unknown>;
}
