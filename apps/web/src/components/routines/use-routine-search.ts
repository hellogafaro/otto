import type { Routine, RoutineListQuery } from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useDebouncedValue } from "../../state/queries";
import { routineChangesAtom, routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";

const EMPTY: ReadonlyArray<Routine> = [];

/** One page of routines for `query`, loaded again when any routine changes; null asks for none. */
function useRoutinePage(query: RoutineListQuery | null): ReadonlyArray<Routine> {
  const environmentId = usePrimaryEnvironmentId();
  const listRoutines = useAtomCommand(routineEnvironment.list, { reportFailure: false });
  // SAFETY: the empty environment ID is an inactive sentinel; nothing is asked without one.
  const changes = useAtomValue(routineChangesAtom(environmentId ?? ("" as never)));
  const [routines, setRoutines] = useState(EMPTY);
  const key = JSON.stringify(query);

  useEffect(() => {
    const input: RoutineListQuery | null = JSON.parse(key);

    if (!environmentId || input === null) {
      setRoutines(EMPTY);

      return;
    }

    let current = true;

    void listRoutines({ environmentId, input }).then((result) => {
      if (current && AsyncResult.isSuccess(result)) setRoutines(result.value.routines);
    });

    return () => {
      current = false;
    };
  }, [changes, environmentId, key, listRoutines]);

  return routines;
}

/**
 * Otto: The routines the command palette searches: the 100 changed last, and while something is
 * typed, the 100 newest whose titles hold it, so a match past the first page is still found.
 */
export function useRoutineSearch(query: string): ReadonlyArray<Routine> {
  const search = useDebouncedValue(query.trim().toLowerCase().slice(0, 200), 150);
  const newest = useRoutinePage({ sort: "updated" });
  const matches = useRoutinePage(search.length > 0 ? { sort: "updated", search } : null);

  return matches.length === 0
    ? newest
    : [...newest, ...matches.filter((routine) => !newest.some((item) => item.id === routine.id))];
}
