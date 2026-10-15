import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AgentController } from "../../../provider/services/agent-controller.ts";
import { ProjectionTurnRepository } from "../../../persistence/services/projection-turns.ts";
import * as CheckpointStore from "../../../checkpointing/checkpoint-store.ts";
import { ProjectionThreadActivityRepository } from "../../../persistence/services/projection-thread-activities.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/services/projection-thread-messages.ts";
import { ProjectionThreadProposedPlanRepository } from "../../../persistence/services/projection-thread-proposed-plans.ts";
import { OrchestrationEngineService } from "../../services/orchestration-engine.ts";
import { ThreadBackgroundLivenessService } from "../../thread-background-liveness.ts";
import { ThreadPlanProgressService } from "../../thread-plan-progress.ts";
import { ProjectionSnapshotQuery } from "../../services/projection-snapshot-query.ts";
import { ServerSettingsService } from "../../../server-settings.ts";
import { ServerConfig } from "../../../config.ts";
import { BotInboxService } from "../../../bot-inbox/service.ts";
import { BotUsageLedger } from "../../../usage/bot-usage-ledger.ts";
import * as ChannelRuntime from "../../../channels/channel-runtime.ts";

export const createDependencies = Effect.fn("makeRuntimeDependencies")(function* () {
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;

  const threadPlanProgress = yield* ThreadPlanProgressService;

  const crypto = yield* Crypto.Crypto;

  const orchestrationEngine = yield* OrchestrationEngineService;

  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const agentController = yield* AgentController;

  const checkpointStore = yield* CheckpointStore.CheckpointStore;

  const projectionTurnRepository = yield* ProjectionTurnRepository;

  const projectionThreadMessages = yield* ProjectionThreadMessageRepository;

  const projectionThreadActivities = yield* ProjectionThreadActivityRepository;

  const projectionThreadProposedPlans = yield* ProjectionThreadProposedPlanRepository;

  const botUsageLedger = yield* BotUsageLedger;

  const serverSettingsService = yield* ServerSettingsService;

  const channelRuntime = Option.getOrNull(
    yield* Effect.serviceOption(ChannelRuntime.ChannelRuntime),
  );

  const serverConfig = yield* ServerConfig;

  const botInbox = BotInboxService.forSecretsDir(serverConfig.secretsDir);

  return {
    threadBackgroundLiveness,
    threadPlanProgress,
    crypto,
    orchestrationEngine,
    projectionSnapshotQuery,
    agentController,
    checkpointStore,
    projectionTurnRepository,
    projectionThreadMessages,
    projectionThreadActivities,
    projectionThreadProposedPlans,
    botUsageLedger,
    serverSettingsService,
    channelRuntime,
    serverConfig,
    botInbox,
  };
});
