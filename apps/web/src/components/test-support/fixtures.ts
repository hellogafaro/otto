import {
  OrchestrationThreadShell,
  OrchestrationBot,
  OrchestrationShellSnapshot,
  Routine,
  RoutineRun,
  ServerProvider,
} from "@otto/contracts";
import { Schema } from "effect";

export const decodeRoutine = Schema.decodeUnknownSync(Routine);

export const decodeRoutineRun = Schema.decodeUnknownSync(RoutineRun);

export const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);

type ShellFixture = Omit<Partial<typeof OrchestrationShellSnapshot.Encoded>, "threads" | "bots"> & {
  bots?: ReadonlyArray<Partial<typeof OrchestrationBot.Encoded>> | undefined;
  threads?: ReadonlyArray<Partial<typeof OrchestrationThreadShell.Encoded>> | undefined;
};

export function makeShellSnapshot(overrides: ShellFixture) {
  return decodeSnapshot({
    snapshotSequence: 0,
    projects: [],
    groups: [],
    delegations: [],
    updatedAt: "2026-09-29T09:00:00.000Z",
    ...overrides,
    bots: (overrides.bots ?? []).map((bot) => ({
      title: "Fixture teammate",
      avatar: { kind: "blob", shape: "circle", color: "#2E8EFF" },
      engine: null,
      sandbox: "local",
      groupId: null,
      archivedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-29T09:00:00.000Z",
      ...bot,
    })),
    threads: (overrides.threads ?? []).map((thread) => ({
      id: "thread-1",
      projectId: "project-1",
      title: "Fixture chat",
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-29T09:00:00.000Z",
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      ...thread,
    })),
  });
}

export type RuntimeThreadFixture = Omit<
  Partial<typeof OrchestrationThreadShell.Encoded>,
  "latestTurn" | "session"
> & {
  environmentId?: string;
  latestTurn?: Partial<NonNullable<(typeof OrchestrationThreadShell.Encoded)["latestTurn"]>> | null;
  session?: Partial<NonNullable<(typeof OrchestrationThreadShell.Encoded)["session"]>> | null;
};

export type RuntimeProjectFixture = Partial<
  typeof import("@otto/contracts").OrchestrationProject.Encoded
> & { environmentId?: string };
