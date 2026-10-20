import {
  type OrchestrationThreadActivity,
  THREAD_SILENT_RUN_ACTIVITY_KIND,
  THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND,
} from "@otto/contracts";

/** Silent-run activities drive the chat status line, not the work log. */
export function isSilentRunActivity(activity: Pick<OrchestrationThreadActivity, "kind">): boolean {
  return (
    activity.kind === THREAD_SILENT_RUN_ACTIVITY_KIND ||
    activity.kind === THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND
  );
}
