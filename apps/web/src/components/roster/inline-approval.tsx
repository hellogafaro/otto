import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  type ApprovalRequestId,
  type ProviderApprovalDecision,
} from "@otto/contracts";
import { Predicate } from "effect";

import { useI18n } from "../../i18n";
import type { ApprovalRecord } from "../../session-logic";
import { ComposerPendingApprovalActions } from "../chat/composer-pending-approval-actions";
import {
  ComposerPendingApprovalPanel,
  routineProposalDetails,
  skillProposalDetails,
} from "../chat/composer-pending-approval-panel";
import { Card } from "../ui/card";
import { QuestionnaireActions } from "../ui/questionnaire";
import { BotAvatarView } from "./bot-avatar-view";
import type { Bot } from "./types";

type Translate = ReturnType<typeof useI18n>["t"];

const isProposal = (approval: ApprovalRecord) =>
  approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME ||
  approval.toolName === "skill_create" ||
  approval.toolName === "skill_update";

const argsCommand = (approval: ApprovalRecord) =>
  Predicate.isObject(approval.args) && Predicate.isString(approval.args.command)
    ? approval.args.command
    : null;

function approvalHeading(approval: ApprovalRecord, delegateTo: string | null, t: Translate) {
  if (approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME) return t("Review routine");

  if (approval.toolName === "skill_create" || approval.toolName === "skill_update") {
    return t("Review skill");
  }

  if (approval.toolName === "delegate") {
    return delegateTo
      ? t("Delegate to {name}?", { name: delegateTo })
      : t("Hand this to another bot?");
  }

  if (approval.requestKind === "command") {
    return approval.toolName && argsCommand(approval) === null
      ? t("Allow {tool}?", { tool: approval.toolName })
      : t("Run this command?");
  }

  switch (approval.requestKind) {
    case "file-read":
      return t("Read this file?");
    case "file-change":
      return t("Change this file?");
    default:
      return t("Allow app access?");
  }
}

/** What an answered approval was about, in a few words after its outcome. */
function approvalSubject(approval: ApprovalRecord, delegateTo: string | null) {
  if (approval.toolName === "delegate") return delegateTo;

  if (approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME) {
    return routineProposalDetails(approval.args)?.name ?? null;
  }

  if (approval.toolName === "skill_create" || approval.toolName === "skill_update") {
    return skillProposalDetails(approval.args).name || null;
  }

  return argsCommand(approval) ?? approval.toolName ?? null;
}

function answeredLabel(approval: ApprovalRecord, t: Translate) {
  const { decision, actor, respondedBy: name } = approval.resolution ?? {};

  if (decision === "accept" && isProposal(approval)) {
    return name ? t("Approved by {name}", { name }) : t("Approved");
  }

  switch (decision) {
    case "accept":
      return name ? t("Allowed once by {name}", { name }) : t("Allowed once");
    case "acceptForSession":
      return name
        ? t("Allowed for this session by {name}", { name })
        : t("Allowed for this session");
    case "acceptAlways":
      return name ? t("Always allowed by {name}", { name }) : t("Always allowed");
    case "decline":
      return name ? t("Not allowed by {name}", { name }) : t("Not allowed");
    case "cancel":
      if (actor !== "system") return name ? t("Cancelled by {name}", { name }) : t("Cancelled");

      return t("Closed without an answer");
    default:
      return t("Closed without an answer");
  }
}

/**
 * Otto: an approval sits in the transcript under the asking bot's avatar and name, like the
 * bot's questions: the questionnaire's card with a muted meta line, the 14px/500 question, what
 * exactly is being approved and the choices in its bordered footer. Each card answers its own
 * request, so several bots can wait at once; an answered one shrinks to one muted line in place.
 */
export function InlineApproval({
  approval,
  bot,
  delegateTo,
  response,
  onRespond,
}: {
  readonly approval: ApprovalRecord;
  /** The bot that asked; an archived one keeps its card without a face. */
  readonly bot: Pick<Bot, "name" | "avatar"> | null;
  /** The bot a delegate request hands work to, by name. */
  readonly delegateTo: string | null;
  readonly response: { readonly responding: boolean; readonly error: string | null };
  readonly onRespond: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<boolean | void>;
}) {
  const { t } = useI18n();

  if (approval.resolution) {
    const subject = approvalSubject(approval, delegateTo);

    return (
      <p
        className="ml-10 flex min-w-0 gap-1 text-xs text-muted-foreground"
        data-testid="answered-approval"
      >
        <span className="shrink-0">{answeredLabel(approval, t)}</span>
        {subject ? <span className="min-w-0 truncate">· {subject}</span> : null}
      </p>
    );
  }

  const heading = approvalHeading(approval, delegateTo, t);

  const oneUse =
    !isProposal(approval) &&
    (approval.options?.every(
      (option) => option.decision !== "acceptForSession" && option.decision !== "acceptAlways",
    ) ??
      false);

  const meta = [approval.appName, oneUse ? t("Runs once") : undefined].filter(Boolean);

  return (
    <div className="flex items-start gap-3" data-testid="inline-approval">
      {bot ? (
        <BotAvatarView avatar={bot.avatar} name={bot.name} className="mt-0.5 size-7 shrink-0" />
      ) : null}
      <div className={bot ? "min-w-0 flex-1" : "ml-10 min-w-0 flex-1"}>
        {bot ? <div className="mb-2 text-sm font-medium">{bot.name}</div> : null}
        <section
          aria-label={t("Approval required")}
          className="chat-generative w-full max-w-2xl"
          data-generative="approval"
          data-testid="inline-approval-card"
        >
          <Card>
            <div className="flex w-full min-w-0 flex-col gap-3 pt-4">
              {meta.length > 0 ? (
                <p className="w-fit px-4 text-xs text-muted-foreground">{meta.join(" · ")}</p>
              ) : null}
              <div className="flex min-w-0 flex-col gap-3 px-4">
                <h3 className="mb-2 text-sm font-medium text-pretty text-foreground">{heading}</h3>
                <ComposerPendingApprovalPanel approval={approval} pendingCount={1} hideLabel />
              </div>
              {response.error ? (
                <p role="alert" className="px-4 text-xs text-destructive">
                  {response.error}
                </p>
              ) : null}
              <QuestionnaireActions className="flex flex-wrap justify-end">
                <ComposerPendingApprovalActions
                  requestId={approval.requestId}
                  requestKind={approval.requestKind}
                  toolName={approval.toolName}
                  isResponding={response.responding}
                  options={approval.options}
                  onRespondToApproval={onRespond}
                />
              </QuestionnaireActions>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
