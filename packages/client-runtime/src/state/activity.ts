import { WS_METHODS } from "@otto/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** An entity's timeline and the comment commands; callers refresh the timeline they changed. */
export function createActivityEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:activity:list",
      tag: WS_METHODS.activityList,
      staleTimeMs: 5_000,
      revalidateOnFocus: true,
    }),
    createComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:activity:comment:create",
      tag: WS_METHODS.activityCommentCreate,
    }),
    updateComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:activity:comment:update",
      tag: WS_METHODS.activityCommentUpdate,
    }),
    deleteComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:activity:comment:delete",
      tag: WS_METHODS.activityCommentDelete,
    }),
  };
}
