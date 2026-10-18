import { ProjectionTaskRepository } from "../../persistence/services/projection-tasks.ts";
import { ProjectionTaskRepositoryLive } from "../../persistence/layers/projection-tasks.ts";
import { ProjectionLibraryRepositoryLive } from "../../persistence/layers/projection-library.ts";
import { ProjectionLibraryRepository } from "../../persistence/services/projection-library.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectionMcpServerRepository } from "../../persistence/services/projection-mcp-servers.ts";
import { ProjectionMcpServerRepositoryLive } from "../../persistence/layers/projection-mcp-servers.ts";
import { RoutineRepository } from "../../routines/repository.ts";
import { RoutineRepositoryLive } from "../../routines/repository-live.ts";
import { ThreadBackgroundLivenessService } from "../thread-background-liveness.ts";
import { ThreadPlanProgressService } from "../thread-plan-progress.ts";
import { ProjectionThreadMessageRepository } from "../../persistence/services/projection-thread-messages.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/layers/projection-thread-messages.ts";
import * as RepositoryIdentityResolver from "../../project/repository-identity-resolver.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../services/projection-snapshot-query.ts";
import { createEnvironmentRows } from "./snapshot-query/environment-rows.ts";
import { createThreadRows } from "./snapshot-query/thread-rows.ts";
import { createThreadHistoryRows } from "./snapshot-query/thread-history-rows.ts";
import { createProjectIdentity } from "./snapshot-query/project-identity.ts";
import { createReadModels } from "./snapshot-query/read-models.ts";
import { createShellSnapshots } from "./snapshot-query/shell-snapshots.ts";
import { createLookups } from "./snapshot-query/lookups.ts";
import { createThreadDetail } from "./snapshot-query/thread-detail.ts";
import { createCommandContext } from "./snapshot-query/command-context.ts";

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const projectionMcpServerRepository = yield* ProjectionMcpServerRepository;
  const projectionTaskRepository = yield* ProjectionTaskRepository;
  const projectionLibraryRepository = yield* ProjectionLibraryRepository;
  const routineRepository = yield* RoutineRepository;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const threadPlanProgress = yield* ThreadPlanProgressService;
  const sql = yield* SqlClient.SqlClient;
  const commandMessageRepository = yield* ProjectionThreadMessageRepository;
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;

  const {
    listProjectRows,
    listBotRows,
    listGroupRows,
    listDelegationRows,
    listShellDelegationRows,
    getBotRowById,
    getGroupRowById,
    listDelegationRowsByThread,
    getLatestAssistantMessageRowForTurn,
    listThreadRows,
    listActiveThreadRows,
    listArchivedThreadRows,
    listThreadMessageRows,
    listThreadProposedPlanRows,
    listThreadActivityRows,
    listThreadSessionRows,
    listActiveThreadSessionRows,
    listArchivedThreadSessionRows,
    listCheckpointRows,
    listLatestTurnRows,
    listPendingTurnStartRows,
    getTurnStartFailureRow,
    listActiveLatestTurnRows,
    listArchivedLatestTurnRows,
    listProjectionStateRows,
  } = createEnvironmentRows({ sql });

  const {
    readProjectionCounts,
    readEventReplayStats,
    searchActiveThreadRows,
    getActiveProjectRowByWorkspaceRoot,
    getOriginalProjectIdRowByWorkspaceRoot,
    getActiveProjectRowById,
    getFirstActiveThreadIdByProject,
    getThreadCheckpointContextThreadRow,
    getThreadRowById,
    listThreadMessageRowsByThread,
    listThreadProposedPlanRowsByThread,
    getThreadRuntimeContextRow,
    getTurnStartMessageRow,
    getThreadSessionRowByThread,
    getLatestTurnRowByThread,
    listCheckpointRowsByThread,
    getFullThreadDiffContextRow,
    getLatestUserCommandMessage,
  } = createThreadRows({ sql });

  const {
    listThreadActivityRowsByThread,
    listThreadActivityIdsByThread,
    listThreadActivityRowsByIds,
    listThreadActivityRowsByThreadAndKinds,
    getThreadEventWatermarkRow,
    listTurnWindowRows,
    listThreadMessageRowsByThreadWindow,
    listPinnedThreadActivityRowsByThread,
    listPinnedThreadActivityIdsByThread,
    listThreadActivityRowsByThreadWindow,
    listThreadActivityIdsByThreadWindow,
  } = createThreadHistoryRows({ sql });

  const { resolveRepositoryIdentitiesForProjects } = createProjectIdentity({
    repositoryIdentityResolver,
  });

  const { getSnapshot, getCommandReadModel } = createReadModels({
    sql,
    listProjectRows,
    listBotRows,
    listGroupRows,
    listDelegationRows,
    projectionMcpServerRepository,
    projectionTaskRepository,
    projectionLibraryRepository,
    routineRepository,
    listThreadRows,
    listThreadMessageRows,
    listThreadProposedPlanRows,
    listThreadActivityRows,
    listThreadSessionRows,
    listCheckpointRows,
    listLatestTurnRows,
    listProjectionStateRows,
    resolveRepositoryIdentitiesForProjects,
  });

  const { getShellSnapshot, getArchivedShellSnapshot } = createShellSnapshots({
    sql,
    listProjectRows,
    listBotRows,
    listGroupRows,
    listShellDelegationRows,
    projectionMcpServerRepository,
    listActiveThreadRows,
    listActiveThreadSessionRows,
    listActiveLatestTurnRows,
    listProjectionStateRows,
    resolveRepositoryIdentitiesForProjects,
    threadBackgroundLiveness,
    threadPlanProgress,
    listArchivedThreadRows,
    listArchivedThreadSessionRows,
    listArchivedLatestTurnRows,
  });

  const {
    getSnapshotSequence,
    getCounts,
    getEventReplayStats,
    searchThreads,
    getActiveProjectByWorkspaceRoot,
    getOriginalProjectIdByWorkspaceRoot,
    getProjectShellById,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadRuntimeContext,
    getBotById,
    getGroupById,
    listThreadDelegations,
    getLatestAssistantMessageIdForTurn,
    getTurnStartMessage,
    listPendingTurnStarts,
    hasTurnStartFailure,
  } = createLookups({
    listProjectionStateRows,
    readProjectionCounts,
    readEventReplayStats,
    searchActiveThreadRows,
    getActiveProjectRowByWorkspaceRoot,
    repositoryIdentityResolver,
    getOriginalProjectIdRowByWorkspaceRoot,
    getActiveProjectRowById,
    getFirstActiveThreadIdByProject,
    getThreadCheckpointContextThreadRow,
    listCheckpointRowsByThread,
    getFullThreadDiffContextRow,
    getThreadRowById,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    threadBackgroundLiveness,
    threadPlanProgress,
    getThreadRuntimeContextRow,
    getBotRowById,
    getGroupRowById,
    listDelegationRowsByThread,
    getLatestAssistantMessageRowForTurn,
    getTurnStartMessageRow,
    listPendingTurnStartRows,
    getTurnStartFailureRow,
  });

  const { getThreadDetailById, getThreadDetailSnapshot } = createThreadDetail({
    listThreadActivityIdsByThread,
    listThreadActivityIdsByThreadWindow,
    listPinnedThreadActivityIdsByThread,
    listThreadActivityRowsByIds,
    listThreadActivityRowsByThread,
    listThreadActivityRowsByThreadWindow,
    listThreadActivityRowsByThreadAndKinds,
    listPinnedThreadActivityRowsByThread,
    getThreadRowById,
    listThreadMessageRowsByThread,
    listThreadMessageRowsByThreadWindow,
    listThreadProposedPlanRowsByThread,
    listCheckpointRowsByThread,
    getLatestTurnRowByThread,
    getThreadSessionRowByThread,
    sql,
    getSnapshotSequence,
    listTurnWindowRows,
    getThreadEventWatermarkRow,
  });

  const { getThreadCommandContext, getCommandMessage } = createCommandContext({
    sql,
    getLatestUserCommandMessage,
    listPinnedThreadActivityRowsByThread,
    commandMessageRepository,
  });

  return {
    getThreadCommandContext,
    getCommandMessage,
    getCommandReadModel,
    getSnapshot,
    getShellSnapshot,
    getArchivedShellSnapshot,
    searchThreads,
    getSnapshotSequence,
    getCounts,
    getEventReplayStats,
    getActiveProjectByWorkspaceRoot,
    getOriginalProjectIdByWorkspaceRoot,
    getProjectShellById,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadRuntimeContext,
    getBotById,
    getGroupById,
    listThreadDelegations,
    getLatestAssistantMessageIdForTurn,
    getTurnStartMessage,
    listPendingTurnStarts,
    hasTurnStartFailure,
    getThreadDetailById,
    getThreadDetailSnapshot,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
).pipe(
  Layer.provideMerge(ProjectionMcpServerRepositoryLive),
  Layer.provideMerge(ProjectionTaskRepositoryLive),
  Layer.provideMerge(ProjectionLibraryRepositoryLive),
  Layer.provideMerge(RoutineRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
);
