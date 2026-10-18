import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type ProviderRequestKind,
} from "@otto/contracts";

import { memo } from "react";
import { useI18n } from "~/i18n";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  requestKind?: ProviderRequestKind | undefined;
  toolName?: string | undefined;
  /** A skill or instructions a bot proposes, which a person approves or declines as a whole. */
  proposal?: boolean | undefined;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
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

function proposalApprovalOptions(t: Translate): ReadonlyArray<ProviderApprovalOption> {
  return [
    { decision: "decline", label: t("Decline") },
    { decision: "accept", label: t("Approve") },
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

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  requestKind,
  toolName,
  proposal = false,
  isResponding,
  options: providedOptions,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const { t } = useI18n();
  const options = providedOptions ?? defaultApprovalOptions(t);
  const isRoutine = toolName === OTTO_CREATE_ROUTINE_TOOL_NAME;

  const visibleOptions = isRoutine
    ? routineApprovalOptions(t)
    : proposal
      ? proposalApprovalOptions(t)
      : requestKind === "command"
        ? commandApprovalOptions(options, t)
        : options;

  return (
    <>
      {visibleOptions.map((option, index) => {
        const allows = option.decision.startsWith("accept");

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
          </Button>
        );
      })}
    </>
  );
});
