import { accountScope } from "./subscription-auth/service.ts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import {
  type AuthAccessStreamEvent,
  ComposioOperationError,
  McpServerAuthenticationError,
  McpServerHeadersError,
  type McpServerId,
  McpServerToolsError,
  canUseMcpServer,
  ImageGenerationError,
  SubscriptionAuthError,
  WS_METHODS,
  WsRpcGroup,
} from "@otto/contracts";
import { runImageProviderHealthTest } from "./image-generation/service.ts";

import {
  readMcpServerHeaders,
  replaceMcpServerHeaders,
  withMcpServerCredentials,
} from "./provider/mcp-server-credentials.ts";
import * as ServerSecretStore from "./auth/server-secret-store.ts";
import { isMcpServerAuthenticationError, toAuthAccessStreamEvent } from "./ws-support.ts";
import type { WsConnection } from "./ws-connection.ts";

export const createWsAuthHandlers = ({
  currentSessionId,
  currentPersonId,
  loadEnvironmentPeople,
  projectionSnapshotQuery,
  agentController,
  subscriptionAuth,
  refreshChangedSubscriptionProviders,
  resetChangedApiKeySessions,
  validateAccountInstance,
  composio,
  github,
  secretStore,
  sessions,
  getAccessHealthSnapshot,
  getImageProviderSnapshot,
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
  loadAuthAccessSnapshot,
}: Pick<
  WsConnection,
  | "currentSessionId"
  | "currentPersonId"
  | "loadEnvironmentPeople"
  | "projectionSnapshotQuery"
  | "agentController"
  | "subscriptionAuth"
  | "refreshChangedSubscriptionProviders"
  | "resetChangedApiKeySessions"
  | "validateAccountInstance"
  | "composio"
  | "github"
  | "secretStore"
  | "sessions"
  | "getAccessHealthSnapshot"
  | "getImageProviderSnapshot"
  | "observeRpcEffect"
  | "observeRpcStream"
  | "observeRpcStreamEffect"
  | "loadAuthAccessSnapshot"
>) => {
  const composioViewer = loadEnvironmentPeople().pipe(
    Effect.map((people) => ({
      type: "person" as const,
      personId: currentPersonId,
      displayName: people.current.displayName,
    })),
    Effect.mapError(
      () =>
        new ComposioOperationError({
          operation: "identify you",
          message: "Could not identify you.",
        }),
    ),
  );

  /** Only the person who added a server, or anyone for a server with no recorded owner, manages its headers. */
  const requireManagedMcpServer = (mcpServerId: McpServerId) =>
    projectionSnapshotQuery.getShellSnapshot().pipe(
      Effect.mapError(
        () => new McpServerHeadersError({ mcpServerId, reason: "Could not read the MCP servers." }),
      ),
      Effect.flatMap((snapshot) => {
        const server = snapshot.mcpServers?.find((candidate) => candidate.id === mcpServerId);

        if (!server || !canUseMcpServer(server, currentPersonId)) {
          return Effect.fail(
            new McpServerHeadersError({ mcpServerId, reason: "The MCP server does not exist." }),
          );
        }

        if (server.createdBy !== undefined && server.createdBy.personId !== currentPersonId) {
          return Effect.fail(
            new McpServerHeadersError({
              mcpServerId,
              reason: "Only the person who added this MCP server can change it.",
            }),
          );
        }

        return Effect.succeed(server);
      }),
    );

  return {
    [WS_METHODS.composioGetStatus]: (_input) =>
      observeRpcEffect(
        WS_METHODS.composioGetStatus,
        Effect.flatMap(composioViewer, composio.getStatus),
        { "rpc.aggregate": "composio" },
      ),

    [WS_METHODS.composioSearchToolkits]: (input) =>
      observeRpcEffect(WS_METHODS.composioSearchToolkits, composio.searchToolkits(input), {
        "rpc.aggregate": "composio",
      }),

    [WS_METHODS.composioGetToolkit]: (input) =>
      observeRpcEffect(WS_METHODS.composioGetToolkit, composio.getToolkit(input.slug), {
        "rpc.aggregate": "composio",
      }),

    [WS_METHODS.composioGetAuthSetup]: (input) =>
      observeRpcEffect(WS_METHODS.composioGetAuthSetup, composio.getAuthSetup(input.slug), {
        "rpc.aggregate": "composio",
      }),

    [WS_METHODS.composioCreateAuthConfig]: (input) =>
      observeRpcEffect(WS_METHODS.composioCreateAuthConfig, composio.createAuthConfig(input), {
        "rpc.aggregate": "composio",
      }),

    [WS_METHODS.composioAuthorize]: (input) =>
      observeRpcEffect(
        WS_METHODS.composioAuthorize,
        Effect.flatMap(composioViewer, (viewer) => composio.authorize(input, viewer)),
        { "rpc.aggregate": "composio" },
      ),

    [WS_METHODS.composioDisconnect]: ({ connectionId }) =>
      observeRpcEffect(
        WS_METHODS.composioDisconnect,
        Effect.flatMap(composioViewer, (viewer) => composio.disconnect(connectionId, viewer)),
        { "rpc.aggregate": "composio" },
      ),

    [WS_METHODS.composioUpdateConnection]: (input) =>
      observeRpcEffect(
        WS_METHODS.composioUpdateConnection,
        Effect.flatMap(composioViewer, (viewer) => composio.updateConnection(input, viewer)),
        { "rpc.aggregate": "composio" },
      ),

    [WS_METHODS.githubGetStatus]: (_input) =>
      observeRpcEffect(WS_METHODS.githubGetStatus, github.getStatus(currentPersonId), {
        "rpc.aggregate": "github",
      }),

    [WS_METHODS.githubStartLink]: ({ team }) =>
      observeRpcEffect(WS_METHODS.githubStartLink, github.startLink(currentPersonId, team), {
        "rpc.aggregate": "github",
      }),

    [WS_METHODS.githubPollLink]: ({ team }) =>
      observeRpcEffect(WS_METHODS.githubPollLink, github.pollLink(currentPersonId, team), {
        "rpc.aggregate": "github",
      }),

    [WS_METHODS.githubDisconnect]: ({ team }) =>
      observeRpcEffect(WS_METHODS.githubDisconnect, github.disconnect(currentPersonId, team), {
        "rpc.aggregate": "github",
      }),

    [WS_METHODS.subscriptionAuthList]: (_input) =>
      observeRpcEffect(WS_METHODS.subscriptionAuthList, getAccessHealthSnapshot(), {
        "rpc.aggregate": "server",
      }),

    [WS_METHODS.mcpServerListTools]: ({ mcpServerId }) =>
      observeRpcEffect(
        WS_METHODS.mcpServerListTools,
        Effect.gen(function* () {
          const fail = (reason: string) => new McpServerToolsError({ mcpServerId, reason });

          const snapshot = yield* projectionSnapshotQuery
            .getShellSnapshot()
            .pipe(Effect.mapError(() => fail("Could not read the MCP servers.")));

          const server = snapshot.mcpServers?.find((candidate) => candidate.id === mcpServerId);

          if (!server || !canUseMcpServer(server, currentPersonId)) {
            return yield* fail("The MCP server does not exist.");
          }

          if (server.transport === "stdio") {
            return yield* fail("Local MCP servers are not supported.");
          }

          if (!agentController.listMcpServerTools) {
            return yield* fail("Listing tools is not available on this server.");
          }

          const tools = yield* withMcpServerCredentials(server).pipe(
            Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
            Effect.mapError(() => fail("Could not read the MCP server's credentials.")),
            Effect.flatMap((connectable) =>
              agentController.listMcpServerTools!({ server: connectable }).pipe(
                Effect.mapError(() => fail("Could not reach the MCP server.")),
              ),
            ),
          );

          return { toolNames: [...tools.toolNames].toSorted(), needsSignIn: tools.needsSignIn };
        }),
        { "rpc.aggregate": "provider" },
      ),

    [WS_METHODS.mcpServerAuthenticate]: ({ mcpServerId }) =>
      observeRpcStream(
        WS_METHODS.mcpServerAuthenticate,
        Stream.callback((queue) =>
          Effect.gen(function* () {
            const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();

            const server = snapshot.mcpServers?.find((candidate) => candidate.id === mcpServerId);

            if (!server) {
              return yield* new McpServerAuthenticationError({
                mcpServerId,
                reason: "The MCP server does not exist.",
              });
            }

            if (!server.enabled) {
              return yield* new McpServerAuthenticationError({
                mcpServerId,
                reason: "Enable the MCP server before authentication.",
              });
            }

            if (server.transport === "stdio") {
              return yield* new McpServerAuthenticationError({
                mcpServerId,
                reason: "Local MCP servers do not support OAuth authentication.",
              });
            }

            const connectable = yield* withMcpServerCredentials(server).pipe(
              Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
            );

            const result = yield* agentController.authenticateMcpServer({
              server: connectable,
              onAuthorizationUrl: (authorizationUrl) => {
                Queue.offerUnsafe(queue, {
                  type: "authorization-required",
                  authorizationUrl,
                });
              },
            });

            yield* Queue.offer(queue, {
              type: "connected",
              toolCount: result.toolCount,
              recoveryFailures: result.recoveryFailures,
            });
          }).pipe(
            Effect.mapError((cause) =>
              isMcpServerAuthenticationError(cause)
                ? cause
                : new McpServerAuthenticationError({
                    mcpServerId,
                    reason: cause instanceof Error ? cause.message : String(cause),
                  }),
            ),
            Effect.catchTag("McpServerAuthenticationError", (error) => Queue.fail(queue, error)),
            Effect.andThen(Queue.end(queue)),
            Effect.forkScoped,
          ),
        ),
        { "rpc.aggregate": "provider" },
      ),

    [WS_METHODS.mcpServerGetHeaders]: ({ mcpServerId }) =>
      observeRpcEffect(
        WS_METHODS.mcpServerGetHeaders,
        requireManagedMcpServer(mcpServerId).pipe(
          Effect.flatMap(() => readMcpServerHeaders(mcpServerId)),
          Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
          Effect.map((headers) => ({ names: Object.keys(headers) })),
          Effect.mapError((cause) =>
            Predicate.isTagged(cause, "McpServerHeadersError")
              ? cause
              : new McpServerHeadersError({ mcpServerId, reason: "Could not read the headers." }),
          ),
        ),
        { "rpc.aggregate": "provider" },
      ),

    [WS_METHODS.mcpServerSetHeaders]: ({ mcpServerId, headers }) =>
      observeRpcEffect(
        WS_METHODS.mcpServerSetHeaders,
        requireManagedMcpServer(mcpServerId).pipe(
          Effect.flatMap(() => replaceMcpServerHeaders(mcpServerId, headers)),
          Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
          Effect.map((names) => ({ names })),
          Effect.mapError((cause) =>
            Predicate.isTagged(cause, "McpServerHeadersError")
              ? cause
              : new McpServerHeadersError({ mcpServerId, reason: "Could not save the headers." }),
          ),
        ),
        { "rpc.aggregate": "provider" },
      ),

    [WS_METHODS.subscriptionAuthStart]: ({ provider, ...options }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthStart,
        Effect.gen(function* () {
          yield* validateAccountInstance(provider, options.instanceId);

          return yield* Effect.tryPromise({
            try: () => subscriptionAuth.startLogin(provider, options),
            catch: (cause) =>
              new SubscriptionAuthError({
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        }),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthPoll]: ({ loginId }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthPoll,
        Effect.tryPromise({
          try: () => subscriptionAuth.pollLogin(loginId),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(refreshChangedSubscriptionProviders, resetChangedApiKeySessions),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthComplete]: ({ loginId, code }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthComplete,
        Effect.tryPromise({
          try: () => subscriptionAuth.completeLogin(loginId, code),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(refreshChangedSubscriptionProviders, resetChangedApiKeySessions),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthCancel]: ({ loginId }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthCancel,
        Effect.sync(() => {
          subscriptionAuth.cancelLogin(loginId);

          return {};
        }),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthLogout]: ({ provider, instanceId, accountId }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthLogout,
        Effect.tryPromise({
          try: () =>
            subscriptionAuth.logout(provider, accountId ? accountScope(accountId) : instanceId),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(
          refreshChangedSubscriptionProviders,
          resetChangedApiKeySessions,
          Effect.andThen(getAccessHealthSnapshot()),
        ),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthHealthTest]: ({ provider, instanceId, accountId }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthHealthTest,
        Effect.tryPromise({
          try: () =>
            subscriptionAuth.testHealth(provider, accountId ? accountScope(accountId) : instanceId),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(Effect.andThen(getAccessHealthSnapshot())),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthSetAccountOrder]: ({ provider, accountIds }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthSetAccountOrder,
        Effect.tryPromise({
          try: () => subscriptionAuth.setAccountOrder(provider, accountIds),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(Effect.andThen(getAccessHealthSnapshot())),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscriptionAuthSetAccountPaused]: ({ provider, accountId, paused }) =>
      observeRpcEffect(
        WS_METHODS.subscriptionAuthSetAccountPaused,
        Effect.tryPromise({
          try: () => subscriptionAuth.setAccountPaused(provider, accountId, paused),
          catch: (cause) =>
            new SubscriptionAuthError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(Effect.andThen(getAccessHealthSnapshot())),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.imageProviderList]: (_input) =>
      observeRpcEffect(WS_METHODS.imageProviderList, getImageProviderSnapshot(), {
        "rpc.aggregate": "server",
      }),

    [WS_METHODS.imageProviderHealthTest]: ({ provider }) =>
      observeRpcEffect(
        WS_METHODS.imageProviderHealthTest,
        Effect.tryPromise({
          try: () => runImageProviderHealthTest({ provider, subscriptionAuth }),
          catch: (cause) =>
            new ImageGenerationError({
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(Effect.andThen(getImageProviderSnapshot())),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscribeAuthAccess]: (_input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeAuthAccess,
        Effect.gen(function* () {
          const initialSnapshot = yield* loadAuthAccessSnapshot();
          const revisionRef = yield* Ref.make(1);

          const liveEvents: Stream.Stream<AuthAccessStreamEvent> = sessions.streamChanges.pipe(
            Stream.mapEffect((change) =>
              Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                Effect.map((revision) =>
                  toAuthAccessStreamEvent(change, revision, currentSessionId),
                ),
              ),
            ),
          );

          return Stream.concat(
            Stream.make({
              version: 1 as const,
              revision: 1,
              type: "snapshot" as const,
              payload: initialSnapshot,
            }),
            liveEvents,
          );
        }),
        { "rpc.aggregate": "auth" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.composioGetStatus
    | typeof WS_METHODS.composioSearchToolkits
    | typeof WS_METHODS.composioGetToolkit
    | typeof WS_METHODS.composioGetAuthSetup
    | typeof WS_METHODS.composioCreateAuthConfig
    | typeof WS_METHODS.composioAuthorize
    | typeof WS_METHODS.composioDisconnect
    | typeof WS_METHODS.composioUpdateConnection
    | typeof WS_METHODS.githubGetStatus
    | typeof WS_METHODS.githubStartLink
    | typeof WS_METHODS.githubPollLink
    | typeof WS_METHODS.githubDisconnect
    | typeof WS_METHODS.subscriptionAuthList
    | typeof WS_METHODS.mcpServerAuthenticate
    | typeof WS_METHODS.mcpServerListTools
    | typeof WS_METHODS.mcpServerGetHeaders
    | typeof WS_METHODS.mcpServerSetHeaders
    | typeof WS_METHODS.subscriptionAuthStart
    | typeof WS_METHODS.subscriptionAuthPoll
    | typeof WS_METHODS.subscriptionAuthComplete
    | typeof WS_METHODS.subscriptionAuthCancel
    | typeof WS_METHODS.subscriptionAuthLogout
    | typeof WS_METHODS.subscriptionAuthSetAccountOrder
    | typeof WS_METHODS.subscriptionAuthSetAccountPaused
    | typeof WS_METHODS.subscriptionAuthHealthTest
    | typeof WS_METHODS.imageProviderList
    | typeof WS_METHODS.imageProviderHealthTest
    | typeof WS_METHODS.subscribeAuthAccess
  >;
};
