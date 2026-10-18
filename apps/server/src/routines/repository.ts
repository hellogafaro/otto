import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { PersistenceSqlError } from "../persistence/errors.ts";
import type {
  AuthSessionId,
  RoutineListResult,
  RoutineListView,
  RoutineSkillAssignment,
  ThreadId,
} from "@otto/contracts";
import type {
  Routine,
  RoutineAppEvent,
  RoutineId,
  RoutineRun,
  RoutineRunId,
  RoutineRunTrigger,
} from "./types.ts";

interface RoutineClaimBase {
  readonly runId: RoutineRunId;
  readonly routineId: RoutineId;
  readonly claimedAt: string;
  readonly status?: "claimed" | "dispatched";
  readonly threadRef?: string | null;
  readonly terminalState?: "completed" | "error" | "interrupted" | null;
  readonly terminalAt?: string | null;
  readonly sessionState?:
    | "ready"
    | "starting"
    | "running"
    | "error"
    | "interrupted"
    | "stopped"
    | null;
  readonly sessionUpdatedAt?: string | null;
  /** The app event an `app` run starts with. */
  readonly event?: RoutineAppEvent | null;
}

export type RoutineClaim = RoutineClaimBase &
  (
    | {
        readonly trigger: Extract<RoutineRunTrigger, "dry-run" | "manual" | "app">;
        readonly scheduledFor: null;
      }
    | {
        readonly trigger: Extract<RoutineRunTrigger, "scheduled" | "missed">;
        readonly scheduledFor: string;
      }
  );

/** A row's sort key: the values of its sort expressions, the routine id last. */
export type RoutineListKey = ReadonlyArray<string | number>;

export interface RoutineRepositoryShape {
  readonly listAll: Effect.Effect<ReadonlyArray<Routine>, PersistenceSqlError>;
  /**
   * One page of the routines `viewer` may see that match the filter, in its order and strictly
   * after `after`, with one row more than the limit when another page follows, and the
   * filter's status counts.
   */
  readonly list: (input: {
    readonly query: RoutineListView;
    readonly viewer: AuthSessionId;
    readonly limit: number;
    readonly after: RoutineListKey | null;
  }) => Effect.Effect<
    {
      readonly rows: ReadonlyArray<{ readonly routine: Routine; readonly key: RoutineListKey }>;
      readonly statusCounts: RoutineListResult["statusCounts"];
    },
    PersistenceSqlError
  >;
  readonly listEnabled: Effect.Effect<ReadonlyArray<Routine>, PersistenceSqlError>;
  readonly getById: (routineId: RoutineId) => Effect.Effect<Routine | null, PersistenceSqlError>;
  readonly listRuns: (
    routineId: RoutineId,
  ) => Effect.Effect<ReadonlyArray<RoutineRun>, PersistenceSqlError>;
  readonly listThreadRuns: (
    threadId: ThreadId,
    beforeRunId?: RoutineRunId,
  ) => Effect.Effect<
    { readonly runs: ReadonlyArray<RoutineRun>; readonly nextCursor: RoutineRunId | null },
    PersistenceSqlError
  >;
  /** Each routine's 5 newest runs and every run still open. */
  readonly listAllRuns: Effect.Effect<ReadonlyArray<RoutineRun>, PersistenceSqlError>;
  /** The chat of the routine's newest run that has one. */
  readonly getLatestThreadRef: (
    routineId: RoutineId,
  ) => Effect.Effect<ThreadId | null, PersistenceSqlError>;
  readonly getActiveRunByThreadRef: (
    threadRef: string,
    turnId?: string | null,
  ) => Effect.Effect<RoutineRun | null, PersistenceSqlError>;
  readonly listSkillAssignments: Effect.Effect<
    ReadonlyArray<RoutineSkillAssignment>,
    PersistenceSqlError
  >;
  readonly claim: (claim: RoutineClaim) => Effect.Effect<boolean, PersistenceSqlError>;
  readonly markDispatched: (
    runId: RoutineRunId,
    threadId: string,
  ) => Effect.Effect<void, PersistenceSqlError>;
  readonly markBlocked: (
    runId: RoutineRunId,
    failure: string,
    completedAt: string,
  ) => Effect.Effect<void, PersistenceSqlError>;
  readonly markSettled: (
    runId: RoutineRunId,
    status: "completed" | "failed" | "canceled",
    completedAt: string,
  ) => Effect.Effect<void, PersistenceSqlError>;
  readonly listRecoverable: Effect.Effect<ReadonlyArray<RoutineClaim>, PersistenceSqlError>;
}

export class RoutineRepository extends Context.Service<RoutineRepository, RoutineRepositoryShape>()(
  "@otto/server/routines/repository/RoutineRepository",
) {}
