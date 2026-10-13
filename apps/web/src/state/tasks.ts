import { createTaskEnvironmentAtoms } from "@otto/client-runtime/state/tasks";
import type { EnvironmentId, OrchestrationTask } from "@otto/contracts";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

const EMPTY_TASKS: ReadonlyArray<OrchestrationTask> = Object.freeze([]);

export const taskEnvironment = createTaskEnvironmentAtoms(connectionAtomRuntime);

export const environmentTasksAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get): ReadonlyArray<OrchestrationTask> =>
      get(environmentSnapshotAtom(environmentId))?.tasks ?? EMPTY_TASKS,
  ).pipe(Atom.withLabel(`web-tasks:${environmentId}`)),
);
