import { CommandId, EventId, ThreadId, TurnId } from "@otto/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as CheckpointStore from "../../../checkpointing/checkpoint-store.ts";
import { AgentController } from "../../../provider/services/agent-controller.ts";
import { OrchestrationEngineService } from "../../services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../../services/projection-snapshot-query.ts";
import { RuntimeReceiptBus } from "../../services/runtime-receipt-bus.ts";
import * as GitVcsDriver from "../../../vcs/git-vcs-driver.ts";
import * as WorkspaceEntries from "../../../workspace/workspace-entries.ts";

export const createDependencies = Effect.fn("makecheckpoint-reactor-Dependencies")(function* () {
  const crypto = yield* Crypto.Crypto;

  const randomUUID = crypto.randomUUIDv4;

  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));

  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const orchestrationEngine = yield* OrchestrationEngineService;

  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const agentController = yield* AgentController;

  const checkpointStore = yield* CheckpointStore.CheckpointStore;

  const receiptBus = yield* RuntimeReceiptBus;

  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const git = yield* GitVcsDriver.GitVcsDriver;

  const startedTurns = new Map<ThreadId, TurnId>();

  const pending = new Set<ThreadId>();

  return {
    crypto,
    randomUUID,
    serverEventId,
    serverCommandId,
    orchestrationEngine,
    projectionSnapshotQuery,
    agentController,
    checkpointStore,
    receiptBus,
    workspaceEntries,
    git,
    startedTurns,
    pending,
  };
});
