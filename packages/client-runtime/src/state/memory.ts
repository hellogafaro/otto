import { type EnvironmentId, WS_METHODS } from "@otto/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createMemoryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:memory:list",
    tag: WS_METHODS.memoryList,
    staleTimeMs: 5_000,
  });

  const refreshList = (
    target: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => registry.refresh(list({ environmentId: target.environmentId, input: {} })));

  const scheduler = createAtomCommandScheduler();

  const memoryCommand = <
    TTag extends
      | typeof WS_METHODS.memoryCreate
      | typeof WS_METHODS.memoryUpdate
      | typeof WS_METHODS.memoryDelete,
  >(
    label: string,
    tag: TTag,
  ) =>
    createEnvironmentRpcCommand(runtime, {
      label: `environment-data:memory:${label}`,
      tag,
      scheduler,
      onSettled: refreshList,
    });

  return {
    list,
    create: memoryCommand("create", WS_METHODS.memoryCreate),
    update: memoryCommand("update", WS_METHODS.memoryUpdate),
    remove: memoryCommand("delete", WS_METHODS.memoryDelete),
  };
}
