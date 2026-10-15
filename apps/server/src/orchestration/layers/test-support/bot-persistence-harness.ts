import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { ServerConfig } from "../../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/layers/orchestration-event-store.ts";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/repository-identity-resolver.ts";
import * as ThreadBackgroundLiveness from "../../thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../thread-plan-progress.ts";
import { OrchestrationEngineLive } from "../orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../projection-snapshot-query.ts";

export const TestLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provideMerge(OrchestrationProjectionPipelineLive),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "ottoLegacy-bot-persistence-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);
