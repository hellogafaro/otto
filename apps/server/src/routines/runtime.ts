import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { PersistenceSqlError } from "../persistence/errors.ts";
import type {
  RoutineAppEvent,
  RoutineId,
  RoutineRun,
  RoutineRunId,
  RoutineRunTrigger,
} from "./types.ts";

export interface RoutineRuntimeShape {
  readonly runDue: Effect.Effect<void, never>;
  readonly canRunNow: (routineId: RoutineId) => Effect.Effect<boolean, PersistenceSqlError>;
  readonly runNow: (
    routineId: RoutineId,
    runId: RoutineRunId,
    trigger: Extract<RoutineRunTrigger, "dry-run" | "manual">,
  ) => Effect.Effect<RoutineRun | null, PersistenceSqlError>;
  /**
   * Starts an enabled app routine's run for one app event. The same event, retried, never
   * starts a second run; a run the routine's chat is too busy for starts once it is free.
   */
  readonly runEvent: (
    routineId: RoutineId,
    event: RoutineAppEvent,
  ) => Effect.Effect<void, PersistenceSqlError>;
  readonly recover: Effect.Effect<void, never>;
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class RoutineRuntime extends Context.Service<RoutineRuntime, RoutineRuntimeShape>()(
  "@otto/server/routines/runtime/RoutineRuntime",
) {}
