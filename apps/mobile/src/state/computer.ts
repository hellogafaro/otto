import { createComputerEnvironmentAtoms } from "@otto/client-runtime/state/computer";

import { connectionAtomRuntime } from "../connection/runtime";

export const computerEnvironment = createComputerEnvironmentAtoms(connectionAtomRuntime);
