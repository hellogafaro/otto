import { createSecretsEnvironmentAtoms } from "@otto/client-runtime/state/secrets";

import { connectionAtomRuntime } from "../connection/runtime";

export const secretsEnvironment = createSecretsEnvironmentAtoms(connectionAtomRuntime);
