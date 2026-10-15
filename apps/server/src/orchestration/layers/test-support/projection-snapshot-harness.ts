import {
  OttoDelegationRecord,
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  TurnId,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../../../project/repository-identity-resolver.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "../../thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../thread-plan-progress.ts";

export const asProjectId = (value: string): ProjectId => ProjectId.make(value);

export const asTurnId = (value: string): TurnId => TurnId.make(value);

export const asMessageId = (value: string): MessageId => MessageId.make(value);

export const asEventId = (value: string): EventId => EventId.make(value);

export const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.make(value);

export const decodeDelegationRecord = Schema.decodeUnknownEffect(OttoDelegationRecord);

export const encodeDelegationRecordJson = Schema.encodeEffect(
  Schema.fromJsonString(OttoDelegationRecord),
);

export const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);
