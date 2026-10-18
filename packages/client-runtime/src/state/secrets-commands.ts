import { WS_METHODS } from "@otto/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createSecretsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:secrets:list",
      tag: WS_METHODS.secretsList,
    }),
    reveal: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secrets:reveal",
      tag: WS_METHODS.secretsReveal,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secrets:save",
      tag: WS_METHODS.secretsSave,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secrets:remove",
      tag: WS_METHODS.secretsRemove,
    }),
  };
}
