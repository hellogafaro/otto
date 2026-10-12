import { createBotInboxEnvironmentAtoms } from "@otto/client-runtime/state/bot-inbox";

import { connectionAtomRuntime } from "../connection/runtime";

export const botInboxEnvironment = createBotInboxEnvironmentAtoms(connectionAtomRuntime);
