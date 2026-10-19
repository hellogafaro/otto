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
import ChatMarkdown from "../chat-markdown";
import { Dialog, DialogDescription, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { BotAvatarView } from "./bot-avatar-view";
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
 * Read-only view of one piece of delegated work: the brief, the access it was
 * given, and the child's chat so far. Mount it only while open, because it
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

  // Otto: Agent-to-agent work reads as a chat, not a report: both names in one pill, the
  // brief as an outlined note, and each message in the same outline bubble as a reply.
  // Read-only, so the corner X is the only action.
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl" data-testid="delegation-detail">
        <div className="flex min-w-0 items-center px-5 pt-3.5 pe-14">
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-foreground/12 px-2.5 py-1">
            <BotAvatarView
              avatar={parentBot?.avatar ?? { kind: "dither", seed: delegation.parentBotId }}
              name={parentName}
              className="size-5 shrink-0"
            />
            <DialogTitle className="min-w-0 truncate text-sm">
              {parentName}
              <span className="sr-only"> · {childName}</span>
            </DialogTitle>
            <RiArrowLeftRightLine
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <BotAvatarView
              avatar={activeChildBot?.avatar ?? { kind: "dither", seed: delegation.childBotId }}
              name={childName}
              className="size-5 shrink-0"
            />
            <span aria-hidden="true" className="min-w-0 truncate text-sm font-medium">
              {childName}
            </span>
          </div>
        </div>
        <DialogDescription className="sr-only">
          {delegationStateLabel(presentation.state, t)}
        </DialogDescription>
        <DialogPanel tone="body" className="flex flex-col gap-3">
          <p className="rounded-2xl border border-foreground/12 px-3.25 py-1.75 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
            {delegation.task}
          </p>
          <section
            aria-label={t("{name} chat", { name: childName })}
            className="flex flex-col gap-3"
          >
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No messages yet")}</p>
            ) : (
              messages.map((message) => {
                const fromChild = message.role === "assistant";

                return (
                  <div
                    key={message.id}
                    data-role={message.role}
                    className={fromChild ? "flex justify-start" : "flex justify-end"}
                  >
                    <div
                      className={`flex max-w-39/50 flex-col ${fromChild ? "items-start" : "items-end"}`}
                    >
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        {fromChild ? childName : parentName}
                      </div>
                      <div className="rounded-2xl border border-foreground/12 px-3.25 py-1.75 text-sm leading-6">
                        <ChatMarkdown
                          cwd={undefined}
                          text={message.text}
                          threadRef={childThreadRef ?? undefined}
                          isStreaming={message.streaming}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
