import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  type ApprovalKeybindingCommand,
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type ProviderRequestKind,
} from "@otto/contracts";

import { memo } from "react";
import { useI18n } from "~/i18n";
import { Button } from "../ui/button";
import { type ApprovalShortcutHandlers, useApprovalShortcuts } from "./use-approval-shortcuts";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  requestKind?: ProviderRequestKind | undefined;
  toolName?: string | undefined;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  /** The chat's front request answers the approval shortcuts and shows them. */
  shortcuts?: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<boolean | void>;
}

type Translate = ReturnType<typeof useI18n>["t"];

function defaultApprovalOptions(t: Translate): ReadonlyArray<ProviderApprovalOption> {
  return [
    { decision: "cancel", label: t("Cancel") },
    { decision: "decline", label: t("Decline") },
    { decision: "acceptForSession", label: t("Always allow this session") },
    { decision: "accept", label: t("Approve") },
  ];
}

function routineApprovalOptions(t: Translate): ReadonlyArray<ProviderApprovalOption> {
  return [
    { decision: "decline", label: t("Don't create") },
    { decision: "accept", label: t("Create routine") },
  ];
}

function commandApprovalOptions(
  options: ReadonlyArray<ProviderApprovalOption>,
  t: Translate,
): ReadonlyArray<ProviderApprovalOption> {
  const always = options.find((option) => option.decision === "acceptAlways");
  const session = options.find((option) => option.decision === "acceptForSession");

  const once =
    options.find((option) => option.decision === "accept") ??
    ({ decision: "accept", label: t("Allow once") } as const);

  const never =
    options.find((option) => option.decision === "decline") ??
    options.find((option) => option.decision === "cancel") ??
    ({ decision: "decline", label: t("Never") } as const);

  return [
    { ...never, label: t("Never") },
    ...(always ? [{ ...always, label: t("Always allow") } as const] : session ? [session] : []),
    { ...once, label: t("Allow once") },
  ];
}

/** Which shown choice each approval shortcut picks: allow once, the broadest allow, the refusal. */
function shortcutDecisions(
  options: ReadonlyArray<ProviderApprovalOption>,
): ReadonlyMap<ProviderApprovalDecision, ApprovalKeybindingCommand> {
  const shown = new Set(options.map((option) => option.decision));

  const first = (...decisions: ProviderApprovalDecision[]) =>
    decisions.find((decision) => shown.has(decision));

  const commands = new Map<ProviderApprovalDecision, ApprovalKeybindingCommand>();
  const approve = first("accept");
  const allowAll = first("acceptAlways", "acceptForSession");
  const deny = first("decline", "cancel");

  if (approve) commands.set(approve, "approval.approve");

  if (allowAll) commands.set(allowAll, "approval.allowAll");

  if (deny) commands.set(deny, "approval.deny");

  return commands;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  requestKind,
  toolName,
  isResponding,
  options: providedOptions,
  shortcuts = false,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const { t } = useI18n();
  const options = providedOptions ?? defaultApprovalOptions(t);
  const isRoutine = toolName === OTTO_CREATE_ROUTINE_TOOL_NAME;

  const visibleOptions = isRoutine
    ? routineApprovalOptions(t)
    : requestKind === "command"
      ? commandApprovalOptions(options, t)
      : options;

  const commands = shortcutDecisions(visibleOptions);
  const handlers: ApprovalShortcutHandlers = {};

  for (const [decision, command] of commands) {
    handlers[command] = () => {
      if (!isResponding) void onRespondToApproval(requestId, decision);
    };
  }

  const shortcutHint = useApprovalShortcuts(shortcuts, handlers);

  return (
    <>
      {visibleOptions.map((option, index) => {
        const allows = option.decision.startsWith("accept");
        const command = commands.get(option.decision);

        return (
          <Button
            key={option.decision}
            size="sm"
            // Like the questionnaire's footer: the way out on the left as Back sits, the
            // allowing choice last as Send.
            variant={option.decision === "accept" ? "primary" : allows ? "outline" : "ghost-muted"}
            className={index === 0 && !allows ? "me-auto" : undefined}
            disabled={isResponding}
            onClick={() => void onRespondToApproval(requestId, option.decision)}
          >
            <span className="max-w-40 truncate">{option.label}</span>
            {command ? shortcutHint(command) : null}
          </Button>
        );
      })}
    </>
  );
});
