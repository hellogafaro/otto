import type { OttoModelOptions } from "../../ReasoningOptions.ts";
import type { OttoControllerHarness } from "../../mastra/OttoHarnessTypes.ts";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";
import { ottoToolCategory } from "../../OttoMastraHarness.ts";
import type { createOttoWebFetch } from "../../OttoWebFetch.ts";
import type { OttoToolRuntime } from "../../OttoToolRuntime.ts";
import type { ProviderServiceError } from "../../Errors.ts";
import type { RuntimeMode } from "@otto/contracts";
import type { OttoRuntimeSeam } from "../../OttoRuntimeSeam.ts";
import type { AgentControllerLiveOptions } from "./Options.ts";

import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  EventId,
  TurnId,
  type BotId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  type OttoDelegationAccessGrant,
  type OttoDelegationRecord,
  type OttoMemoryThreadAccess,
} from "@otto/contracts";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { BotInboxService } from "../../../bot-inbox/service.ts";
import { BotMemoryStore, type BotMemoryAccess } from "../../../memory/BotMemory.ts";
import { type OttoMemoryToolHandler } from "../../../memory/BotMemoryToolHandlers.ts";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";

import { type OttoChannelRuntime } from "../../OttoChannelRuntime.ts";
import { type OttoBotStateRuntime } from "../../OttoBotStateRuntime.ts";
import type { OttoWorkerRuntime } from "../../OttoWorkerRuntime.ts";
import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../../OttoCatalogToolHandlers.ts";

import { type OttoToolSession } from "../../OttoToolRuntime.ts";
import { OttoSessionResources } from "../../OttoSessionResources.ts";

import { AgentControllerRuntimeError, ProviderValidationError } from "../../Errors.ts";

import { LegacyProviderBridge } from "../../Services/LegacyProviderBridge.ts";
import {
  type ResolvedEngine,
  type ActiveSession,
  type LegacyResourceIdentity,
  type WorkerOrchestration,
} from "./State.ts";

export interface SessionLifecycleDependencies {
  readonly webFetch: ReturnType<typeof createOttoWebFetch>;
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly projectionSnapshotQuery: Option.Option<ProjectionSnapshotQuery["Service"]>;
  readonly workerRuntime: OttoWorkerRuntime;
  readonly wired: () => {
    readonly channelRuntime?: OttoChannelRuntime;
    readonly pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>;
    readonly pluginRuntimeOptions?: OttoPluginRuntimeOptions;
    readonly botStateRuntime?: OttoBotStateRuntime;
    readonly delegationRuntime?: AgentControllerLiveOptions["delegationRuntime"];
    readonly workerOrchestration?: WorkerOrchestration;
  };
  readonly sessions: Map<string, ActiveSession>;
  readonly resolvedByThread: Map<string, ResolvedEngine>;
  readonly usesMastraCode: (provider: ProviderDriverKind) => boolean;
  readonly legacyProviderBridge: LegacyProviderBridge["Service"];
  readonly disabledProviderError: (
    operation: string,
    providerInstanceId: ProviderInstanceId,
  ) => ProviderValidationError;
  readonly options: AgentControllerLiveOptions | undefined;
  readonly botMemoryStore: BotMemoryStore;
  readonly failureDetail: (cause: unknown) => string;
  readonly runMastra: <A>(
    operation: string,
    run: (signal: AbortSignal) => Promise<A>,
  ) => Effect.Effect<A, AgentControllerRuntimeError, never>;
  readonly imageToolSettings: Effect.Effect<
    { chatgptEnabled: boolean; grokEnabled: boolean },
    never,
    never
  >;
  readonly memorySettings: () =>
    | Effect.Effect<
        | { enabled: boolean; privateBotMemory: boolean; sharedProjectMemory: "auto" | "ask" }
        | { enabled: boolean; privateBotMemory: boolean; sharedProjectMemory: "ask" },
        never,
        never
      >
    | Effect.Effect<
        {
          readonly enabled: true;
          readonly privateBotMemory: true;
          readonly sharedProjectMemory: "ask";
        },
        never,
        never
      >;
  readonly memoryHandlers: (
    access: OttoMemoryThreadAccess | undefined,
    allowedScopes: OttoDelegationAccessGrant["memoryScopes"],
  ) => { memory: OttoMemoryToolHandler } | undefined;
  readonly delegationFor: (input: {
    readonly threadId: ThreadId;
    readonly botId: BotId;
    readonly parentDelegation: OttoDelegationRecord | undefined;
    readonly access: OttoDelegationAccessGrant;
    readonly activeChildDelegations: number;
  }) => NonNullable<OttoToolSession["delegation"]>;
  readonly workersFor: (
    threadId: ThreadId,
    access: OttoDelegationAccessGrant,
  ) => NonNullable<OttoToolSession["workers"]>;
  readonly memoryAccessFor: (
    access: OttoMemoryThreadAccess | undefined,
  ) => BotMemoryAccess | undefined;
  readonly toolRuntime: OttoToolRuntime;
  readonly toProviderSession: (threadId: ThreadId, active: ActiveSession) => ProviderSession;
  readonly legacyResourceIdentity: Map<string, LegacyResourceIdentity>;
  readonly memoryAccessKey: (access: BotMemoryAccess | undefined) => string | undefined;
  readonly sessionResources: OttoSessionResources;
  readonly stopSessionWithResources: (
    input: { readonly threadId: ThreadId },
    destroyResources: boolean,
  ) => Effect.Effect<void, ProviderServiceError | AgentControllerRuntimeError, never>;
  readonly preparePreviewMcpSession: (
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
    memoryHandler?: OttoMemoryToolHandler,
  ) => Effect.Effect<void, never, never>;
  readonly clearPreviewMcpSession: (threadId: ThreadId) => Effect.Effect<void, never, never>;
  readonly entityMemoryContext: (access: OttoMemoryThreadAccess | undefined) => Promise<string>;
  readonly subscriptionAuth: SubscriptionAuthService;
  readonly botInbox: BotInboxService;
  readonly deleteCatalogMcpServer: (
    runtime: Pick<OttoPluginRuntimeOptions, "readSnapshot" | "dispatch">,
    serverId: string,
    commandPrefix: "mcp-delete" | "mcp-remove",
  ) => Promise<{
    serverId: string;
    removed: boolean;
    dependentBots: { id: BotId; name: string }[];
    clearedDisabledFor: { id: BotId; name: string }[];
  }>;
  readonly bundle: OttoControllerHarness;
  readonly mastraModelOptions: (resolved: ResolvedEngine) => OttoModelOptions | undefined;
  readonly DEFAULT_MODE_ID: string;
  readonly permissionPolicy: (
    runtimeMode: RuntimeMode,
    category: ReturnType<typeof ottoToolCategory>,
  ) => "allow" | "ask";
  readonly handleControllerEvent: (
    threadId: ThreadId,
    active: ActiveSession,
    event: AgentControllerEvent,
  ) => void;
  readonly publish: (event: ProviderRuntimeEvent) => void;
  readonly baseEvent: (
    threadId: ThreadId,
    active: Pick<ActiveSession, "provider" | "providerInstanceId">,
    turnId?: TurnId,
  ) => {
    turnId?: TurnId;
    eventId: EventId;
    provider: ProviderDriverKind;
    providerInstanceId: ProviderInstanceId;
    threadId: ThreadId;
    createdAt: string;
  };
  readonly publishSessionState: (
    threadId: ThreadId,
    active: ActiveSession,
    state: "ready" | "running" | "waiting" | "stopped" | "error",
    reason?: string,
  ) => void;
}
