import { createRoutineEnvironmentAtoms } from "@otto/client-runtime/state/routines";

import { connectionAtomRuntime } from "../connection/runtime";

export {
  routineCacheAtom,
  routineChangesAtom,
  withRoutines,
} from "@otto/client-runtime/state/routines";

export const routineEnvironment = createRoutineEnvironmentAtoms(connectionAtomRuntime);
