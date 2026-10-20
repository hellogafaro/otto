import type {
  OttoDelegationAccessGrant,
  OttoDelegationRecord,
  OttoDelegationState,
} from "@otto/contracts";
import { presentDelegation } from "@otto/client-runtime/delegation-presentation";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { MessageKey, TranslationParams } from "@otto/client-runtime/i18n";
import { RiArrowLeftRightLine } from "@remixicon/react";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadMessages } from "../../state/entities";
import { Dialog, DialogDescription, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { BotAvatarView } from "./bot-avatar-view";
import { AssistantMessageRow, UserMessageRow } from "./bot-chat-message-rows";
import type { Bot } from "./types";

type Translate = (key: MessageKey, params?: TranslationParams) => string;

function runtimeModeLabel(mode: OttoDelegationAccessGrant["runtimeMode"], t: Translate): string {
  switch (mode) {
    case "approval-required":
      return t("approval required");
    case "auto-accept-edits":
      return t("auto-accept edits");
    case "auto":
      return t("automatic approvals");
    case "full-access":
      return t("full access");
  }
}

export function delegationStateLabel(state: OttoDelegationState, t: Translate): string {
  switch (state) {
    case "queued":
      return t("Queued");
    case "running":
      return t("Running");
    case "blocked":
      return t("Blocked");
    case "failed":
      return t("Failed");
    case "canceled":
      return t("Cancelled");
    case "completed":
      return t("Completed");
  }
}

// Sandbox values are identifiers and stay raw.
export function formatDelegationAccess(access: OttoDelegationAccessGrant, t: Translate): string {
  return [
    runtimeModeLabel(access.runtimeMode, t),
    access.sandbox === null ? t("no sandbox") : t("{sandbox} sandbox", { sandbox: access.sandbox }),
    t("MCP servers: {count}", { count: access.enabledMcpServerIds.length }),
  ].join(" · ");
}

/**
 * Read-only view of one piece of delegated work: the two bots' chat so far, in the
 * same rows as any chat. Mount it only while open, because it
 * subscribes to the child thread's messages.
 */
export function DelegationDetail({
  delegation,
  childBot,
  parentBot,
  onOpenChange,
}: {
  readonly delegation: OttoDelegationRecord;
  readonly childBot: Bot | null;
  readonly parentBot: Bot | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const presentation = presentDelegation(delegation);

  const childThreadRef = useMemo(
    () =>
      environmentId && presentation.childThreadId
        ? scopeThreadRef(environmentId, presentation.childThreadId)
        : null,
    [environmentId, presentation.childThreadId],
  );

  const messages = useThreadMessages(childThreadRef);
  const activeChildBot = childBot?.archivedAt === null ? childBot : null;
  const childName = activeChildBot?.name ?? t("Unknown bot");
  const parentName = parentBot?.name ?? t("Unknown bot");

  const childAuthor = {
    name: childName,
    avatar: activeChildBot?.avatar ?? { kind: "dither" as const, seed: delegation.childBotId },
  };

  const transcript = messages.filter((message) => message.role !== "system");

  // Otto: Agent-to-agent work reads as a normal chat, read-only: the bot that asked on the
  // right as your own messages sit, the bot doing the work on the left with its avatar and
  // name, in the same rows a chat uses. Until the work starts, the brief stands in for the
  // first message. Copy is the only message action and the corner X the only dialog action.
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl" data-testid="delegation-detail">
        {/* Otto: The 28px pill sits on the 20px content edge, level with the 28px close. */}
        <div className="flex min-w-0 items-center px-5 pt-3.5 pe-14">
          <div className="flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-foreground/12 px-2">
            <BotAvatarView
              avatar={parentBot?.avatar ?? { kind: "dither", seed: delegation.parentBotId }}
              name={parentName}
              className="size-4 shrink-0"
            />
            <DialogTitle className="min-w-0 truncate text-13px">
              {parentName}
              <span className="sr-only"> · {childName}</span>
            </DialogTitle>
            <RiArrowLeftRightLine
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <BotAvatarView
              avatar={childAuthor.avatar}
              name={childName}
              className="size-4 shrink-0"
            />
            <span aria-hidden="true" className="min-w-0 truncate text-13px font-medium">
              {childName}
            </span>
          </div>
        </div>
        <DialogDescription className="sr-only">
          {delegationStateLabel(presentation.state, t)}
        </DialogDescription>
        <DialogPanel>
          <section aria-label={t("{name} chat", { name: childName })} className="flex flex-col">
            {transcript.some((message) => message.role === "user") ? null : (
              <div className="flex justify-end" data-role="brief">
                <div className="max-w-39/50 rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6 whitespace-pre-wrap">
                  {delegation.task}
                </div>
              </div>
            )}
            {transcript.map((message, index) => {
              const startsGroup = index === 0 || transcript[index - 1]?.role !== message.role;

              return message.role === "assistant" ? (
                <AssistantMessageRow
                  key={message.id}
                  message={message}
                  author={childAuthor}
                  testId="delegation-child-message"
                  startsGroup={startsGroup}
                  cwd={undefined}
                  threadRef={childThreadRef ?? undefined}
                  stepMeter={undefined}
                  trace={undefined}
                  environmentId={environmentId ?? null}
                  currentPersonId={null}
                  playback={null}
                  playbackKey={null}
                  channelApproval={null}
                  onReply={null}
                  onReactionChange={null}
                />
              ) : (
                <UserMessageRow
                  key={message.id}
                  message={message}
                  testId="delegation-parent-message"
                  startsGroup={startsGroup}
                  replyLabel={parentName}
                  showChannelOrigin={false}
                  skills={undefined}
                  environmentId={environmentId ?? null}
                  currentPersonId={null}
                  onReply={null}
                  onReactionChange={null}
                />
              );
            })}
          </section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
