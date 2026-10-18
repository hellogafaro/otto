import * as Data from "effect/Data";
import type { OttoDelegationDispatch } from "../provider/otto-delegation-runtime.ts";
import * as Predicate from "effect/Predicate";
import {
  OttoUsageReservationId,
  type BotId,
  isOttoDelegationTerminal,
  CommandId,
  type DelegationId,
  type ModelSelection,
  ProviderInstanceId,
  ThreadId,
  MessageId,
  type OrchestrationCommand,
} from "@otto/contracts";
import { driverSupportsDelegation } from "@otto/shared/delegationProviders";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BotInboxService, type BotInboxItem } from "../bot-inbox/service.ts";
import { ServerConfig } from "../config.ts";
import { isSubscriptionProviderId, SubscriptionAuthService } from "../subscription-auth/service.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/services/projection-snapshot-query.ts";
import { ProjectionBotRepository } from "../persistence/services/projection-bots.ts";
import { ProjectionMcpServerRepository } from "../persistence/services/projection-mcp-servers.ts";
import { AgentController } from "../provider/services/agent-controller.ts";
import { ProviderRegistry } from "../provider/services/provider-registry.ts";
import { BotUsageLedger } from "../usage/bot-usage-ledger.ts";
import {
  RoutineRuntimeAdapter,
  type Routine,
  type RoutineDispatchResult,
  type RoutineDependencyFailure,
  type RoutineRun,
  type RoutineRuntimeAdapterShape,
} from "./types.ts";

const routineTask = (procedure: string) =>
  `Run the approved routine procedure below once. Explicit authorization in this procedure applies to this run within its stated scope and conditions; do not ask again for actions it already authorizes. Do not expand that authority or create, update, enable, pause, or delete a routine or schedule.\n\n${procedure}`;

export const findBlockingDependencyIncident = (
  incidents: ReadonlyArray<BotInboxItem>,
  botId: BotInboxItem["botId"],
  connectorDependencies: ReadonlyArray<string>,
) =>
  incidents.find((incident) => {
    if (
      incident.botId !== botId ||
      incident.status !== "open" ||
      (incident.kind !== "oauth-expired" && incident.kind !== "connector-failure")
    ) {
      return false;
    }

    const [, dependencyId] = incident.incidentKey.split(":");

    if (!dependencyId) return false;

    return connectorDependencies.some(
      (id) => id === dependencyId || `mcp-${id}` === dependencyId || id === `mcp-${dependencyId}`,
    );
  });

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const bots = yield* ProjectionBotRepository;
  const mcpServers = yield* ProjectionMcpServerRepository;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;
  const inbox = BotInboxService.forSecretsDir(config.secretsDir);
  const subscriptionAuth = yield* SubscriptionAuthService.forSecretsDir(config.secretsDir);
  const botUsageLedger = yield* BotUsageLedger;
  const agentController = yield* AgentController;

  const dispatch = (command: OrchestrationCommand) => engine.dispatch(command);

  // Otto: A chat started for one run uses the bot's own engine, else the routine chat's model.
  const perRunModelSelection = (routine: Routine) =>
    Effect.gen(function* () {
      const engine = Option.getOrNull(yield* bots.getById({ botId: routine.botId }))?.engine;

      if (engine) {
        return {
          instanceId: ProviderInstanceId.make(engine.provider),
          model: engine.model,
          ...(engine.options ? { options: engine.options } : {}),
        } satisfies ModelSelection;
      }

      return Option.getOrNull(yield* snapshots.getThreadShellById(routine.targetThreadId))
        ?.modelSelection;
    });

  const isTargetBusy: RoutineRuntimeAdapterShape["isTargetBusy"] = (routine) =>
    routine.threadMode === "per-run"
      ? Effect.succeed(false)
      : snapshots.getThreadShellById(routine.targetThreadId).pipe(
          Effect.map(
            Option.match({
              onNone: () => false,
              onSome: (thread) =>
                thread.latestTurn?.state === "running" ||
                thread.session?.status === "starting" ||
                thread.session?.status === "running",
            }),
          ),
          Effect.orDie,
        );

  const checkDependencies: RoutineRuntimeAdapterShape["checkDependencies"] = (routine) =>
    Effect.gen(function* () {
      const bot = yield* bots.getById({ botId: routine.botId });

      if (Option.isNone(bot) || bot.value.archivedAt !== null) {
        return {
          kind: "bot",
          reason: "The assigned bot is archived or missing.",
          nextAction: "Restore the bot, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      if (routine.delegateToBotId !== null) {
        if (routine.delegateToBotId === routine.botId) {
          return {
            kind: "bot",
            reason: "This routine hands its work to its own bot.",
            nextAction:
              "Pick another bot to do the work, or clear the helper, then resume the routine.",
          } satisfies RoutineDependencyFailure;
        }

        const helper = yield* bots.getById({ botId: routine.delegateToBotId });

        if (Option.isNone(helper) || helper.value.archivedAt !== null) {
          return {
            kind: "bot",
            reason: "The bot this routine hands work to is archived or missing.",
            nextAction: "Restore that bot or pick another one, then resume the routine.",
          } satisfies RoutineDependencyFailure;
        }

        // Standard OpenCode runs on the legacy bridge, which cannot enforce a
        // delegated grant, so its bots never take bot work.
        const helperInstanceId = helper.value.engine?.provider;

        if (helperInstanceId !== undefined) {
          const helperDriver =
            (yield* providers.getProviders).find(
              (provider) => provider.instanceId === helperInstanceId,
            )?.driver ?? helperInstanceId;

          if (!driverSupportsDelegation(helperDriver)) {
            return {
              kind: "bot",
              reason: `${helper.value.name} runs on a provider that cannot take bot work.`,
              nextAction: "Pick another bot to do the work, then resume the routine.",
            } satisfies RoutineDependencyFailure;
          }
        }
      }

      const target = yield* snapshots.getThreadShellById(routine.targetThreadId);

      if (
        routine.threadMode === "target" &&
        (Option.isNone(target) ||
          target.value.archivedAt !== null ||
          target.value.projectId !== routine.projectId ||
          target.value.botId !== routine.botId)
      ) {
        return {
          kind: "workspace",
          reason: "The routine chat is unavailable.",
          nextAction: "Restore the bot chat, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      inbox.reload();

      const dependencyIncident = findBlockingDependencyIncident(
        inbox.list(),
        routine.botId,
        routine.connectorDependencies,
      );

      if (dependencyIncident !== undefined) {
        return {
          kind: "connector",
          reason: dependencyIncident.lastFailure,
          nextAction: dependencyIncident.nextAction,
        } satisfies RoutineDependencyFailure;
      }

      const project = yield* snapshots.getProjectShellById(routine.projectId);

      if (Option.isNone(project) || !(yield* fileSystem.exists(project.value.workspaceRoot))) {
        return {
          kind: "workspace",
          reason: "The routine workspace is unavailable.",
          nextAction: "Restore the project workspace, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      const readModel = yield* snapshots.getCommandReadModel();

      const missingSkill = routine.skillAssignmentIds.find(
        (id) =>
          !(readModel.skillAssignments ?? []).some(
            (assignment) => assignment.id === id && assignment.botId === routine.botId,
          ),
      );

      if (missingSkill !== undefined) {
        return {
          kind: "bot",
          reason: `Assigned skill '${missingSkill}' is unavailable.`,
          nextAction: "Assign the skill again, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      const configuredMcpServers = yield* mcpServers.listAll();

      const unavailableConnector = routine.connectorDependencies.find(
        (id) => !configuredMcpServers.some((server) => server.id === id && server.enabled),
      );

      if (unavailableConnector !== undefined) {
        return {
          kind: "connector",
          reason: `Required connector '${unavailableConnector}' is unavailable.`,
          nextAction: "Enable or reconnect the connector, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      const unhealthySubscription = routine.connectorDependencies.find((id) => {
        if (!isSubscriptionProviderId(id)) return false;
        const status = subscriptionAuth.statuses().find((entry) => entry.provider === id);

        return (
          status !== undefined &&
          ["expired", "revoked", "failed", "failed-first-request"].includes(status.health)
        );
      });

      if (unhealthySubscription !== undefined) {
        return {
          kind: "connector",
          reason: `Required connector '${unhealthySubscription}' needs attention.`,
          nextAction: "Reconnect the connector, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      const providerInstanceId =
        routine.threadMode === "target"
          ? Option.getOrNull(target)?.modelSelection.instanceId
          : (yield* perRunModelSelection(routine))?.instanceId;

      const providerSnapshots = yield* providers.getProviders;

      if (!providerSnapshots.some((provider) => provider.instanceId === providerInstanceId)) {
        return {
          kind: "provider",
          reason: `Provider '${providerInstanceId ?? routine.botId}' is unavailable.`,
          nextAction: "Reconnect the provider, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      if (routine.sandbox !== "local") {
        return {
          kind: "execution",
          reason: `Sandbox '${routine.sandbox}' is unavailable.`,
          nextAction: "Restore the sandbox provider, then resume the routine.",
        } satisfies RoutineDependencyFailure;
      }

      inbox.resolve(`routine:${routine.id}`);

      return null;
    }).pipe(Effect.orDie);

  const recordQueued: RoutineRuntimeAdapterShape["recordQueued"] = (run) =>
    run.trigger === "scheduled" || run.trigger === "missed"
      ? dispatch({
          type: "routine.run.scheduled",
          commandId: CommandId.make(`server:routine.run:${run.routineId}:${run.scheduledFor}`),
          routineId: run.routineId,
          runId: run.id,
          trigger: run.trigger,
          scheduledFor: run.scheduledFor,
          createdAt: run.createdAt,
        }).pipe(Effect.asVoid, Effect.orDie)
      : Effect.void;

  const recordBlocked: RoutineRuntimeAdapterShape["recordBlocked"] = (run, failure) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        dispatch({
          type: "routine.run.block",
          commandId: CommandId.make(`server:routine.block:${run.id}`),
          routineId: run.routineId,
          runId: run.id,
          failure: { kind: failure.kind, message: failure.reason },
          createdAt: DateTime.formatIso(now),
        }),
      ),
      Effect.asVoid,
      Effect.orDie,
    );

  const recordCompleted: RoutineRuntimeAdapterShape["recordCompleted"] = (
    run,
    nextRunAt,
    summary,
    completedAt,
  ) =>
    dispatch({
      type: "routine.run.complete",
      commandId: CommandId.make(`server:routine.complete:${run.id}`),
      routineId: run.routineId,
      runId: run.id,
      result: { summary },
      usageRef: null,
      nextRunAt,
      createdAt: completedAt,
    }).pipe(Effect.asVoid, Effect.orDie);

  const recordFailed: RoutineRuntimeAdapterShape["recordFailed"] = (run, failure, completedAt) =>
    dispatch({
      type: "routine.run.fail",
      commandId: CommandId.make(`server:routine.fail:${run.id}`),
      routineId: run.routineId,
      runId: run.id,
      failure: { kind: failure.kind, message: failure.reason },
      usageRef: null,
      createdAt: completedAt,
    }).pipe(Effect.asVoid, Effect.orDie);

  const recordCanceled: RoutineRuntimeAdapterShape["recordCanceled"] = (run, completedAt) =>
    dispatch({
      type: "routine.run.cancel",
      commandId: CommandId.make(`server:routine.cancel:${run.id}`),
      routineId: run.routineId,
      runId: run.id,
      createdAt: completedAt,
    }).pipe(
      Effect.asVoid,
      // A run that ended meanwhile keeps its outcome.
      Effect.catchTag("OrchestrationCommandInvariantError", () => Effect.void),
      Effect.orDie,
    );

  const cancelDelegatedRun: RoutineRuntimeAdapterShape["cancelDelegatedRun"] = (run) =>
    Effect.gen(function* () {
      if (run.threadRef === null) return;
      const readModel = yield* snapshots.getCommandReadModel();

      const delegation = (readModel.delegations ?? []).find(
        (candidate) =>
          candidate.trigger === "scheduled" &&
          !isOttoDelegationTerminal(candidate.phase) &&
          Predicate.hasProperty(candidate.phase, "childThreadId") &&
          candidate.phase.childThreadId === run.threadRef,
      );

      if (delegation === undefined) return;
      yield* cancelDelegation(run, delegation.delegationId);
    }).pipe(Effect.orDie);

  const findDelegatedRunDelegation: RoutineRuntimeAdapterShape["findDelegatedRunDelegation"] = (
    threadRef,
  ) =>
    snapshots.getCommandReadModel().pipe(
      Effect.map(
        (readModel) =>
          (readModel.delegations ?? []).find(
            (candidate) =>
              candidate.trigger === "scheduled" &&
              Predicate.hasProperty(candidate.phase, "childThreadId") &&
              candidate.phase.childThreadId === threadRef,
          ) ?? null,
      ),
      Effect.orDie,
    );

  const openFailureIncident: RoutineRuntimeAdapterShape["openFailureIncident"] = (
    routine,
    failure,
  ) =>
    Effect.gen(function* () {
      const bot = yield* bots.getById({ botId: routine.botId });
      inbox.ensureOpen({
        incidentKey: `routine:${routine.id}`,
        kind: "routine-failure",
        botId: routine.botId,
        botName: Option.isSome(bot) ? bot.value.name : "Bot",
        taskOrRoutine: routine.job,
        lastFailure: failure.reason,
        nextAction: failure.nextAction,
      });
    }).pipe(Effect.orDie);

  const resolveFailureIncident: RoutineRuntimeAdapterShape["resolveFailureIncident"] = (
    routineId,
  ) => Effect.sync(() => void inbox.resolve(`routine:${routineId}`));

  // Records the run as started. The decider refuses a run that was canceled or
  // settled first, and then nothing may start for it. Any other failure blocks
  // the run with its reason instead of passing for a cancellation.
  const startRun = (routine: Routine, run: RoutineRun, threadRef: ThreadId) =>
    Effect.gen(function* () {
      const started = yield* dispatch({
        type: "routine.run.start",
        commandId: CommandId.make(`server:routine.start:${run.id}`),
        routineId: routine.id,
        runId: run.id,
        threadRef,
        startedAt: DateTime.formatIso(yield* DateTime.now),
      }).pipe(Effect.result);

      if (Predicate.isTagged(started, "Success")) return "started" as const;

      if (
        Predicate.isTagged(started.failure, "OrchestrationCommandInvariantError") ||
        Predicate.isTagged(started.failure, "OrchestrationCommandPreviouslyRejectedError")
      ) {
        return "ended" as const;
      }

      return {
        failure: {
          kind: "execution",
          reason: `The routine run could not start: ${started.failure.message}`,
          nextAction: "Resume the routine to try again.",
        },
      } as const;
    });

  const cancelDelegation = (run: RoutineRun, delegationId: DelegationId) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        dispatch({
          type: "delegation.cancel",
          commandId: CommandId.make(`server:routine.cancel-delegation:${run.id}`),
          delegationId,
          keep: false,
          createdAt: DateTime.formatIso(now),
        }),
      ),
    );

  // Scheduled bot work runs in the helper's chat and shows as a card in the owner
  // chat. The run follows that work, so pausing the routine leaves it running.
  const dispatchDelegatedTurn = (routine: Routine, run: RoutineRun, childBotId: BotId) =>
    Effect.gen(function* () {
      if (!agentController.dispatchDelegation) {
        return {
          failure: {
            kind: "execution",
            reason: "Bot work is not available in this environment.",
            nextAction: "Clear the helper bot on this routine, then resume it.",
          },
        } as const;
      }

      const handle = yield* agentController
        .dispatchDelegation(
          DelegationDispatch["Scheduled"]({
            parentThreadId: routine.targetThreadId,
            parentBotId: routine.botId,
            childBotId,
            task: routineTask(routine.procedure),
            expectedResult: "A short summary of what you did and anything the owner should know.",
            runtimeMode: routine.approvalPolicy,
          }),
        )
        .pipe(Effect.result);

      if (Predicate.isTagged(handle, "Failure")) {
        return {
          failure: {
            kind: "execution",
            reason: handle.failure.detail,
            nextAction: "Check the helper bot, then resume the routine.",
          },
        } as const;
      }

      const { childThreadId: threadRef, delegationId } = handle.success;
      // A run canceled while its work was starting has no threadRef for
      // cancelDelegatedRun to match, so cancel the work by its id here.
      const started = yield* startRun(routine, run, threadRef);

      if (started !== "started") {
        yield* cancelDelegation(run, delegationId);

        return started === "ended" ? ({ canceled: true } satisfies RoutineDispatchResult) : started;
      }

      return { threadRef } satisfies RoutineDispatchResult;
    });

  // Otto: A per-run routine starts its own chat with the bot, named after the routine,
  // keyed by the run so a retried dispatch reuses it.
  const runThread = (routine: Routine, run: RoutineRun, createdAt: string) =>
    Effect.gen(function* () {
      if (routine.threadMode === "target") return routine.targetThreadId;
      const threadId = ThreadId.make(`routine-run-${run.id}`);

      if (Option.isSome(yield* snapshots.getThreadShellById(threadId))) return threadId;
      const modelSelection = yield* perRunModelSelection(routine);

      if (!modelSelection) return null;

      yield* dispatch({
        type: "thread.create",
        commandId: CommandId.make(`server:routine.thread:${run.id}`),
        threadId,
        projectId: routine.projectId,
        botId: routine.botId,
        groupId: null,
        title: routine.job,
        // Otto: A run's chat is seen by whoever sees its routine.
        createdBy: routine.createdBy,
        visibility: routine.visibility,
        modelSelection,
        runtimeMode: routine.approvalPolicy,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });

      return threadId;
    });

  const dispatchTurn: RoutineRuntimeAdapterShape["dispatchTurn"] = (routine, run) =>
    Effect.gen(function* () {
      if (routine.delegateToBotId !== null) {
        return yield* dispatchDelegatedTurn(routine, run, routine.delegateToBotId);
      }

      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const threadRef = yield* runThread(routine, run, createdAt);

      if (threadRef === null) {
        return {
          failure: {
            kind: "provider",
            reason: "The bot has no model to start a chat with.",
            nextAction: "Pick a model for the bot, then resume the routine.",
          },
        } as const;
      }

      const bot = yield* bots.getById({ botId: routine.botId });

      if (Option.isSome(bot)) {
        yield* botUsageLedger
          .recordMeasurement({
            reservationId: OttoUsageReservationId.make(`routine:${run.id}`),
            sourceKey: `routine:${run.id}`,
            botId: routine.botId,
            threadId: threadRef,
            turnId: null,
            category: "routine",
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: null,
            provider: null,
            model: bot.value.engine?.model ?? null,
            createdAt,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to record routine usage", {
                routineId: routine.id,
                runId: run.id,
                cause,
              }),
            ),
          );
      }

      const started = yield* startRun(routine, run, threadRef);

      if (started === "ended") return { canceled: true } satisfies RoutineDispatchResult;

      if (started !== "started") return started;
      yield* dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:routine.turn:${run.id}`),
        threadId: threadRef,
        message: {
          messageId: MessageId.make(`routine:${run.id}:message`),
          role: "user",
          text: routineTask(routine.procedure),
          attachments: [],
        },
        runtimeMode: routine.approvalPolicy,
        interactionMode: "default",
        createdAt,
      });

      return { threadRef };
    }).pipe(Effect.orDie);

  return {
    checkDependencies,
    isTargetBusy,
    recordQueued,
    recordBlocked,
    recordCompleted,
    recordFailed,
    recordCanceled,
    cancelDelegatedRun,
    findDelegatedRunDelegation,
    openFailureIncident,
    resolveFailureIncident,
    dispatchTurn,
  } satisfies RoutineRuntimeAdapterShape;
});

export const RoutineRuntimeAdapterLive = Layer.effect(RoutineRuntimeAdapter, make);

const DelegationDispatch = Data.taggedEnum<OttoDelegationDispatch>();
