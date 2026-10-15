import * as Predicate from "effect/Predicate";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/layers/orchestration-event-store.ts";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/repository-identity-resolver.ts";
import { OrchestrationEngineLive } from "../orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "../../thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../thread-plan-progress.ts";
import { ServerConfig } from "../../../config.ts";

export const makeProjectionPipelinePrefixedTestLayer = (prefix: string) =>
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

export const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath));

    return Predicate.isTagged(fileInfo, "Success");
  });

export const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer(
  "ottoLegacy-projection-pipeline-test-",
);

export const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "ottoLegacy-projection-pipeline-engine-dispatch-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);
