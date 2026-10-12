import { createRoutineEnvironmentAtoms } from "@otto/client-runtime/state/routines";

import { connectionAtomRuntime } from "../connection/runtime";

export const routineEnvironment = createRoutineEnvironmentAtoms(connectionAtomRuntime);
