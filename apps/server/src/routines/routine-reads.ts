import {
  type AuthSessionId,
  type RoutineGetInput,
  RoutineReadError,
  type RoutineListThreadRunsInput,
  type RoutineListThreadRunsResult,
  RoutineThreadReadError,
} from "@otto/contracts";
import * as Effect from "effect/Effect";

import { canSeeRoutine } from "../orchestration/group-visibility.ts";
import { deletedRoutineReceiptSources } from "../orchestration/routine-receipt-sources.ts";
import type { RoutineRepository } from "./repository.ts";

/**
 * Otto: One routine the viewer may see, by the same rule as the list. A deleted routine, or
 * someone else's private one, reads as missing, so a refusal never confirms it exists.
 */
export const getRoutine = (
  input: RoutineGetInput,
  viewer: AuthSessionId,
  routineRepository: Pick<RoutineRepository["Service"], "getById">,
) =>
  routineRepository.getById(input.routineId).pipe(
    Effect.map((routine) =>
      routine !== null &&
      routine.deletedAt === null &&
      routine.lifecycle !== "deleted" &&
      canSeeRoutine(routine, viewer)
        ? routine
        : null,
    ),
    Effect.mapError(
      (cause) => new RoutineReadError({ routineId: input.routineId, message: cause.message }),
    ),
  );

/**
 * One page of a chat's routine runs with the routines posting there: the live ones the viewer
 * may see, and every deleted one as its receipt, as the chat's notes show them.
 */
export const listThreadRoutineRuns = (
  input: RoutineListThreadRunsInput,
  viewer: AuthSessionId,
  routineRepository: Pick<RoutineRepository["Service"], "listThreadRuns" | "listThreadRoutines">,
): Effect.Effect<RoutineListThreadRunsResult, RoutineThreadReadError> =>
  Effect.all([
    routineRepository.listThreadRuns(input.threadId, viewer, input.beforeRunId),
    routineRepository.listThreadRoutines(input.threadId),
  ]).pipe(
    Effect.map(([page, routines]) => ({
      ...page,
      routines: routines.filter(
        (routine) => routine.deletedAt === null && canSeeRoutine(routine, viewer),
      ),
      receiptSources: deletedRoutineReceiptSources(routines),
    })),
    Effect.mapError(
      (cause) => new RoutineThreadReadError({ threadId: input.threadId, message: cause.message }),
    ),
  );
