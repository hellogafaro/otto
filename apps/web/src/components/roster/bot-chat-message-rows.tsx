import { RiEmotionHappyLine } from "@remixicon/react";
import type { EnvironmentId, OrchestrationMessage, ServerProviderSkill } from "@otto/contracts";
import type { AnsweredUserInputQuestion } from "@otto/client-runtime/user-input-answers";

import { memo } from "react";

import { useI18n } from "~/i18n";
import { channelOriginLabel } from "@otto/client-runtime/channel-origin-presentation";
import { replyPlaybackControlProps } from "~/lib/reply-playback-thread";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "~/timestamp-format";
import { useClientSettings } from "../../hooks/use-settings";
import ChatMarkdown from "../chat-markdown";
import {
  MessageControls,
  type MessageReactionOption,
  reactionOptionFromEmoji,
  selectedReactionForPerson,
} from "../chat/message-controls";
import { FoldedMessage } from "../chat/folded-message";
import { MessageReactions } from "../chat/message-reactions";
import { SentMessageText } from "../chat/sent-message-text";
import { UserInputAnswerCard } from "../chat/user-input-answer-card";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatarView } from "./bot-avatar-view";
import { PersonAvatar } from "./person-avatar";
import { BotMessageAttachments } from "./bot-message-attachments";
import { BotStepMeter } from "./bot-step-meter";
import { BotTurnTrace } from "./bot-turn-trace";
import {
  type AssistantMessageRowProps,
  assistantRowPropsEqual,
  type MessageReplyHandler,
} from "./bot-message-row-equality";
import { ChannelSendApproval } from "./channel-send-approval";
import type { MessageReactionHandler } from "./use-message-reaction-updater";

export { assistantRowPropsEqual, type MessageReplyHandler } from "./bot-message-row-equality";

export { type ChannelApprovalTarget, ChannelSendApproval } from "./channel-send-approval";

export {
  type MessageReactionHandler,
  useMessageReactionUpdater,
} from "./use-message-reaction-updater";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

// Otto: Every message, yours, other people's and bots', carries its actions in the same small
// toolbar floating over the top right of its block on hover or focus, 8px in from the block's right
// edge and taking no space in the transcript: above the author's name on a group's first message,
// over the gap above on later ones. Held open while a control's menu is. Touch and narrow screens
// keep it inline under the message.
const MESSAGE_TOOLBAR_CLASS = cn(
  "flex opacity-0 transition-opacity pointer-events-none",
  "group-hover/message:opacity-100 group-hover/message:pointer-events-auto",
  "focus-within:opacity-100 focus-within:pointer-events-auto",
  "has-[[aria-expanded=true]]:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto",
  "has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:pointer-events-auto",
  "pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 max-md:pointer-events-auto max-md:opacity-100 max-md:mt-0.5 pointer-coarse:mt-0.5",
  "pointer-fine:md:absolute pointer-fine:md:end-2 pointer-fine:md:z-10 pointer-fine:md:rounded-lg pointer-fine:md:border pointer-fine:md:border-border/70 pointer-fine:md:bg-popover pointer-fine:md:p-0.5 pointer-fine:md:shadow-md",
);

/** Above the author's name on a group's first message, over the gap above on later ones. */
function toolbarClass(startsGroup: boolean) {
  return cn(
    MESSAGE_TOOLBAR_CLASS,
    startsGroup ? "pointer-fine:md:-top-3" : "pointer-fine:md:-top-5",
  );
}

// Otto: One gap inside a group. Bubbles, attachments and the header sit 6px apart, for people and
// bots alike; only a new author or turn opens the wider 12px gap.
const GROUP_GAP_CLASS = "mt-1.5";

const GROUP_GAP_MB = "mb-1.5";

const ROW_GAP_CLASS = (startsGroup: boolean) => (startsGroup ? "mt-3 first:mt-0" : GROUP_GAP_CLASS);

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
  trace,
  environmentId,
  currentPersonId,
  playback,
  channelApproval,
  live = null,
  onReply,
  onReactionChange,
}: AssistantMessageRowProps) {
  const { t } = useI18n();
  const readAloud = replyPlaybackControlProps(playback, message);
  const copyText = message.text || "Attachment";
  const label = author?.name ?? t("Unavailable bot");

  // Otto: A bot's reply is the work itself, so it never folds; only people's messages fold behind
  // Show more. It may run a little wider than a person's (85%, not 78%) to fit tables and code,
  // while still reading as a chat bubble.
  const markdown = message.text ? (
    <div
      className="w-fit max-w-full rounded-2xl border border-foreground/12 px-3.25 py-1.75 text-sm leading-6"
      data-testid="bot-message-body"
    >
      <ChatMarkdown cwd={cwd} text={message.text} threadRef={threadRef} />
    </div>
  ) : null;

  if (!author) {
    return (
      <div
        id={`chat-message-${message.id}`}
        tabIndex={-1}
        className={cn(
          `group/message relative mt-3 w-fit min-w-56 max-w-17/20 first:mt-0 ${ROW_VISIBILITY_CLASS}`,
          arrived && "motion-message-enter",
        )}
        data-testid={testId}
      >
        <div className={cn("text-sm font-medium", GROUP_GAP_MB)}>{label}</div>
        {markdown}
        <div className={toolbarClass(true)}>
          <MessageControls
            copyText={copyText}
            {...(readAloud ? { readAloud } : {})}
            {...(onReply ? { onReply: () => onReply(message.id, label, copyText) } : {})}
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
        ROW_GAP_CLASS(startsGroup),
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
      <div className="min-w-0 flex-1">
        <div className="relative w-fit max-w-17/20">
          {/* Otto: One clock per group. The group's first reply carries "Cody · Worked for 24s" in
              place of the name, live and shimmering while the bot works on; the rest of the group
              stacks under it as bare bubbles. */}
          {trace || live ? (
            <div className={GROUP_GAP_MB}>
              <BotTurnTrace
                trace={trace}
                environmentId={environmentId}
                name={author.name}
                live={live}
              />
            </div>
          ) : startsGroup ? (
            <div className={cn("text-sm font-medium", GROUP_GAP_MB)}>{author.name}</div>
          ) : null}
          <BotStepMeter meter={stepMeter} />
          {markdown}
          {/* Otto: What a bot posts with message_post keeps its files, as a person's message does. */}
          {message.attachments?.length ? (
            <div className={markdown ? GROUP_GAP_CLASS : undefined}>
              <BotMessageAttachments
                attachments={message.attachments}
                environmentId={environmentId ?? NO_ENVIRONMENT}
              />
            </div>
          ) : null}
          <div className={toolbarClass(startsGroup)}>
            <MessageControls
              copyText={copyText}
              {...(readAloud ? { readAloud } : {})}
              selectedReaction={selectedReaction}
              {...(onReply ? { onReply: () => onReply(message.id, label, copyText) } : {})}
              {...reactions.controls}
            />
            {onReply && !onReactionChange ? (
              <UnavailableReactionControl selectedReaction={selectedReaction} />
            ) : null}
          </div>
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
  /** Null for a read-only transcript (agent-to-agent work): Copy only, no Reply or reactions. */
  readonly onReply: MessageReplyHandler | null;
  /** Null while the chat has no linked thread to react in. */
  readonly onReactionChange: MessageReactionHandler | null;
}) {
  const copyText = userMessageCopyText(message);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const selectedReaction = selectedReactionForPerson(message.reactions, currentPersonId);
  const reactions = reactionProps(message, selectedReaction, onReactionChange);

  if (authorName) {
    return (
      <div
        id={`chat-message-${message.id}`}
        tabIndex={-1}
        className={cn(
          "group/message flex items-start gap-3",
          ROW_GAP_CLASS(startsGroup),
          ROW_VISIBILITY_CLASS,
          arrived && "motion-message-enter",
        )}
        data-testid={testId}
      >
        {startsGroup ? (
          <PersonAvatar
            name={authorName}
            personId={message.authorPersonId}
            className="mt-0.5 size-7"
          />
        ) : (
          <div aria-hidden="true" className="size-7 shrink-0" />
        )}
        <div className="relative flex min-w-56 max-w-39/50 flex-col items-start">
          {startsGroup ? (
            <div className={cn("text-sm font-medium", GROUP_GAP_MB)}>{authorName}</div>
          ) : null}
          {/* Otto: Someone else's message is an outlined bubble, so a glance tells it from your
              filled one on the right and from a bot's plain reply. */}
          {message.text ? (
            <FoldedMessage className="rounded-2xl border border-foreground/12 px-3.25 py-1.75 text-sm leading-6">
              <SentMessageText
                text={message.text}
                skills={skills}
                replySourceMessageId={replySourceMessageId}
              />
            </FoldedMessage>
          ) : null}
          {/* Otto: Attachments sit under the bubble as cards, like Capy. */}
          {message.attachments?.length ? (
            <div className={message.text ? GROUP_GAP_CLASS : undefined}>
              <BotMessageAttachments
                attachments={message.attachments}
                environmentId={environmentId ?? NO_ENVIRONMENT}
              />
            </div>
          ) : null}
          <div className={toolbarClass(startsGroup)}>
            <MessageControls
              copyText={copyText}
              selectedReaction={selectedReaction}
              {...(onReply ? { onReply: () => onReply(message.id, authorName, copyText) } : {})}
              {...reactions.controls}
            />
            {onReply && !onReactionChange ? (
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
        "group/message flex items-start justify-end",
        ROW_GAP_CLASS(startsGroup),
        ROW_VISIBILITY_CLASS,
        arrived && "motion-message-enter",
      )}
      data-testid={testId}
    >
      <div className="relative flex max-w-39/50 flex-col items-end">
        {answered ? (
          <UserInputAnswerCard answered={answered} />
        ) : message.text || (showChannelOrigin && message.channelOrigin) ? (
          <div className="max-w-full rounded-2xl bg-foreground/10 px-3.5 py-2 text-sm leading-6">
            {showChannelOrigin && message.channelOrigin ? (
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {channelOriginLabel(message.channelOrigin, message.authorDisplayName)}
              </div>
            ) : null}
            {message.text ? (
              <FoldedMessage>
                <SentMessageText
                  text={message.text}
                  skills={skills}
                  replySourceMessageId={replySourceMessageId}
                />
              </FoldedMessage>
            ) : null}
          </div>
        ) : null}
        {message.attachments?.length ? (
          <div className={message.text || answered ? GROUP_GAP_CLASS : undefined}>
            <BotMessageAttachments
              attachments={message.attachments}
              environmentId={environmentId ?? NO_ENVIRONMENT}
              align="end"
            />
          </div>
        ) : null}
        <div className={cn(toolbarClass(startsGroup), "items-center gap-1")}>
          <time
            dateTime={message.createdAt}
            className="px-1 text-xs whitespace-nowrap tabular-nums text-muted-foreground"
          >
            {formatShortTimestamp(message.createdAt, timestampFormat)}
          </time>
          <MessageControls
            align="end"
            copyText={copyText}
            selectedReaction={selectedReaction}
            {...(onReply ? { onReply: () => onReply(message.id, replyLabel, copyText) } : {})}
            {...reactions.controls}
          />
          {onReply && !onReactionChange ? (
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
