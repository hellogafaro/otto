import { EnvironmentId } from "@otto/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  applyRoutineEvent,
  EMPTY_ROUTINE_CACHE,
  recordRoutineShellItem,
  routineCacheAtom,
  routineChangesAtom,
  withRoutines,
} from "./routine-cache.ts";
import { applyShellStreamEvent } from "./shell-reducer.ts";
import {
  baseSnapshot,
  stubAssignment,
  stubRoutine,
  stubRoutineRun,
} from "./shell-reducer.test-support.ts";

const receiptSource = {
  id: stubRoutine.id,
  targetThreadId: stubRoutine.targetThreadId,
  job: stubRoutine.job,
  createdAt: stubRoutine.createdAt,
};

describe("applyShellStreamEvent", () => {
  describe("routine events", () => {
    it("moves the snapshot on without carrying routines or skill assignments", () => {
      const assigned = applyShellStreamEvent(baseSnapshot, {
        kind: "skill-assignment-upserted",
        sequence: 1,
        assignment: stubAssignment,
      });

      const updated = applyShellStreamEvent(assigned, {
        kind: "routine-upserted",
        sequence: 2,
        routine: stubRoutine,
        run: stubRoutineRun,
      });

      expect(updated).toEqual({ ...baseSnapshot, snapshotSequence: 2 });
    });
  });
});

describe("applyRoutineEvent", () => {
  it("updates routines and run history", () => {
    const updated = applyRoutineEvent(EMPTY_ROUTINE_CACHE, {
      kind: "routine-upserted",
      sequence: 2,
      routine: stubRoutine,
      run: stubRoutineRun,
    });

    expect([...updated.routines.values()]).toEqual([stubRoutine]);
    expect([...updated.runs.values()]).toEqual([stubRoutineRun]);
  });

  it("keeps a deleted routine's receipt source and run history", () => {
    const next = applyRoutineEvent(
      {
        ...EMPTY_ROUTINE_CACHE,
        routines: new Map([[stubRoutine.id, stubRoutine]]),
        runs: new Map([[stubRoutineRun.id, stubRoutineRun]]),
      },
      { kind: "routine-removed", sequence: 3, routineId: stubRoutine.id, receiptSource },
    );

    expect([...next.routines.values()]).toEqual([]);
    expect([...next.receiptSources.values()]).toEqual([receiptSource]);
    expect([...next.runs.values()]).toEqual([stubRoutineRun]);
  });

  it("drops a routine hidden from this person with its runs", () => {
    const next = applyRoutineEvent(
      {
        ...EMPTY_ROUTINE_CACHE,
        routines: new Map([[stubRoutine.id, stubRoutine]]),
        runs: new Map([[stubRoutineRun.id, stubRoutineRun]]),
      },
      { kind: "routine-removed", sequence: 3, routineId: stubRoutine.id },
    );

    expect(next.routines.size).toBe(0);
    expect(next.runs.size).toBe(0);
  });
});

describe("withRoutines", () => {
  it("keeps a routine an event already brought newer", () => {
    const newer = { ...stubRoutine, job: "Evening brief", updatedAt: "2026-04-03T00:00:00.000Z" };
    const cache = withRoutines(EMPTY_ROUTINE_CACHE, [newer]);

    expect(withRoutines(cache, [stubRoutine])).toBe(cache);
    expect(withRoutines(EMPTY_ROUTINE_CACHE, [stubRoutine]).routines.get(stubRoutine.id)).toBe(
      stubRoutine,
    );
  });
});

describe("recordRoutineShellItem", () => {
  it("counts routine events and fresh snapshots, and nothing else", () => {
    const registry = AtomRegistry.make();
    const environmentId = EnvironmentId.make("environment-routines");

    recordRoutineShellItem(registry, environmentId, {
      kind: "routine-upserted",
      sequence: 1,
      routine: stubRoutine,
    });
    recordRoutineShellItem(registry, environmentId, { kind: "snapshot", snapshot: baseSnapshot });
    recordRoutineShellItem(registry, environmentId, {
      kind: "skill-assignment-upserted",
      sequence: 2,
      assignment: stubAssignment,
    });

    expect(registry.get(routineChangesAtom(environmentId))).toBe(2);
    expect(registry.get(routineCacheAtom(environmentId)).routines.get(stubRoutine.id)).toBe(
      stubRoutine,
    );
  });
});
