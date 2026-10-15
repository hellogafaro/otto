import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@otto/client-runtime/connection";
import {
  createEnvironmentShellAtoms,
  createEnvironmentShellSummaryAtom,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@otto/client-runtime/state/shell";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { hasTag } from "~/lib/tagged-union";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);

export const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);

export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);

export const environmentShellSummaryAtom = createEnvironmentShellSummaryAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  shellStateValueAtom: environmentShell.stateValueAtom,
});

export const allEnvironmentShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(environmentCatalog.catalogAtom));

  if (Option.isNone(catalog)) {
    return false;
  }

  for (const [environmentId, entry] of catalog.value.entries) {
    if (Option.isSome(get(environmentShell.stateValueAtom(environmentId)).snapshot)) {
      continue;
    }

    const connection = Option.getOrElse(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      () => AVAILABLE_CONNECTION_STATE,
    );

    // Otto: the primary environment always connects; before its first attempt it is on its way,
    // not settled without a snapshot.
    if (hasTag(entry.target, "PrimaryConnectionTarget") && connection.generation === 0) {
      return false;
    }

    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }

    // A retrying environment is only transiently disconnected; give it its
    // first retries before letting the landing settle without its snapshot.
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }

  return true;
}).pipe(Atom.withLabel("web-all-environment-shells-bootstrapped"));
