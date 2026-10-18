import type {
  EnvironmentId,
  OrchestrationShellStreamItem,
  Routine,
  RoutineReceiptSource,
  RoutineRun,
} from "@otto/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

/**
 * Otto: The routines an environment's screens have read, by id, with the runs and deleted-routine
 * receipts the shell stream has sent since. The startup snapshot carries none of them: `get` and
 * `list` results fill it and each routine event updates it.
 */
export interface RoutineCache {
  readonly routines: ReadonlyMap<string, Routine>;
  readonly runs: ReadonlyMap<string, RoutineRun>;
  readonly receiptSources: ReadonlyMap<string, RoutineReceiptSource>;
}

export const EMPTY_ROUTINE_CACHE: RoutineCache = {
  routines: new Map(),
  runs: new Map(),
  receiptSources: new Map(),
};

export const routineCacheAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(EMPTY_ROUTINE_CACHE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:routines:cache:${environmentId}`),
  ),
);

/** Counts every routine event and fresh snapshot, so lists know to load again. */
export const routineChangesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel(`environment-data:routines:changes:${environmentId}`),
  ),
);

/**
 * Adds what a read returned, keeping a routine an event already brought newer. A deleted
 * routine's receipt replaces the routine.
 */
export function withRoutines(
  cache: RoutineCache,
  routines: ReadonlyArray<Routine>,
  receiptSources: ReadonlyArray<RoutineReceiptSource> = [],
): RoutineCache {
  const fresh = routines.filter(
    (routine) => (cache.routines.get(routine.id)?.updatedAt ?? "") <= routine.updatedAt,
  );

  const sources = receiptSources.filter((source) => !cache.receiptSources.has(source.id));

  if (
    sources.length === 0 &&
    fresh.every((routine) => cache.routines.get(routine.id) === routine) &&
    receiptSources.every((source) => !cache.routines.has(source.id))
  ) {
    return cache;
  }

  const next = new Map([
    ...cache.routines,
    ...fresh.map((routine) => [routine.id, routine] as const),
  ]);

  for (const source of receiptSources) next.delete(source.id);

  return {
    ...cache,
    routines: next,
    receiptSources: new Map([
      ...cache.receiptSources,
      ...sources.map((source) => [source.id, source] as const),
    ]),
  };
}

export function applyRoutineEvent(
  cache: RoutineCache,
  item: OrchestrationShellStreamItem,
): RoutineCache {
  switch (item.kind) {
    case "routine-upserted":
      return {
        ...cache,
        routines: new Map(cache.routines).set(item.routine.id, item.routine),
        runs: item.run ? new Map(cache.runs).set(item.run.id, item.run) : cache.runs,
      };
    case "routine-removed": {
      const routines = new Map(cache.routines);
      routines.delete(item.routineId);

      // Otto: A deleted routine keeps its runs and becomes a receipt; one hidden from this
      // person takes its runs with it.
      return item.receiptSource
        ? {
            ...cache,
            routines,
            receiptSources: new Map(cache.receiptSources).set(item.routineId, item.receiptSource),
          }
        : {
            ...cache,
            routines,
            runs: new Map([...cache.runs].filter(([, run]) => run.routineId !== item.routineId)),
          };
    }

    default:
      return cache;
  }
}

/** Records one applied shell item: a routine event updates the cache, and either kind counts. */
export function recordRoutineShellItem(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  item: OrchestrationShellStreamItem,
) {
  if (
    item.kind !== "snapshot" &&
    item.kind !== "routine-upserted" &&
    item.kind !== "routine-removed"
  ) {
    return;
  }

  registry.update(routineCacheAtom(environmentId), (cache) => applyRoutineEvent(cache, item));
  registry.update(routineChangesAtom(environmentId), (count) => count + 1);
}
