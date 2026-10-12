import { createAuthEnvironmentAtoms } from "@otto/client-runtime/state/auth";

import { connectionAtomRuntime } from "../connection/runtime";

export const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);
