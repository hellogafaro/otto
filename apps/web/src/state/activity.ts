import { createActivityEnvironmentAtoms } from "@otto/client-runtime/state/activity";

import { connectionAtomRuntime } from "../connection/runtime";

export const activityEnvironment = createActivityEnvironmentAtoms(connectionAtomRuntime);
