import { RiEmotionHappyLine } from "@remixicon/react";
import type { EnvironmentId, OrchestrationMessage, ServerProviderSkill } from "@otto/contracts";
import type { AnsweredUserInputQuestion } from "@otto/client-runtime/user-input-answers";

import { memo } from "react";

import { useI18n } from "~/i18n";
import { channelOriginLabel } from "@otto/client-runtime/channel-origin-presentation";
import { replyPlaybackControlProps } from "~/lib/replyPlaybackThread";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import {
  MessageControls,
  type MessageReactionOption,
  reactionOptionFromEmoji,
  selectedReactionForPerson,
} from "../chat/MessageControls";
import { MessageReactions } from "../chat/MessageReactions";
import { PluginSearchResultCard } from "../chat/PluginSearchResultCard";
import { SentMessageText } from "../chat/SentMessageText";
import { UserInputAnswerCard } from "../chat/UserInputAnswerCard";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatarView } from "./BotAvatarView";
import { PersonAvatar } from "./PersonAvatar";
import { BotMessageAttachments } from "./BotMessageAttachments";
import { BotStepMeter } from "./BotStepMeter";
import {
  type AssistantMessageRowProps,
  assistantRowPropsEqual,
  type MessageReplyHandler,
} from "./botMessageRowEquality";
import { ChannelSendApproval } from "./ChannelSendApproval";
import type { MessageReactionHandler } from "./useMessageReactionUpdater";

export {
  assistantRowPropsEqual,
  type MessageReplyHandler,
  type PluginResultEntry,
} from "./botMessageRowEquality";

export { type ChannelApprovalTarget, ChannelSendApproval } from "./ChannelSendApproval";

export {
  type MessageReactionHandler,
  useMessageReactionUpdater,
} from "./useMessageReactionUpdater";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

// Otto: A message's actions float in a small toolbar over its top right corner on hover or focus,
// taking no space in the transcript. Held open while a control's menu is, so the controls never
// slip out from under the pointer. Touch and narrow screens keep them inline under the message.
const MESSAGE_TOOLBAR_CLASS = cn(
  "flex opacity-0 transition-opacity pointer-events-none",
  "group-hover/message:opacity-100 group-hover/message:pointer-events-auto",
  "focus-within:opacity-100 focus-within:pointer-events-auto",
  "has-[[aria-expanded=true]]:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto",
  "has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:pointer-events-auto",
  "pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 max-md:pointer-events-auto max-md:opacity-100 max-md:mt-0.5 pointer-coarse:mt-0.5",
  "pointer-fine:md:absolute pointer-fine:md:-top-4 pointer-fine:md:end-0 pointer-fine:md:z-10 pointer-fine:md:rounded-lg pointer-fine:md:border pointer-fine:md:border-border/70 pointer-fine:md:bg-popover pointer-fine:md:p-0.5 pointer-fine:md:shadow-md",
);

// Offscreen rows skip layout and paint; the intrinsic size keeps the scrollbar steady.
const ROW_VISIBILITY_CLASS = "content-visibility-row";

function UnavailableReactionControl({
  selectedReaction,
}: {
  readonly selectedReaction: MessageReactionOption | null;
}) {
  const { t } = useI18n();
  const unavailableReason = t("Reactions are unavailable until this chat is ready");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={unavailableReason}
            className="disabled:pointer-events-auto"
            disabled
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        {selectedReaction ? (
          <span className="text-sm font-emoji">{selectedReaction}</span>
        ) : (
          <RiEmotionHappyLine className="size-3.5" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{unavailableReason}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Reaction picker plus the chip toggles for one message. A null handler means the chat
 * is not linked yet, so the picker explains why it is disabled.
 */
function reactionProps(
  message: OrchestrationMessage,
  selectedReaction: MessageReactionOption | null,
  onReactionChange: MessageReactionHandler | null,
) {
  if (!onReactionChange) return { controls: {}, chips: {} };

  return {
    controls: {
      onReactionChange: (next: MessageReactionOption | null) =>
        onReactionChange(message.id, selectedReaction, next),
    },
    chips: {
      onToggle: (emoji: string) => {
        const option = reactionOptionFromEmoji(emoji);

        if (!option) return;
        onReactionChange(message.id, selectedReaction, selectedReaction === option ? null : option);
      },
    },
  };
}

function userMessageCopyText(message: OrchestrationMessage) {
  return (
    message.text ||
    message.attachments?.map((attachment) => attachment.name).join(", ") ||
    "Attachment"
  );
}

/**
 * One assistant reply. Memoized with prop comparison that looks inside derived per-turn
 * objects, because those are rebuilt whenever any thread activity arrives.
 */
export const AssistantMessageRow = memo(function AssistantMessageRow({
  message,
  author,
  testId,
  arrived,
  startsGroup,
  cwd,
  threadRef,
  stepMeter,
  pluginResults,
  currentPersonId,
  playback,
  channelApproval,
  onReply,
  onReactionChange,
}: AssistantMessageRowProps) {
  const { t } = useI18n();
  const readAloud = replyPlaybackControlProps(playback, message);
  const copyText = message.text || "Attachment";
  const label = author?.name ?? t("Unavailable bot");

  const markdown = (
    <ChatMarkdown className="mt-1" cwd={cwd} text={message.text} threadRef={threadRef} />
  );

  if (!author) {
    return (
      <div
        id={`chat-message-${message.id}`}
        tabIndex={-1}
        className={cn(
          `group/message relative mt-3 max-w-17/20 first:mt-0 ${ROW_VISIBILITY_CLASS}`,
          arrived && "motion-message-enter",
        )}
        data-testid={testId}
      >
        <div className="text-sm font-medium">{label}</div>
        {markdown}
        <div className={MESSAGE_TOOLBAR_CLASS}>
          <MessageControls
            copyText={copyText}
            {...(readAloud ? { readAloud } : {})}
            onReply={() => onReply(message.id, label, copyText)}
          />
        </div>
      </div>
    );
  }

  const selectedReaction = selectedReactionForPerson(message.reactions, currentPersonId);
  const reactions = reactionProps(message, selectedReaction, onReactionChange);

  return (
    <div
      id={`chat-message-${message.id}`}
      tabIndex={-1}
      className={cn(
        "group/message flex items-start gap-3",
        startsGroup ? "mt-3 first:mt-0" : "mt-1",
        ROW_VISIBILITY_CLASS,
        arrived && "motion-message-enter",
      )}
      data-testid={testId}
    >
      {startsGroup ? (
        <BotAvatarView
          avatar={author.avatar}
          name={author.name}
          className="mt-0.5 size-7 shrink-0"
        />
      ) : (
        <div aria-hidden="true" className="size-7 shrink-0" />
      )}
      <div className="relative min-w-0 flex-1">
        {startsGroup ? <div className="text-sm font-medium">{author.name}</div> : null}
        <BotStepMeter meter={stepMeter} />
        {markdown}
        {pluginResults?.map(({ id, result }) => (
          <PluginSearchResultCard className="mt-3" key={id} result={result} />
        ))}
        <div className={MESSAGE_TOOLBAR_CLASS}>
          <MessageControls
            copyText={copyText}
            {...(readAloud ? { readAloud } : {})}
            selectedReaction={selectedReaction}
            onReply={() => onReply(message.id, label, copyText)}
            {...reactions.controls}
          />
          {!onReactionChange ? (
            <UnavailableReactionControl selectedReaction={selectedReaction} />
          ) : null}
        </div>
        <MessageReactions
          reactions={message.reactions ?? []}
          selectedEmoji={selectedReaction}
          {...reactions.chips}
        />
        {channelApproval ? (
          <ChannelSendApproval
            environmentId={channelApproval.environmentId}
            botId={channelApproval.botId}
            origin={channelApproval.origin}
            threadId={channelApproval.threadId}
            messageId={message.id}
            delivery={message.channelDelivery}
            sent={channelApproval.sent}
            canSend={channelApproval.canSend}
          />
        ) : null}
      </div>
    </div>
  );
}, assistantRowPropsEqual);

/** One message from a person. `replyLabel` names the author in reply previews. */
export const UserMessageRow = memo(function UserMessageRow({
  message,
  testId,
  arrived,
  replySourceMessageId = null,
  startsGroup,
  replyLabel,
  showChannelOrigin,
  skills,
  environmentId,
  currentPersonId,
  answered = null,
  authorName = null,
  onReply,
  onReactionChange,
}: {
  readonly message: OrchestrationMessage;
  readonly testId: string;
  /** Another person in a group chat; their messages sit on the left under their name. */
  readonly authorName?: string | null;
  readonly arrived?: boolean;
  readonly replySourceMessageId?: string | null;
  readonly startsGroup: boolean;
  readonly replyLabel: string;
  readonly showChannelOrigin: boolean;
  /** Provider skills whose `$name` tokens render as skill chips. */
  readonly skills: ReadonlyArray<ServerProviderSkill> | undefined;
  readonly environmentId: EnvironmentId | null;
  readonly currentPersonId: string | null | undefined;
  /** Set when this message answers a bot's questions; it then reads back as an answer card. */
  readonly answered?: ReadonlyArray<AnsweredUserInputQuestion> | null;
  readonly onReply: MessageReplyHandler;
  /** Null while the chat has no linked thread to react in. */
  readonly onReactionChange: MessageReactionHandler | null;
}) {
  const copyText = userMessageCopyText(message);
  const selectedReaction = selectedReactionForPerson(message.reactions, currentPersonId);
  const reactions = reactionProps(message, selectedReaction, onReactionChange);

  if (authorName) {
    return (
      <div
        id={`chat-message-${message.id}`}
        tabIndex={-1}
        className={cn(
          "group/message flex items-start gap-3",
          startsGroup ? "mt-3 first:mt-0" : "mt-1",
          ROW_VISIBILITY_CLASS,
          arrived && "motion-message-enter",
        )}
        data-testid={testId}
      >
        {startsGroup ? (
          <PersonAvatar name={authorName} className="mt-0.5 size-7" />
        ) : (
          <div aria-hidden="true" className="size-7 shrink-0" />
        )}
        <div className="relative flex min-w-0 max-w-39/50 flex-col items-start">
          {startsGroup ? <div className="text-sm font-medium">{authorName}</div> : null}
          <div className="mt-0.5 rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
            {message.text ? (
              <SentMessageText
                text={message.text}
                skills={skills}
                replySourceMessageId={replySourceMessageId}
              />
            ) : null}
            {message.attachments?.length ? (
              <div className={message.text ? "mt-2" : undefined}>
                <BotMessageAttachments
                  attachments={message.attachments}
                  environmentId={environmentId ?? NO_ENVIRONMENT}
                />
              </div>
            ) : null}
          </div>
          <div className={MESSAGE_TOOLBAR_CLASS}>
            <MessageControls
              copyText={copyText}
              selectedReaction={selectedReaction}
              onReply={() => onReply(message.id, authorName, copyText)}
              {...reactions.controls}
            />
            {!onReactionChange ? (
              <UnavailableReactionControl selectedReaction={selectedReaction} />
            ) : null}
          </div>
          <MessageReactions
            reactions={message.reactions ?? []}
            selectedEmoji={selectedReaction}
            {...reactions.chips}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      id={`chat-message-${message.id}`}
      tabIndex={-1}
      className={cn(
        "group/message flex justify-end",
        startsGroup ? "mt-3 first:mt-0" : "mt-1",
        ROW_VISIBILITY_CLASS,
        arrived && "motion-message-enter",
      )}
      data-testid={testId}
    >
      <div className="relative flex max-w-39/50 flex-col items-end">
        {answered ? (
          <UserInputAnswerCard answered={answered} />
        ) : (
          <div className="w-full rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
            {showChannelOrigin && message.channelOrigin ? (
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {channelOriginLabel(message.channelOrigin, message.authorDisplayName)}
              </div>
            ) : null}
            {message.text ? (
              <SentMessageText
                text={message.text}
                skills={skills}
                replySourceMessageId={replySourceMessageId}
              />
            ) : null}
            {message.attachments?.length ? (
              <div className={message.text ? "mt-2" : undefined}>
                <BotMessageAttachments
                  attachments={message.attachments}
                  environmentId={environmentId ?? NO_ENVIRONMENT}
                />
              </div>
            ) : null}
          </div>
        )}
        <div className={MESSAGE_TOOLBAR_CLASS}>
          <MessageControls
            align="end"
            copyText={copyText}
            selectedReaction={selectedReaction}
            onReply={() => onReply(message.id, replyLabel, copyText)}
            {...reactions.controls}
          />
          {!onReactionChange ? (
            <UnavailableReactionControl selectedReaction={selectedReaction} />
          ) : null}
        </div>
        <MessageReactions
          align="end"
          reactions={message.reactions ?? []}
          selectedEmoji={selectedReaction}
          {...reactions.chips}
        />
      </div>
    </div>
  );
});
