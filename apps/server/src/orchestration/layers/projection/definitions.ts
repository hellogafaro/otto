import { asRecord } from "../../activity-payload-bounds.ts";
import * as Predicate from "effect/Predicate";
import {
  ApprovalRequestId,
  McpServerId,
  RoutineRunFailure,
  RoutineRunResult,
  RoutineSchedule,
  RoutineTrigger,
  SkillAssignmentId,
  type OrchestrationEvent,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { type ProjectionRepositoryError } from "../../../persistence/errors.ts";
import { OrchestrationEventStore } from "../../../persistence/services/orchestration-event-store.ts";
import { ProjectionBotRepository } from "../../../persistence/services/projection-bots.ts";
import { ProjectionGroupRepository } from "../../../persistence/services/projection-groups.ts";
import { ProjectionPendingApprovalRepository } from "../../../persistence/services/projection-pending-approvals.ts";
import { ProjectionMcpServerRepository } from "../../../persistence/services/projection-mcp-servers.ts";
import { ProjectionTaskRepository } from "../../../persistence/services/projection-tasks.ts";
import { ProjectionLibraryRepository } from "../../../persistence/services/projection-library.ts";
import { ProjectionProjectRepository } from "../../../persistence/services/projection-projects.ts";
import { ProjectionStateRepository } from "../../../persistence/services/projection-state.ts";
import { ProjectionThreadActivityRepository } from "../../../persistence/services/projection-thread-activities.ts";
import { type ProjectionThreadActivity } from "../../../persistence/services/projection-thread-activities.ts";
import { ProjectionThreadMessageRepository } from "../../../persistence/services/projection-thread-messages.ts";
import {
  type ProjectionThreadProposedPlan,
  ProjectionThreadProposedPlanRepository,
} from "../../../persistence/services/projection-thread-proposed-plans.ts";
import { ProjectionThreadSessionRepository } from "../../../persistence/services/projection-thread-sessions.ts";
import {
  type ProjectionTurn,
  ProjectionTurnRepository,
} from "../../../persistence/services/projection-turns.ts";
import { ProjectionThreadRepository } from "../../../persistence/services/projection-threads.ts";
import { ServerConfig } from "../../../config.ts";

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  bots: "projection.bots",
  groups: "projection.groups",
  delegations: "projection.delegations",
  mcpServers: "projection.mcp-servers",
  tasks: "projection.tasks",
  activity: "projection.activity",
  library: "projection.library",
  routines: "projection.routines",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
} as const;

export type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES];

export const encodeRoutineSchedule = Schema.encodeSync(Schema.fromJsonString(RoutineSchedule));

export const encodeRoutineTrigger = Schema.encodeSync(Schema.fromJsonString(RoutineTrigger));

export const encodeSkillAssignmentIds = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(SkillAssignmentId)),
);

export const encodeMcpServerIds = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(McpServerId)),
);

export const encodeRoutineResult = Schema.encodeSync(Schema.fromJsonString(RoutineRunResult));

export const encodeRoutineFailure = Schema.encodeSync(Schema.fromJsonString(RoutineRunFailure));

export const projectorEventTypes = (
  types: ReadonlyArray<OrchestrationEvent["type"]>,
): ReadonlySet<OrchestrationEvent["type"]> => new Set(types);

export interface ProjectorDefinition {
  readonly name: ProjectorName;
  /**
   * Event types `apply` acts on. The live pipeline skips `apply` for other
   * types but still advances this projector's cursor. Omit to receive every
   * event. Keep in sync with the cases handled by `apply`.
   */
  readonly eventTypes?: ReadonlySet<OrchestrationEvent["type"]>;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>;
  readonly prunedThreadRelativePaths: Map<string, Set<string>>;
}

export function extractActivityRequestId(
  payload: Extract<
    OrchestrationEvent,
    { type: "thread.activity-appended" }
  >["payload"]["activity"]["payload"],
): ApprovalRequestId | null {
  const requestId = asRecord(payload)?.requestId;

  return Predicate.isString(requestId) ? ApprovalRequestId.make(requestId) : null;
}

export function isStalePendingApprovalFailureDetail(detail: string | null): boolean {
  if (detail === null) {
    return false;
  }

  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request")
  );
}

export // A refresh reads each persisted summary source, so skip activities that cannot change the result.
function shouldRefreshThreadShellSummary(event: OrchestrationEvent): boolean {
  if (event.type !== "thread.activity-appended") {
    return true;
  }

  switch (event.payload.activity.kind) {
    case "approval.requested":
    case "approval.resolved":
    case "provider.approval.respond.failed":
    case "user-input.requested":
    case "user-input.resolved":
    case "provider.user-input.respond.failed":
      return true;
    default:
      return false;
  }
}

export function derivePendingUserInputCountFromActivities(
  activities: ReadonlyArray<ProjectionThreadActivity>,
): number {
  const openRequestIds = new Set<string>();

  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.activityId.localeCompare(right.activityId),
  );

  for (const activity of ordered) {
    const requestId = extractActivityRequestId(activity.payload);

    if (requestId === null) {
      continue;
    }

    const payload = asRecord(activity.payload);

    const detail = Predicate.isString(payload?.detail) ? payload.detail.toLowerCase() : null;

    if (activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      detail !== null &&
      (detail.includes("stale pending user-input request") ||
        detail.includes("unknown pending user-input request") ||
        detail.includes("unknown pending user input request") ||
        detail.includes("unknown pending codex user input request"))
    ) {
      openRequestIds.delete(requestId);
    }
  }

  return openRequestIds.size;
}

export function retainProjectionActivitiesAfterRevert(
  activities: ReadonlyArray<ProjectionThreadActivity>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadActivity> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );

  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function retainProjectionProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan>,
  turns: ReadonlyArray<ProjectionTurn>,
  turnCount: number,
): ReadonlyArray<ProjectionThreadProposedPlan> {
  const retainedTurnIds = new Set<string>(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );

  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

export interface ProjectionDependencies {
  readonly sql: SqlClient.SqlClient;
  readonly eventStore: OrchestrationEventStore["Service"];
  readonly projectionStateRepository: ProjectionStateRepository["Service"];
  readonly projectionProjectRepository: ProjectionProjectRepository["Service"];
  readonly projectionBotRepository: ProjectionBotRepository["Service"];
  readonly projectionGroupRepository: ProjectionGroupRepository["Service"];
  readonly projectionMcpServerRepository: ProjectionMcpServerRepository["Service"];
  readonly projectionTaskRepository: ProjectionTaskRepository["Service"];
  readonly projectionLibraryRepository: ProjectionLibraryRepository["Service"];
  readonly projectionThreadRepository: ProjectionThreadRepository["Service"];
  readonly projectionThreadMessageRepository: ProjectionThreadMessageRepository["Service"];
  readonly projectionThreadProposedPlanRepository: ProjectionThreadProposedPlanRepository["Service"];
  readonly projectionThreadActivityRepository: ProjectionThreadActivityRepository["Service"];
  readonly projectionThreadSessionRepository: ProjectionThreadSessionRepository["Service"];
  readonly projectionTurnRepository: ProjectionTurnRepository["Service"];
  readonly projectionPendingApprovalRepository: ProjectionPendingApprovalRepository["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly serverConfig: ServerConfig["Service"];
}
