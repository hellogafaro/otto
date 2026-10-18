import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type OrchestrationClientOrigin, WsRpcGroup } from "@otto/contracts";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import * as OrchestrationEngine from "./orchestration/services/orchestration-engine.ts";
import * as ProviderMaintenanceRunner from "./provider/provider-maintenance-runner.ts";
import * as ServerSelfUpdate from "./cloud/self-update.ts";
import * as EnvironmentAuth from "./auth/environment-auth.ts";
import * as VoiceCallManager from "./voice-call/voice-call-manager.ts";
import * as SessionStore from "./auth/session-store.ts";
import { failEnvironmentAuthInvalid, failEnvironmentInternal } from "./auth/http.ts";

import { createWsConnection } from "./ws-connection.ts";
import { createWsOrchestrationHandlers } from "./ws-orchestration-handlers.ts";
import { createWsOrchestrationSubscriptions } from "./ws-orchestration-subscriptions.ts";
import { createWsServerHandlers } from "./ws-server-handlers.ts";
import { createWsAuthHandlers } from "./ws-auth-handlers.ts";
import { createWsBotServicesHandlers } from "./ws-bot-services-handlers.ts";
import { createWsToolHandlers } from "./ws-tool-handlers.ts";
import { createWsMemoryHandlers } from "./ws-memory-handlers.ts";
import { createWsServerStatusHandlers } from "./ws-server-status-handlers.ts";
import { createWsWorkspaceHandlers } from "./ws-workspace-handlers.ts";
import { createWsActivityHandlers } from "./ws-activity-handlers.ts";
import { createWsLibraryHandlers } from "./ws-library-handlers.ts";
import { createWsSecretsHandlers } from "./ws-secrets-handlers.ts";
import { type ProviderSubscribeRefreshes, readClientConnectionOrigin } from "./ws-support.ts";

export {
  isThreadDetailEvent,
  resolveAvailableEditorsForConfig,
  resolveFileManagerRevealKindForConfig,
} from "./ws-support.ts";

const createWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  clientOrigin: OrchestrationClientOrigin,
  voiceCalls: VoiceCallManager.VoiceCallManager["Service"],
  providerRefreshes: ProviderSubscribeRefreshes,
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const connection = yield* createWsConnection(
        currentSession,
        clientOrigin,
        voiceCalls,
        providerRefreshes,
      );

      return {
        ...createWsOrchestrationHandlers(connection),
        ...createWsOrchestrationSubscriptions(connection),
        ...createWsServerHandlers(connection),
        ...createWsAuthHandlers(connection),
        ...createWsBotServicesHandlers(connection),
        ...createWsToolHandlers(connection),
        ...createWsServerStatusHandlers(connection),
        ...createWsMemoryHandlers(connection),
        ...createWsWorkspaceHandlers(connection),
        ...createWsActivityHandlers(connection),
        ...createWsLibraryHandlers(connection),
        ...createWsSecretsHandlers(connection),
      };
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const voiceCalls = yield* VoiceCallManager.VoiceCallManager;
    const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
    // Deleting a bot frees the single call slot it may hold.
    yield* Effect.forkScoped(
      VoiceCallManager.hangupDeletedBotCalls(voiceCalls, orchestrationEngine.streamDomainEvents),
    );
    const serverSelfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;

    const providerRefreshes: ProviderSubscribeRefreshes = {
      inFlight: new Set(),
      scope: yield* Effect.scope,
    };

    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;

        const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );

        const clientOrigin = readClientConnectionOrigin(request);
        yield* sessions.recordClientConnection(session.sessionId, clientOrigin);

        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provide(
            createWsRpcLayer(session, clientOrigin, voiceCalls, providerRefreshes).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(Layer.succeed(ServerSelfUpdate.ServerSelfUpdate, serverSelfUpdate)),
            ),
          ),
        );

        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
        }),
      ),
    );
  }),
).pipe(Layer.provide(VoiceCallManager.layer()));
