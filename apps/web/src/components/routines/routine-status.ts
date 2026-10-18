import type { Routine } from "@otto/contracts";

import type { StatusKind } from "../status-icon";

export type RoutineStatus = "active" | "paused" | "failed";

/** The shared status glyph each routine status shows, in lists, groups and the palette. */
export const ROUTINE_STATUS_ICON = {
  active: "pending",
  paused: "paused",
  failed: "error",
} as const satisfies Record<RoutineStatus, StatusKind>;

export function routineStatus(routine: Routine): RoutineStatus {
  if (routine.lifecycle === "failed" || routine.lifecycle === "blocked") return "failed";

  return routine.enabled ? "active" : "paused";
}
