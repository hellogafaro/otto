import { createNotificationEnvironmentAtoms } from "@otto/client-runtime/state/notifications";

import { connectionAtomRuntime } from "../connection/runtime";

export const notificationEnvironment = createNotificationEnvironmentAtoms(connectionAtomRuntime);
