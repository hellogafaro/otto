import { createRoutineEnvironmentAtoms } from "@otto/client-runtime/state/routines";

import { connectionAtomRuntime } from "../connection/runtime";

export { routineCacheAtom, routineChangesAtom } from "@otto/client-runtime/state/routines";

export const routineEnvironment = createRoutineEnvironmentAtoms(connectionAtomRuntime);
