import type { OttoControllerHarness } from "../../mastra/otto-harness-types.ts";
import { runImageGenerationTool } from "../../../image-generation/image-generation-runtime.ts";
import { createMcpManager } from "@mastra/code-sdk/mcp/index";

import { Workspace } from "@mastra/core/workspace";

import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type * as Scope from "effect/Scope";

import * as McpSessionRegistry from "../../../mcp/mcp-session-registry.ts";

import {
  type OttoMastraHarnessError,
  type OttoMastraHarnessOptions,
} from "../../otto-mastra-harness.ts";

import { type OttoDelegationRuntime } from "../../otto-delegation-runtime.ts";

import { type OttoWebFetchOptions } from "../../otto-web-fetch.ts";

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
  /** How long a bot's computer stays awake after its last session ends (5 minutes by default). */
  readonly workspaceIdleTimeToLive?: Duration.Input;
  readonly issueMcpCredential?: typeof McpSessionRegistry.issueActiveMcpCredential;
  readonly revokeMcpCredential?: typeof McpSessionRegistry.revokeActiveMcpThread;
  readonly delegationRuntime?: Pick<
    OttoDelegationRuntime,
    "send" | "postToChat" | "parentFinished" | "accessForThread"
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
