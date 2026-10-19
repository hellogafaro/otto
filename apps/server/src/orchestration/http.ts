import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentHttpApi,
  ProviderInstanceId,
  type ThreadId,
} from "@otto/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as ChannelCommand from "../channels/channel-command.ts";
import * as ChannelRuntime from "../channels/channel-runtime.ts";
import * as ServerRuntimeStartup from "../server-runtime-startup.ts";
import * as ServerSettings from "../server-settings.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionBots from "../persistence/services/projection-bots.ts";
import { OrchestrationCommandReceiptRepository } from "../persistence/services/orchestration-command-receipts.ts";
import * as ProviderRegistry from "../provider/services/provider-registry.ts";
import { deriveProviderInstanceConfigMap } from "../provider/layers/provider-instance-registry-hydration.ts";
import { preflightProvider } from "../provider/provider-preflight.ts";
import { resolveTurnModelSelection } from "../provider/turn-provider-selection.ts";
import { SubscriptionAuthService } from "../subscription-auth/service.ts";
import { projectThreadDetailSnapshot } from "./activity-payload-projection.ts";
import {
  applyAuthenticatedCommandActor,
  isLibraryClientCommand,
  applyKnownGroupPerson,
  commandNamesPeople,
  sessionPersonId,
} from "./authenticated-command.ts";
import {
  cleanupFailedUploadedAttachments,
  dispatchKeepingAcceptedUploads,
  normalizeDispatchCommand,
} from "./normalizer.ts";
import { OrganizationAccounts } from "../auth/organization-accounts.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { OrchestrationEngineService } from "./services/orchestration-engine.ts";
import { ProjectionGroupRepository } from "../persistence/services/projection-groups.ts";
import { canSeeCommandBots, canSeeThreadById, visibleShellSnapshot } from "./group-visibility.ts";
import { ProjectionSnapshotQuery } from "./services/projection-snapshot-query.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const accounts = yield* OrganizationAccounts;
    const projectionGroups = yield* ProjectionGroupRepository;

    const canReadThread = (threadId: ThreadId, personId: AuthSessionId) =>
      canSeeThreadById({ projectionSnapshotQuery, projectionGroups }, threadId, personId);

    const projectionBots = yield* ProjectionBots.ProjectionBotRepository;
    const commandReceipts = yield* OrchestrationCommandReceiptRepository;
    const providerRegistry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
    const config = yield* ServerConfig.ServerConfig;
    const subscriptionAuth = yield* SubscriptionAuthService.forSecretsDir(config.secretsDir);
    const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
    const channelRuntime = yield* Effect.serviceOption(ChannelRuntime.ChannelRuntime);
    const startup = yield* Effect.serviceOption(ServerRuntimeStartup.ServerRuntimeStartup);

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          // Serve the lightweight command read model (thread bodies empty)
          // instead of the fully hydrated snapshot. Hydrating every message
          // and activity payload in the database has OOM-killed servers, and
          // the route's only consumer (the project CLI) reads projects alone —
          // UI clients load the shell and per-thread snapshots instead.
          return yield* projectionSnapshotQuery
            .getCommandReadModel()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const principal = yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const personId = sessionPersonId(principal);
          const people = yield* accounts.listPeople().pipe(Effect.orElseSucceed(() => []));
          const currentPerson = people.find((person) => person.userId === personId);

          return yield* projectionSnapshotQuery.getShellSnapshot().pipe(
            Effect.map((snapshot) => visibleShellSnapshot(snapshot, personId)),
            Effect.map((snapshot) => ({
              ...snapshot,
              currentPersonId: personId,
              ...(currentPerson ? { currentPersonDisplayName: currentPerson.displayName } : {}),
              people: people.map((person) => ({
                personId: AuthSessionId.make(person.userId),
                displayName: person.displayName,
                email: person.email,
                ...(person.image ? { image: person.image } : {}),
              })),
              bots: snapshot.bots.map((bot) => ({
                ...bot,
                channelBindings: Option.match(channelRuntime, {
                  onNone: () =>
                    ChannelRuntime.channelBindingsForRuntime(bot.channelBindings, () => false),
                  onSome: (runtime) => runtime.channelBindingsForRuntime(bot.channelBindings),
                }),
              })),
            })),
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_snapshot_failed", cause),
            ),
          );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const principal = yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          const readable = yield* canReadThread(
            args.params.threadId,
            sessionPersonId(principal),
          ).pipe(
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
            ),
          );

          if (!readable) return yield* failEnvironmentNotFound("thread_not_found");

          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(
              args.params.threadId,
              args.payload.turnLimit === undefined
                ? undefined
                : {
                    turnLimit: args.payload.turnLimit,
                    ...(args.payload.beforeCursor !== undefined
                      ? { beforeCursor: args.payload.beforeCursor }
                      : {}),
                  },
              { includeArchived: true },
            )
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );

          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }

          return projectThreadDetailSnapshot(snapshot.value);
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const principal = yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const command = args.payload;

          if (ChannelCommand.isChannelCommand(command)) {
            if (!principal.scopes.has(AuthAccessWriteScope)) {
              yield* requireEnvironmentScope(AuthAccessWriteScope);
            }

            const services = Option.all({ channelRuntime, startup });

            if (Option.isNone(services)) {
              return yield* failEnvironmentInternal(
                "orchestration_dispatch_failed",
                new Error("Channel services are unavailable."),
              );
            }

            return yield* services.value.startup
              .enqueueCommand(
                ChannelCommand.executeChannelCommand(services.value.channelRuntime, command),
              )
              .pipe(
                // The log gets the category only; channel errors can wrap provider responses.
                Effect.catchCause((cause) =>
                  ChannelCommand.channelCommandFailure(command, cause).pipe(
                    Effect.flatMap((failure) =>
                      failEnvironmentInternal("orchestration_dispatch_failed", {
                        channelFailureCategory: failure.category ?? "internal",
                      }),
                    ),
                  ),
                ),
              );
          }

          const decodedCommand = yield* normalizeDispatchCommand(command).pipe(
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
          );

          // Otto: Starting a run needs the routine scheduler, which only the app's live
          // connection reaches; recorded here it would stay queued forever.
          if (decodedCommand.type === "routine.run") {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }

          const needsPeople =
            decodedCommand.type === "group.create" ||
            decodedCommand.type === "group.leave" ||
            decodedCommand.type === "group.person.assign" ||
            decodedCommand.type === "thread.turn.start" ||
            decodedCommand.type === "thread.approval.respond" ||
            isLibraryClientCommand(decodedCommand);

          const people = needsPeople
            ? yield* accounts
                .listPeople()
                .pipe(
                  Effect.catch((cause) =>
                    failEnvironmentInternal("orchestration_dispatch_failed", cause),
                  ),
                )
            : [];

          const personId = sessionPersonId(principal);

          const actor = {
            personId,
            displayName:
              people.find((person) => person.userId === personId)?.displayName ??
              (principal.scopes.has(AuthAccessWriteScope) ? "Host" : "Paired person"),
            canManageGroups: principal.scopes.has(AuthAccessWriteScope),
          };

          const actorCommand = applyAuthenticatedCommandActor(decodedCommand, actor);

          const normalizedCommand = commandNamesPeople(actorCommand)
            ? applyKnownGroupPerson(actorCommand, people)
            : actorCommand;

          if (!normalizedCommand) {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }

          if (
            !(yield* canSeeCommandBots(
              { projectionBots, projectionGroups },
              normalizedCommand,
              personId,
            ))
          ) {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }

          // Bot engines bypass the turn preflight, so a changed engine is
          // checked here as in WebSocket dispatch. Only an unknown model
          // blocks the save; a missing provider is not evidence of that.
          if (
            (normalizedCommand.type === "bot.create" || normalizedCommand.type === "bot.update") &&
            normalizedCommand.engine &&
            Option.isSome(providerRegistry)
          ) {
            const engine = normalizedCommand.engine;

            const existingBot =
              normalizedCommand.type === "bot.update"
                ? yield* projectionBots.getById({ botId: normalizedCommand.botId }).pipe(
                    Effect.map(Option.getOrUndefined),
                    Effect.catch((cause) =>
                      failEnvironmentInternal("orchestration_dispatch_failed", cause),
                    ),
                  )
                : undefined;

            const engineChanged =
              existingBot === undefined ||
              existingBot.engine?.provider !== engine.provider ||
              existingBot.engine?.model !== engine.model;

            if (engineChanged) {
              const verdict = preflightProvider({
                providers: yield* providerRegistry.value.getProviders,
                providerId: engine.provider,
                model: engine.model,
                subscriptionStatuses: subscriptionAuth.statuses(),
                subscriptionHealth: (instanceId) =>
                  subscriptionAuth.providerInstanceRequestHealth(instanceId),
                now: yield* Clock.currentTimeMillis,
                requireSettledCatalog: true,
              });

              if (verdict?.category === "unsupported-model") {
                return yield* failEnvironmentInvalidRequest("invalid_command", {
                  detail: verdict.detail,
                  unavailability: verdict.category,
                });
              }
            }
          }

          const shouldPreflightTurn =
            normalizedCommand.type === "thread.turn.start" &&
            Option.isNone(
              yield* commandReceipts
                .getByCommandId({ commandId: normalizedCommand.commandId })
                .pipe(
                  Effect.catch((cause) =>
                    failEnvironmentInternal("orchestration_dispatch_failed", cause),
                  ),
                ),
            );

          if (shouldPreflightTurn && normalizedCommand.type === "thread.turn.start") {
            if (Option.isNone(providerRegistry)) {
              return yield* failEnvironmentInternal(
                "orchestration_dispatch_failed",
                new Error("Provider registry is unavailable."),
              );
            }

            const thread = yield* projectionSnapshotQuery
              .getThreadShellById(normalizedCommand.threadId)
              .pipe(
                Effect.map(Option.getOrUndefined),
                Effect.catch((cause) =>
                  failEnvironmentInternal("orchestration_dispatch_failed", cause),
                ),
              );

            const bootstrapThread = normalizedCommand.bootstrap?.createThread;
            const groupId = thread?.groupId ?? bootstrapThread?.groupId;

            // Every group bot hears a plain message and the round skips any bot that cannot
            // run, so only an explicitly addressed group bot is checked before sending.
            const botId = groupId
              ? normalizedCommand.respondingBotId
              : (thread?.botId ?? bootstrapThread?.botId ?? normalizedCommand.respondingBotId);

            const bot = botId
              ? yield* projectionBots.getById({ botId }).pipe(
                  Effect.map(Option.getOrUndefined),
                  Effect.catch((cause) =>
                    failEnvironmentInternal("orchestration_dispatch_failed", cause),
                  ),
                )
              : undefined;

            const settings = Option.isSome(serverSettings)
              ? yield* serverSettings.value.getSettings.pipe(
                  Effect.catch((cause) =>
                    failEnvironmentInternal("orchestration_dispatch_failed", cause),
                  ),
                )
              : undefined;

            const providers = yield* providerRegistry.value.getProviders;
            const stored = thread?.modelSelection ?? bootstrapThread?.modelSelection;

            const selection =
              settings === undefined
                ? bot?.engine
                  ? {
                      instanceId: ProviderInstanceId.make(bot.engine.provider),
                      model: bot.engine.model,
                    }
                  : (normalizedCommand.modelSelection ?? stored)
                : resolveTurnModelSelection({
                    botEngine: bot?.engine ?? null,
                    requested: normalizedCommand.modelSelection,
                    stored,
                    liveDefault: settings.textGenerationModelSelection,
                    isBotThread:
                      thread?.botId != null ||
                      thread?.groupId != null ||
                      bootstrapThread?.botId != null ||
                      bootstrapThread?.groupId != null,
                    providers,
                  });

            const providerId = selection?.instanceId ?? thread?.session?.providerName;
            const model = selection?.model ?? "";

            if (providerId && model && (!groupId || botId)) {
              const providerInstanceConfig = settings
                ? deriveProviderInstanceConfigMap(settings)[ProviderInstanceId.make(providerId)]
                : undefined;

              const verdict = preflightProvider({
                providers,
                providerId,
                model,
                ...(providerInstanceConfig ? { providerInstanceConfig } : {}),
                subscriptionStatusForInstance: (subscriptionProvider, instanceId) =>
                  subscriptionAuth.accountStatus(subscriptionProvider, instanceId),
                subscriptionHealth: (instanceId) =>
                  subscriptionAuth.providerInstanceRequestHealth(instanceId),
                now: yield* Clock.currentTimeMillis,
                requireSettledCatalog: true,
              });

              if (verdict) {
                yield* cleanupFailedUploadedAttachments(command, normalizedCommand);

                return yield* failEnvironmentInvalidRequest("invalid_command", {
                  detail: verdict.detail,
                  unavailability: verdict.category,
                  ...(verdict.category === "missing-login" || verdict.category === "expired-login"
                    ? { repairAction: "providers" }
                    : {}),
                });
              }
            }
          }

          return yield* dispatchKeepingAcceptedUploads({
            command: args.payload,
            normalizedCommand,
            awaitReady: Effect.void,
            dispatch: orchestrationEngine.dispatch(normalizedCommand, { actor }),
            interruptible: false,
            receipts: Option.some(commandReceipts),
          }).pipe(
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_dispatch_failed", cause),
            ),
          );
        }),
      );
  }),
);
