import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  AuthAccessWriteScope,
  type ClientOrchestrationCommand,
  CommandId,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProviderInstanceId,
  WsRpcGroup,
} from "@otto/contracts";
import { deriveProviderInstanceConfigMap } from "./provider/layers/provider-instance-registry-hydration.ts";
import * as ChannelCommand from "./channels/channel-command.ts";
import {
  applyAuthenticatedCommandActor,
  isLibraryClientCommand,
  applyKnownGroupPerson,
  commandNamesPeople,
} from "./orchestration/authenticated-command.ts";
import {
  cleanupFailedUploadedAttachments,
  dispatchKeepingAcceptedUploads,
  normalizeDispatchCommand,
} from "./orchestration/normalizer.ts";
import { readWorkflowScript } from "./orchestration/workflow-script-query.ts";
import {
  canSeeCommandBots,
  canSeeThread,
  canSeeThreadById,
  visibleShellSnapshot,
} from "./orchestration/group-visibility.ts";
import { preflightProvider } from "./provider/provider-preflight.ts";
import { resolveTurnModelSelection } from "./provider/turn-provider-selection.ts";

import { isOrchestrationDispatchCommandError, nowIso } from "./ws-support.ts";
import type { WsConnection } from "./ws-connection.ts";

export const createWsOrchestrationHandlers = ({
  currentPersonId,
  accounts,
  projectionGroups,
  projectionSnapshotQuery,
  projectionBots,
  routineRepository,
  checkpointDiffQuery,
  providerRegistry,
  subscriptionAuth,
  serverSettings,
  textGeneration,
  startup,
  commandReceipts,
  channelRuntime,
  channelBindingsForRuntime,
  observeRpcEffect,
  loadEnvironmentPeople,
  currentSession,
  dispatchNormalizedCommand,
}: Pick<
  WsConnection,
  | "currentPersonId"
  | "accounts"
  | "projectionGroups"
  | "projectionSnapshotQuery"
  | "projectionBots"
  | "routineRepository"
  | "checkpointDiffQuery"
  | "providerRegistry"
  | "subscriptionAuth"
  | "serverSettings"
  | "textGeneration"
  | "startup"
  | "commandReceipts"
  | "channelRuntime"
  | "channelBindingsForRuntime"
  | "usage"
  | "observeRpcEffect"
  | "loadEnvironmentPeople"
  | "currentSession"
  | "dispatchNormalizedCommand"
>) => {
  // Otto: A cleared routine title comes back generated from the routine's instructions.
  const withRegeneratedRoutineTitle = (command: ClientOrchestrationCommand) =>
    Effect.gen(function* () {
      if (command.type !== "routine.update" || command.regenerateTitle !== true) return command;
      const { regenerateTitle: _, ...update } = command;

      const routine = yield* routineRepository.getById(command.routineId);

      if (routine === null || routine.deletedAt !== null || Option.isNone(textGeneration)) {
        return yield* new OrchestrationDispatchCommandError({
          message: "That routine title cannot be generated here.",
        });
      }

      const { textGenerationModelSelection: modelSelection } = yield* serverSettings.getSettings;

      const { title } = yield* textGeneration.value.generateThreadTitle({
        cwd: process.cwd(),
        message: routine.procedure,
        modelSelection,
      });

      return { ...update, job: title };
    }).pipe(
      Effect.mapError((cause) =>
        isOrchestrationDispatchCommandError(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: "Could not generate a routine title.",
              cause,
            }),
      ),
    );

  return {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.dispatchCommand,
        Effect.gen(function* () {
          if (ChannelCommand.isChannelCommand(command)) {
            if (!currentSession.scopes.includes(AuthAccessWriteScope)) {
              return yield* new OrchestrationDispatchCommandError({
                message: "Only the environment host can manage external channels.",
              });
            }

            if (Option.isNone(channelRuntime)) {
              return yield* new OrchestrationDispatchCommandError({
                message: "Channel delivery storage is unavailable.",
              });
            }

            return yield* startup.enqueueCommand(
              ChannelCommand.executeChannelCommand(channelRuntime.value, command).pipe(
                Effect.catchCause((cause) =>
                  ChannelCommand.channelCommandFailure(command, cause).pipe(
                    Effect.flatMap((failure) =>
                      Effect.fail(ChannelCommand.channelDispatchError(failure)),
                    ),
                  ),
                ),
              ),
            );
          }

          const decodedCommand = yield* normalizeDispatchCommand(
            yield* withRegeneratedRoutineTitle(command),
          );

          const currentPerson =
            decodedCommand.type === "group.create" ||
            decodedCommand.type === "group.leave" ||
            decodedCommand.type === "thread.turn.start" ||
            decodedCommand.type === "thread.approval.respond" ||
            isLibraryClientCommand(decodedCommand)
              ? yield* loadEnvironmentPeople().pipe(Effect.map((people) => people.current))
              : undefined;

          const actorCommand = applyAuthenticatedCommandActor(decodedCommand, {
            personId: currentPersonId,
            displayName: currentPerson?.displayName ?? "Paired person",
            canManageGroups: currentSession.scopes.includes(AuthAccessWriteScope),
          });

          let normalizedCommand = actorCommand;

          // Otto: Nobody acts on a chat they cannot see.
          const targetThreadId =
            "threadId" in actorCommand && actorCommand.type !== "thread.create"
              ? actorCommand.threadId
              : undefined;

          if (
            targetThreadId !== undefined &&
            !(yield* canSeeThreadById(
              { projectionSnapshotQuery, projectionGroups },
              targetThreadId,
              currentPersonId,
            ))
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: "This chat is private to the person who started it.",
            });
          }

          if (
            !(yield* canSeeCommandBots(
              { projectionBots, projectionGroups },
              actorCommand,
              currentPersonId,
            ))
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: "This bot is private to its owner.",
            });
          }

          if (commandNamesPeople(actorCommand)) {
            const people = yield* accounts
              .listPeople()
              .pipe(
                Effect.mapError(
                  () =>
                    new OrchestrationDispatchCommandError({ message: "Could not load people." }),
                ),
              );

            const knownPersonCommand = applyKnownGroupPerson(actorCommand, people);

            if (!knownPersonCommand) {
              return yield* new OrchestrationDispatchCommandError({
                message: "Only people in this organization can be added to a group.",
              });
            }

            normalizedCommand = knownPersonCommand;
          }

          // Bot engines bypass the thread.turn.start preflight (the
          // decider overwrites the command's modelSelection with the
          // bot engine), so validate the slug here while the provider
          // snapshot is available. A missing provider or empty model
          // list is not evidence the model is unknown. On bot.update the
          // check only runs when the engine actually changes, so a model
          // that dropped out of the catalog cannot block unrelated saves.
          const existingBot =
            normalizedCommand.type === "bot.update"
              ? yield* projectionBots
                  .getById({ botId: normalizedCommand.botId })
                  .pipe(Effect.map(Option.getOrUndefined))
              : undefined;

          const engineForValidation =
            normalizedCommand.type === "bot.create" || normalizedCommand.type === "bot.update"
              ? (normalizedCommand.engine ?? undefined)
              : undefined;

          const engineChanged =
            engineForValidation !== undefined &&
            (existingBot === undefined ||
              existingBot.engine?.provider !== engineForValidation.provider ||
              existingBot.engine?.model !== engineForValidation.model);

          if (engineForValidation !== undefined && engineChanged) {
            const engine = engineForValidation;

            const verdict = preflightProvider({
              providers: yield* providerRegistry.getProviders,
              providerId: engine.provider,
              model: engine.model,
              subscriptionStatuses: subscriptionAuth.statuses(),
              subscriptionHealth: (instanceId) =>
                subscriptionAuth.providerInstanceRequestHealth(instanceId),
              now: yield* Clock.currentTimeMillis,
              requireSettledCatalog: true,
            });

            if (verdict?.category === "unsupported-model") {
              return yield* new OrchestrationDispatchCommandError({
                message: verdict.detail,
                unavailability: verdict.category,
              });
            }
          }

          // A retried turn the engine already accepted replays its receipt, so
          // provider and cap gates must not turn that success into a failure.
          const alreadyAccepted =
            normalizedCommand.type === "thread.turn.start" && Option.isSome(commandReceipts)
              ? yield* commandReceipts.value
                  .getByCommandId({ commandId: normalizedCommand.commandId })
                  .pipe(
                    Effect.map(
                      (receipt) =>
                        Option.isSome(receipt) &&
                        receipt.value.status === "accepted" &&
                        receipt.value.aggregateId === normalizedCommand.threadId,
                    ),
                    Effect.orElseSucceed(() => false),
                  )
              : false;

          if (normalizedCommand.type === "thread.turn.start" && !alreadyAccepted) {
            const thread = yield* projectionSnapshotQuery
              .getThreadShellById(normalizedCommand.threadId)
              .pipe(Effect.map(Option.getOrUndefined));

            const bootstrapThread = normalizedCommand.bootstrap?.createThread;
            const groupId = thread?.groupId ?? bootstrapThread?.groupId;

            // Every group bot hears a plain message and the round skips any bot that cannot
            // run, so only an explicitly addressed group bot is checked before sending.
            const botId = groupId
              ? normalizedCommand.respondingBotId
              : (thread?.botId ?? bootstrapThread?.botId ?? normalizedCommand.respondingBotId);

            const bot = botId
              ? yield* projectionBots.getById({ botId }).pipe(Effect.map(Option.getOrUndefined))
              : undefined;

            const settings = yield* serverSettings.getSettings;
            const providers = yield* providerRegistry.getProviders;
            const stored = thread?.modelSelection ?? bootstrapThread?.modelSelection;

            const selection = resolveTurnModelSelection({
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

            const providerId = selection.instanceId ?? thread?.session?.providerName;
            const model = selection.model ?? "";

            if (providerId && model && (!groupId || botId)) {
              const providerInstanceConfig =
                deriveProviderInstanceConfigMap(settings)[ProviderInstanceId.make(providerId)];

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

                return yield* new OrchestrationDispatchCommandError({
                  message: verdict.detail,
                  unavailability: verdict.category,
                  ...(verdict.repairAction ? { repairAction: verdict.repairAction } : {}),
                });
              }
            }
          }

          // Archive means "done with this thread", so a live provider
          // session must not keep running background work (PR monitors,
          // dev servers, subagent fleets) after it lands.
          const parkingCommand =
            normalizedCommand.type === "thread.archive" ? normalizedCommand : undefined;

          // Best-effort on purpose: the user's archive must not
          // fail because this cleanup read blipped, so a failed read
          // logs and skips the stop instead of propagating.
          const shouldStopSessionAfterCommand = parkingCommand
            ? yield* projectionSnapshotQuery.getThreadShellById(parkingCommand.threadId).pipe(
                Effect.map(
                  Option.match({
                    onNone: () => false,
                    onSome: (thread) =>
                      thread.session !== null && thread.session.status !== "stopped",
                  }),
                ),
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    "failed to read thread session state before session-stop check",
                    { threadId: parkingCommand.threadId, cause },
                  ).pipe(Effect.as(false)),
                ),
              )
            : false;

          // Startup readiness is awaited first so the engine dispatch itself
          // runs inline instead of from the startup queue. A bootstrap stays
          // cancellable because it awaits its own engine dispatches.
          const result = yield* dispatchKeepingAcceptedUploads({
            command,
            normalizedCommand,
            awaitReady: startup.awaitCommandReady,
            dispatch: dispatchNormalizedCommand(normalizedCommand),
            interruptible:
              normalizedCommand.type === "thread.turn.start" && !!normalizedCommand.bootstrap,
            receipts: commandReceipts,
          });

          if (parkingCommand) {
            if (shouldStopSessionAfterCommand) {
              yield* Effect.gen(function* () {
                const stopCommand = yield* normalizeDispatchCommand({
                  type: "thread.session.stop",
                  commandId: CommandId.make(`session-stop-for-archive:${parkingCommand.commandId}`),
                  threadId: parkingCommand.threadId,
                  createdAt: yield* nowIso,
                });

                yield* dispatchNormalizedCommand(stopCommand);
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(`failed to stop provider session during archive`, {
                    threadId: parkingCommand.threadId,
                    cause,
                  }),
                ),
              );
            }
          }

          return result;
        }).pipe(
          Effect.mapError((cause) =>
            isOrchestrationDispatchCommandError(cause)
              ? cause
              : new OrchestrationDispatchCommandError({
                  message: "Failed to dispatch orchestration command",
                  cause,
                }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),

    [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getWorkflowScript,
        readWorkflowScript({ scriptPath: input.scriptPath }),
        { "rpc.aggregate": "orchestration" },
      ),

    [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getTurnDiff,
        checkpointDiffQuery.getTurnDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetTurnDiffError({
                message: "Failed to load turn diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),

    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getFullThreadDiff,
        checkpointDiffQuery.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load the full chat diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),

    [ORCHESTRATION_WS_METHODS.searchThreads]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.searchThreads,
        projectionSnapshotQuery.searchThreads(input).pipe(
          Effect.flatMap((result) =>
            Effect.gen(function* () {
              const groups = (yield* projectionGroups.listAll()).map((group) => ({
                id: group.groupId,
                members: group.members,
              }));

              const matches = yield* Effect.filter(result.matches, (match) =>
                projectionSnapshotQuery
                  .getThreadShellById(match.threadId)
                  .pipe(
                    Effect.map((thread) =>
                      Option.isNone(thread)
                        ? false
                        : canSeeThread(thread.value, groups, currentPersonId),
                    ),
                  ),
              );

              return { ...result, matches };
            }),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationSearchThreadsError({
                message: "Failed to search conversations",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),

    [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
        projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
          Effect.map((snapshot) => visibleShellSnapshot(snapshot, currentPersonId)),
          Effect.map((snapshot) => ({
            ...snapshot,
            bots: snapshot.bots.map((bot) => ({
              ...bot,
              channelBindings: channelBindingsForRuntime(bot.channelBindings ?? []),
            })),
          })),
          Effect.tapError((cause) =>
            Effect.logError("orchestration archived shell snapshot load failed", { cause }),
          ),
          Effect.mapError(
            (cause) =>
              new OrchestrationGetSnapshotError({
                message: "Failed to load archived orchestration shell snapshot",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof ORCHESTRATION_WS_METHODS.dispatchCommand
    | typeof ORCHESTRATION_WS_METHODS.getWorkflowScript
    | typeof ORCHESTRATION_WS_METHODS.getTurnDiff
    | typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff
    | typeof ORCHESTRATION_WS_METHODS.searchThreads
    | typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot
  >;
};
