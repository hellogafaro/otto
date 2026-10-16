import { WS_METHODS } from "@otto/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** Otto: The signed-in person's notifications, polled so the unread count stays current. */
export function createNotificationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:notifications:list",
      tag: WS_METHODS.notificationsList,
      staleTimeMs: 5_000,
      refreshIntervalMs: 20_000,
      revalidateOnFocus: true,
    }),
    markRead: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notifications:mark-read",
      tag: WS_METHODS.notificationsMarkRead,
    }),
  };
}
