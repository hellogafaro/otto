import { createLibraryEnvironmentAtoms } from "@otto/client-runtime/state/library";

import { connectionAtomRuntime } from "../connection/runtime";

export const libraryEnvironment = createLibraryEnvironmentAtoms(connectionAtomRuntime);
