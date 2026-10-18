import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@otto/contracts";

export const NOW = "2026-01-01T00:00:00.000Z";

export function makeReadModel(
  archivedAt: string | null = null,
  session: OrchestrationSession | null = null,
  activities: OrchestrationThread["activities"] = [],
  messages: OrchestrationThread["messages"] = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    bots: [],
    groups: [],
    delegations: [],
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt,
        deletedAt: null,
        messages,
        proposedPlans: [],
        activities,
        checkpoints: [],
        session,
      },
    ],
    updatedAt: NOW,
  };
}

export function createSession(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "Codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}
