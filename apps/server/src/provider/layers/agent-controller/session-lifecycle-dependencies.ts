import type { OttoModelOptions } from "../../reasoning-options.ts";
import type { OttoControllerHarness } from "../../mastra/otto-harness-types.ts";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";
import { ottoToolCategory } from "../../otto-mastra-harness.ts";
import type { createOttoWebFetch } from "../../otto-web-fetch.ts";
import type { OttoToolRuntime } from "../../otto-tool-runtime.ts";
import type { ProviderServiceError } from "../../errors.ts";
import type { ChatAttachment, RuntimeMode } from "@otto/contracts";
import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";
import type { AgentControllerLiveOptions } from "./options.ts";

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
} from "@otto/contracts";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { BotInboxService } from "../../../bot-inbox/service.ts";

import { ProjectionSnapshotQuery } from "../../../orchestration/services/projection-snapshot-query.ts";
import type { ProjectionThreadMessageRepository } from "../../../persistence/services/projection-thread-messages.ts";
import type { RoutineRepository } from "../../../routines/repository.ts";

import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";

import { type OttoChannelRuntime } from "../../otto-channel-runtime.ts";
import { type OttoBotStateRuntime } from "../../otto-bot-state-runtime.ts";
import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../../otto-catalog-tool-handlers.ts";

import { type OttoToolSession } from "../../otto-tool-runtime.ts";
import { OttoSessionResources } from "../../otto-session-resources.ts";

import { AgentControllerRuntimeError, ProviderValidationError } from "../../errors.ts";

import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";
import { type ResolvedEngine, type ActiveSession, type LegacyResourceIdentity } from "./state.ts";

export interface SessionLifecycleDependencies {
  readonly webFetch: ReturnType<typeof createOttoWebFetch>;
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly projectionSnapshotQuery: Option.Option<ProjectionSnapshotQuery["Service"]>;
  readonly routineRepository: Option.Option<RoutineRepository["Service"]>;
  readonly projectionMessages: Option.Option<ProjectionThreadMessageRepository["Service"]>;
  readonly storeChatFile: (
    threadId: string,
    file: { readonly name: string; readonly bytes: Uint8Array },
  ) => Promise<ChatAttachment>;
  readonly wired: () => {
    readonly channelRuntime?: OttoChannelRuntime;
    readonly pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>;
    readonly pluginRuntimeOptions?: OttoPluginRuntimeOptions;
    readonly botStateRuntime?: OttoBotStateRuntime;
    readonly delegationRuntime?: AgentControllerLiveOptions["delegationRuntime"];
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
  readonly memoryEnabled: () => Effect.Effect<boolean>;
  readonly delegationFor: (input: {
    readonly threadId: ThreadId;
    readonly botId: BotId;
    readonly parentDelegation: OttoDelegationRecord | undefined;
    readonly access: OttoDelegationAccessGrant;
    readonly activeChildDelegations: number;
  }) => NonNullable<OttoToolSession["delegation"]>;
  readonly toolRuntime: OttoToolRuntime;
  readonly toProviderSession: (threadId: ThreadId, active: ActiveSession) => ProviderSession;
  readonly legacyResourceIdentity: Map<string, LegacyResourceIdentity>;
  readonly sessionResources: OttoSessionResources;
  readonly stopSessionWithResources: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProviderServiceError | AgentControllerRuntimeError, never>;
  readonly preparePreviewMcpSession: (
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<void, never, never>;
  readonly clearPreviewMcpSession: (threadId: ThreadId) => Effect.Effect<void, never, never>;
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
