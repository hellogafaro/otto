import { CheckpointRef, MessageId, ProjectId, TurnId } from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Metric from "effect/Metric";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/layers/orchestration-event-store.ts";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/repository-identity-resolver.ts";
import { OrchestrationEngineLive } from "../orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "../../thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../thread-plan-progress.ts";
import { OrchestrationEngineService } from "../../services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../../services/projection-snapshot-query.ts";
import { ServerConfig } from "../../../config.ts";

export const asProjectId = (value: string): ProjectId => ProjectId.make(value);

export const asMessageId = (value: string): MessageId => MessageId.make(value);

export const asTurnId = (value: string): TurnId => TurnId.make(value);

export const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.make(value);

export async function createOrchestrationSystem() {
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "ottoLegacy-orchestration-engine-test-",
  });

  const orchestrationLayer = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));

  return {
    engine,
    snapshotQuery,
    readModel: () => runtime.runPromise(snapshotQuery.getSnapshot()),
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

export function now() {
  return "2026-01-01T00:00:00.000Z";
}

export const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
) =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );
