import type { Routine, RoutineStatus } from "@otto/contracts";

import { useI18n } from "../../i18n";
import type { StatusKind } from "../status-icon";

export const ROUTINE_STATUS_ICON = {
  active: "pending",
  draft: "backlog",
  paused: "paused",
  failed: "error",
} as const satisfies Record<RoutineStatus, StatusKind>;

/**
 * Otto: Where a routine stands. A Draft still waits for its instructions to be approved in its
 * chat, so it can't run yet; Paused was switched off and resumes from its page; Failed had its
 * last run fail; Active runs on schedule.
 */
export function routineStatus(routine: Routine): RoutineStatus {
  if (routine.approvalVersion !== routine.procedureVersion) return "draft";

  if (routine.lifecycle === "failed" || routine.lifecycle === "blocked") return "failed";

  return routine.enabled ? "active" : "paused";
}

export function useRoutineStatusLabel(): (status: RoutineStatus) => string {
  const { t } = useI18n();

  return (status) => {
    switch (status) {
      case "active":
        return t("Active");
      case "draft":
        return t("Draft");
      case "paused":
        return t("Paused");
      case "failed":
        return t("Failed");
    }
  };
}
