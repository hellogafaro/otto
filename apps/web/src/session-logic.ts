import {
  deriveApprovalRecords,
  derivePendingApprovals,
  derivePendingUserInputs,
  type ApprovalRecord,
  type PendingApproval,
  type PendingUserInput,
} from "@otto/client-runtime/pending-requests";
import { ProviderDriverKind } from "@otto/contracts";

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  /** Shown on the model picker sidebar when relevant */
  pickerSidebarBadge?: "new" | "soon";
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("kimi"),
    label: "Kimi For Coding",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("opencodeGo"),
    label: "OpenCode Go",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("customOpenai"),
    label: "Custom API",
    available: true,
  },
];

export type { ApprovalRecord, PendingApproval, PendingUserInput };

export { deriveApprovalRecords, derivePendingApprovals, derivePendingUserInputs };

export { formatDuration, formatElapsed } from "@otto/shared/orchestrationTiming";

export { deriveWorkLogEntries } from "./session/work-log-entries";

export {
  workLogEntryIsToolLike,
  pluginSearchResultForWorkEntry,
  workEntryDisplayIndicatesToolFailure,
} from "./session/work-log-status";

export { isLatestTurnSettled, deriveActiveWorkStartedAt } from "./session/turn-timing";

export {
  type WorkLogToolLifecycleStatus,
  type WorkLogEntry,
  type ActivePlanState,
  type TimelineEntry,
  type TurnPlanEntry,
} from "./session/work-log-types";
