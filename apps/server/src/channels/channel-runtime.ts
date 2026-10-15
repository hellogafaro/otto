import { BotId, ChannelConnectionId } from "@otto/contracts";
import { Context } from "effect";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerSecretStore } from "../auth/server-secret-store.ts";
import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { ChannelDeliveryStore } from "./channel-delivery-store.ts";
import {
  type ChannelRuntimeDependencies,
  type ChannelRuntimeContext,
  type ChannelRuntimeShape,
} from "./channel-runtime-types.ts";
import {
  keyedLock,
  stopChannelsForBot,
  clearChannelThreadStatuses,
  shutdownAllChannels,
  stopArchivedBotChannels,
} from "./channel-operations.ts";
import { runtimeKey, loadConnectionSecret } from "./channel-secrets.ts";
import {
  WHATSAPP_WEBHOOK_PATH,
  WHATSAPP_CONNECTION_WEBHOOK_PATH,
  handlePhoneScopedWhatsAppWebhook,
  handleBotWhatsAppWebhook,
} from "./channel-webhooks.ts";
import { channelBindingsForRuntime, dispatchInboundChannelMessage } from "./channel-inbound.ts";
import {
  finishChannelTurn,
  markChannelTurnWaiting,
  sendChannelMessage,
  resolveCompletedChannelReply,
} from "./channel-delivery.ts";
import {
  connectChannel,
  saveChannelConnection,
  deleteChannelConnection,
  attachChannelConnection,
  disconnectChannel,
  detachChannelConnection,
  changeChannelProject,
  reconnectChannel,
  restoreConnectedChannels,
} from "./channel-connections.ts";

export { defaultProjectIdForBot } from "@otto/shared/channelProject";

const makeChannelRuntime = (deps: ChannelRuntimeDependencies) =>
  Effect.gen(function* () {
    const serviceScope = yield* Scope.Scope;
    // Created before the callback set and the shutdown finalizer, so it closes last.
    const transportScope = yield* Scope.fork(serviceScope);
    const runSdkCallback = yield* FiberSet.makeRuntimePromise();

    const ctx: ChannelRuntimeContext = {
      deps,
      runtimes: new Map(),
      statuses: new WeakMap(),
      withLock: keyedLock(),
      runSdkCallback,
      transportScope,
      connecting: new Set(),
      closed: false,
    };

    const shutdown = shutdownAllChannels(ctx);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        ctx.closed = true;
      }).pipe(Effect.andThen(shutdown)),
    );

    return {
      connect: (input) => connectChannel(ctx, input),
      saveConnection: (input) => saveChannelConnection(ctx, input),
      deleteConnection: (connectionId) => deleteChannelConnection(ctx, connectionId),
      attach: (botId, connectionId, projectId, provider) =>
        attachChannelConnection(ctx, botId, connectionId, projectId, provider),
      changeProject: (botId, provider, projectId) =>
        changeChannelProject(ctx, botId, provider, projectId),
      disconnect: (botId, provider) => disconnectChannel(ctx, botId, provider),
      detach: (botId, provider) => detachChannelConnection(ctx, botId, provider),
      reconnect: (botId, provider) => reconnectChannel(ctx, botId, provider),
      restoreConnectedChannels: restoreConnectedChannels(ctx),
      dispatchInbound: (input) => dispatchInboundChannelMessage(ctx, input),
      sendChannelMessage: (input) => sendChannelMessage(ctx, input),
      finishChannelTurn: (threadId, turnId, state, requestMessageId) =>
        finishChannelTurn(ctx, threadId, turnId, state, requestMessageId),
      markChannelTurnWaiting: (threadId, turnId, waiting) =>
        markChannelTurnWaiting(ctx, threadId, turnId, waiting),
      resolveCompletedChannelReply: (threadId, turnId) =>
        resolveCompletedChannelReply(ctx, threadId, turnId),
      sendCompletedChannelReply: (threadId, turnId) =>
        resolveCompletedChannelReply(ctx, threadId, turnId).pipe(
          Effect.flatMap((target) =>
            target ? sendChannelMessage(ctx, target) : Effect.succeed(null),
          ),
        ),
      stopChannelsForBot: (botId) => stopChannelsForBot(ctx, botId),
      clearChannelThreadStatuses: (threadId) => clearChannelThreadStatuses(ctx, threadId),
      stopArchivedBotChannels: (events) => stopArchivedBotChannels(ctx, events),
      handleWhatsAppWebhook: (botId, request) => handleBotWhatsAppWebhook(ctx, botId, request),
      handleWhatsAppConnectionWebhook: (connectionId, request) =>
        ctx.deps.readModel.pipe(
          Effect.map(
            (model) =>
              model.bots.find(
                (bot) =>
                  bot.archivedAt === null &&
                  (bot.channelBindings ?? []).some(
                    (binding) =>
                      binding.provider === "whatsapp" && binding.connectionId === connectionId,
                  ),
              )?.id,
          ),
          Effect.catchCause(() => Effect.void),
          Effect.flatMap((botId) =>
            botId
              ? loadConnectionSecret(ctx, connectionId).pipe(
                  Effect.flatMap((secret) =>
                    handlePhoneScopedWhatsAppWebhook(ctx, botId, secret, request),
                  ),
                  Effect.catchCause(() =>
                    Effect.succeed(new Response("Not Found", { status: 404 })),
                  ),
                )
              : Effect.succeed(new Response("Not Found", { status: 404 })),
          ),
        ),
      channelBindingsForRuntime: (bindings) =>
        channelBindingsForRuntime(
          bindings,
          (botId, provider) => {
            const runtime = ctx.runtimes.get(runtimeKey(botId, provider));

            return runtime !== undefined && (runtime.isHealthy?.() ?? true);
          },
          (botId, provider) => ctx.connecting.has(runtimeKey(botId, provider)),
        ),
      shutdown,
    } satisfies ChannelRuntimeShape;
  });

/**
 * Owns every external channel transport for one server. Transports, locks, and status
 * reactions live in the service; closing its scope stops them.
 */
export class ChannelRuntime extends Context.Service<ChannelRuntime, ChannelRuntimeShape>()(
  "@otto/server/channels/channel-runtime/ChannelRuntime",
) {
  /** Builds the runtime from explicit dependencies. */
  static readonly layerWith = (dependencies: ChannelRuntimeDependencies) =>
    Layer.effect(ChannelRuntime, makeChannelRuntime(dependencies));

  /**
   * Builds the runtime from server services. Channels need secret and delivery storage;
   * without them the layer provides nothing and consumers treat channels as unavailable.
   */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const secretStore = yield* Effect.serviceOption(ServerSecretStore);
      const deliveryStore = yield* Effect.serviceOption(ChannelDeliveryStore);

      if (Option.isNone(secretStore) || Option.isNone(deliveryStore)) return Layer.empty;
      const engine = yield* OrchestrationEngineService;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const settings = yield* ServerSettingsService;
      const crypto = yield* Crypto.Crypto;
      const serverConfig = yield* Effect.serviceOption(ServerConfig.ServerConfig);
      const publicOrigin = Option.getOrUndefined(serverConfig)?.publicOrigin;

      return ChannelRuntime.layerWith({
        ...(publicOrigin ? { publicOrigin } : {}),
        engine,
        secretStore: secretStore.value,
        settings,
        deliveryStore: deliveryStore.value,
        readModel: projectionSnapshotQuery.getCommandReadModel(),
        readThread: (threadId) =>
          projectionSnapshotQuery
            .getThreadDetailById(threadId, { activityKinds: [] })
            .pipe(Effect.map(Option.getOrNull)),
        nowIso: DateTime.now.pipe(Effect.map(DateTime.formatIso)),
        randomUuid: crypto.randomUUIDv4,
      });
    }),
  );
}

/** Serves WhatsApp webhooks for the runtime in the router's context. */
export const whatsAppWebhookRouteLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const channelRuntime = yield* Effect.serviceOption(ChannelRuntime);

    const connectionHandler = Effect.gen(function* () {
      if (Option.isNone(channelRuntime))
        return HttpServerResponse.text("Not Found", { status: 404 });

      const params = yield* HttpRouter.schemaPathParams(
        Schema.Struct({ connectionId: ChannelConnectionId }),
      ).pipe(Effect.option);

      if (Option.isNone(params)) return HttpServerResponse.text("Not Found", { status: 404 });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.option);

      if (Option.isNone(webRequest)) return HttpServerResponse.text("Bad Request", { status: 400 });

      const response = yield* channelRuntime.value.handleWhatsAppConnectionWebhook(
        params.value.connectionId,
        webRequest.value,
      );

      return HttpServerResponse.fromWeb(response);
    });

    const handler = Effect.gen(function* () {
      if (Option.isNone(channelRuntime))
        return HttpServerResponse.text("Not Found", { status: 404 });

      const params = yield* HttpRouter.schemaPathParams(Schema.Struct({ botId: BotId })).pipe(
        Effect.option,
      );

      if (Option.isNone(params)) return HttpServerResponse.text("Not Found", { status: 404 });
      const request = yield* HttpServerRequest.HttpServerRequest;
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.option);

      if (Option.isNone(webRequest)) return HttpServerResponse.text("Bad Request", { status: 400 });

      const response = yield* channelRuntime.value.handleWhatsAppWebhook(
        params.value.botId,
        webRequest.value,
      );

      return HttpServerResponse.fromWeb(response);
    });

    yield* router.add("GET", WHATSAPP_WEBHOOK_PATH, handler);
    yield* router.add("POST", WHATSAPP_WEBHOOK_PATH, handler);
    yield* router.add("GET", WHATSAPP_CONNECTION_WEBHOOK_PATH, connectionHandler);
    yield* router.add("POST", WHATSAPP_CONNECTION_WEBHOOK_PATH, connectionHandler);
  }),
);

export { ChannelPostRejectedError } from "./channel-errors.ts";

export { ChannelRuntimeError } from "./channel-errors.ts";

export { ChannelTransportError } from "./channel-errors.ts";

export { isChannelPostRejected } from "./channel-errors.ts";

export { isChannelTransportError } from "./channel-errors.ts";

export { channelFailureCategory } from "./channel-errors.ts";

export { channelFailureMessage } from "./channel-errors.ts";

export type { ChannelFailurePresentation } from "./channel-errors.ts";

export { channelFailurePresentation } from "./channel-errors.ts";

export type { ChannelTransportRuntime } from "./channel-runtime-types.ts";

export type { ChannelOperationError } from "./channel-runtime-types.ts";

export type { InboundChannelMessage } from "./channel-runtime-types.ts";

export type { ChannelTransportContext } from "./channel-runtime-types.ts";

export type { ChannelRuntimeDependencies } from "./channel-runtime-types.ts";

export type { ChannelReplyTarget } from "./channel-runtime-types.ts";

export type { ChannelRestoreFailure } from "./channel-runtime-types.ts";

export { keyedLock } from "./channel-operations.ts";

export { channelReplyTextWithFooter } from "./channel-delivery.ts";

export { CHANNEL_SENT_MESSAGE_RECOVERY_LIMIT } from "./channel-delivery.ts";

export { CHANNEL_MENTION_CONTEXT_LIMIT } from "./channel-inbound.ts";

export { CHANNEL_MENTION_CONTEXT_CHARACTER_LIMIT } from "./channel-inbound.ts";

export { CHANNEL_GATEWAY_RENEWAL_INTERVAL } from "./channel-transport-factory.ts";

export { channelThreadId } from "./channel-inbound.ts";

export { WHATSAPP_WEBHOOK_PATH } from "./channel-webhooks.ts";

export { WHATSAPP_CONNECTION_WEBHOOK_PATH } from "./channel-webhooks.ts";

export { WHATSAPP_NOT_LIVE_MESSAGE } from "./channel-delivery.ts";

export { whatsAppWebhookUrl } from "./channel-webhooks.ts";

export { mentionWithContext } from "./channel-inbound.ts";

export { channelBindingsForRuntime } from "./channel-inbound.ts";

export { ignoredInbound } from "./channel-transport-factory.ts";

export type { RenewingGateway } from "./channel-transport-factory.ts";

export { startRenewingGateway } from "./channel-transport-factory.ts";

export type { ChannelRuntimeShape } from "./channel-runtime-types.ts";
