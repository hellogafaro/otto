import * as Layer from "effect/Layer";

import { ActivityStoreLive } from "../activity/activity-store.ts";
import { NotificationStoreLive } from "../notifications/notification-store.ts";
import { ChannelDeliveryStoreLive } from "../channels/channel-delivery-store.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/layers/orchestration-event-store.ts";
import { ProjectionBotRepositoryLive } from "../persistence/layers/projection-bots.ts";
import { ProjectionGroupRepositoryLive } from "../persistence/layers/projection-groups.ts";
import { ProjectionLibraryRepositoryLive } from "../persistence/layers/projection-library.ts";
import { BotUsageLedgerLive } from "../usage/bot-usage-ledger.ts";
import { OrchestrationEngineLive } from "./layers/orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "./layers/projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./layers/projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "./thread-background-liveness.ts";
import * as ThreadPlanProgress from "./thread-plan-progress.ts";

export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

export const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

export const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
  ProjectionBotRepositoryLive,
  ProjectionGroupRepositoryLive,
  ProjectionLibraryRepositoryLive,
  ActivityStoreLive,
  NotificationStoreLive,
  BotUsageLedgerLive,
  ChannelDeliveryStoreLive,
  // Shared background-liveness and plan-progress registries: written by
  // runtime ingestion, read by the snapshot query. provideMerge feeds the
  // same instance to the snapshot query here and re-exports it for runtime
  // ingestion.
).pipe(
  Layer.provideMerge(ThreadBackgroundLiveness.layer),
  Layer.provideMerge(ThreadPlanProgress.layer),
);

export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
);
