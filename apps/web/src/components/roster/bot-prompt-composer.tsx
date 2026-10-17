import {
  RiArrowUpLine,
  RiAtLine,
  RiCornerDownRightLine,
  RiAttachment2,
  RiAddLine,
  RiCloseLine,
} from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import { composerActionIsDictation } from "@otto/client-runtime/dictation";
import type { EnvironmentId } from "@otto/contracts";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { shortcutLabelForCommand } from "../../keybindings";
import { useEnvironmentComposerDictation } from "../../lib/use-environment-composer-dictation";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { ComposerBanner } from "../chat/composer-banner";
import { DictationControls } from "../chat/dictation-controls";
import { DictationMeter } from "../chat/dictation-meter";
import { FileLightbox } from "../library/file-lightbox";
import { ComposerStashBadge } from "../chat/composer-stash-badge";
import { ComposerStashMenu } from "../chat/composer-stash-menu";
import {
  BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME,
  BOT_COMPOSER_SURFACE_CLASS_NAME,
  CONVERSATION_MEASURE_CLASS_NAME,
} from "./bot-conversation-presentation";
import type { MessageReplyTarget } from "../chat/message-controls";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toast } from "sonner";
import { useI18n } from "../../i18n";
import { BotComposerModelControl } from "./bot-composer-model-control";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useRosterStore } from "./roster-store";
import { attachmentLightboxFile, downloadAttachment } from "./bot-message-attachments";
import { BotPromptAttachments } from "./bot-prompt-attachments";
import {
  appendBotMention,
  botComposerState,
  botMentionHint,
  botPromptCommandMenuTrigger,
  canSubmitBotPrompt,
  isBotPromptExpanded,
  type MentionBot,
  resolveBotMention,
} from "./bot-prompt-composer.logic";
import {
  applyBotPromptMention,
  botPromptMention,
  botPromptMentionTrigger,
  type BotPromptMentionItem,
  findNameMentions,
  serializeBotPromptMentions,
} from "./bot-prompt-mentions.logic";
import { applyBotPromptCommand, botPromptCommandTrigger } from "./bot-prompt-commands.logic";
import { BotPromptCommandMenu, type BotPromptCommandMenuHandle } from "./bot-prompt-command-menu";
import type { ComposerProviderCatalog } from "../chat/composer-provider-menu-items";
import {
  BotPromptMentionHighlights,
  BotPromptMentionMenu,
  type BotPromptMentionMenuHandle,
  type BotPromptMentionScope,
  useBotPromptMentionNames,
} from "./bot-prompt-mentions";
import { useBotComposerDraft } from "./use-bot-composer-draft";
import { useBotComposerKeyboard } from "./use-bot-composer-keyboard";

export {
  appendBotMention,
  botComposerState,
  type BotComposerState,
  type BotMention,
  botMentionHint,
  botPromptCommandMenuTrigger,
  canSubmitBotPrompt,
  isBotPromptExpanded,
  isBotPromptSubmissionCurrent,
  type MentionBot,
  resolveBotMention,
  restoreBotStashPrompt,
  shouldFocusBotPromptForKey,
} from "./bot-prompt-composer.logic";

const EMPTY_MENTION_BOTS: ReadonlyArray<MentionBot> = [];

export function BotPromptComposer({
  botName,
  draftKey,
  disabled,
  readOnly = false,
  typeToFocus = true,
  mentionBots = EMPTY_MENTION_BOTS,
  mentionEveryone = false,
  mentionPeople,
  mentionScope = null,
  mentionWork = null,
  commandCatalog,
  busy = false,
  pendingActionSlot = null,
  quietSurface = false,
  layout = "conversation",
  inputLabel,
  submitLabel,
  placeholder,
  replyPreview,
  onCancelReply,
  sendBlockedDescriptionId,
  onAddressedBotChange,
  onSubmit,
}: {
  botName: string;
  draftKey?: string;
  disabled: boolean;
  readOnly?: boolean;
  /** Off while something else on the page owns printable keys, like an open question's letter shortcuts. */
  typeToFocus?: boolean;
  mentionBots?: ReadonlyArray<MentionBot>;
  /** Offers `@everyone` in the picker; group chats only. */
  mentionEveryone?: boolean;
  /** Other people in a group chat, offered in the picker. */
  mentionPeople?: ReadonlyArray<{ readonly personId: string; readonly displayName: string }>;
  /** Enables `@browser` and `@chat:` mentions for this chat's environment. */
  mentionScope?: BotPromptMentionScope | null;
  /** Otto: Without a chat scope, offers this environment's tasks and projects, as in comments. */
  mentionWork?: EnvironmentId | null;
  /**
   * The answering provider's skills and commands, offered by the `$` and `/` pickers.
   * Null keeps the pickers open with a connect-a-provider line; omit it to turn them off.
   */
  commandCatalog?: ComposerProviderCatalog | null;
  /** A turn is still running, so sending again would queue behind it. */
  busy?: boolean;
  /** Rendered above the prompt box so a pending decision reads as part of the composer. */
  pendingActionSlot?: ReactNode;
  quietSurface?: boolean;
  /** `inline` sits in page content, like a comment box, without the conversation gutters. */
  layout?: "conversation" | "inline";
  /** Names the text box; defaults to "Message {botName}". */
  inputLabel?: string;
  /** Names the send button; defaults to "Send message". */
  submitLabel?: string;
  placeholder?: string;
  replyPreview?: MessageReplyTarget | null;
  onCancelReply?: () => void;
  /** Id of the element explaining why Send is off, announced with the Send button. */
  sendBlockedDescriptionId?: string | undefined;
  /** Reports the bot the draft's mention addresses, or null when it addresses none. */
  onAddressedBotChange?: (botId: string | null) => void;
  onSubmit: (prompt: string, files: readonly File[], respondingBotId?: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // A bot chat keys its draft by bot id; group composers namespace
  // theirs, so a key that names a live bot is the one composer that speaks for it.
  const composerBotId = useRosterStore((state) =>
    draftKey !== undefined &&
    state.bots.some((bot) => bot.id === draftKey && bot.archivedAt === null)
      ? draftKey
      : null,
  );

  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const {
    draft,
    persistDraft,
    dictationGeneration,
    attachments,
    expandedAttachmentId,
    setExpandedAttachmentId,
    addFiles,
    removeAttachment,
    failedAttachmentIds,
    markAttachmentPreviewFailed,
    isStashMenuOpen,
    setIsStashMenuOpen,
    stashPulse,
    stashQueue,
    restoreStashEntry,
    deleteStashEntry,
    stashCurrentPrompt,
    submitDraft,
  } = useBotComposerDraft({ draftKey, promptInputRef });

  const expandedIndex = attachments.findIndex(
    (attachment) => attachment.id === expandedAttachmentId,
  );

  const expandedAttachment = attachments[expandedIndex];
  const previousAttachment = expandedIndex > 0 ? attachments[expandedIndex - 1] : undefined;
  const nextAttachment = expandedIndex >= 0 ? attachments[expandedIndex + 1] : undefined;

  const mentionHintId = useId();
  const draftMention = resolveBotMention(draft, mentionBots);
  const mentionHint = botMentionHint(draftMention, t);
  const addressedBotId = draftMention.kind === "bot" ? draftMention.botId : null;
  useEffect(() => {
    onAddressedBotChange?.(addressedBotId);
  }, [addressedBotId, onAddressedBotChange]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionMenuRef = useRef<BotPromptMentionMenuHandle>(null);
  const commandMenuRef = useRef<BotPromptCommandMenuHandle>(null);
  const mentionListboxId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissedMentionStart, setDismissedMentionStart] = useState<number | null>(null);
  const [dismissedCommandStart, setDismissedCommandStart] = useState<number | null>(null);
  const [activeMentionOptionId, setActiveMentionOptionId] = useState<string | null>(null);

  const expanded = attachments.length > 0 || replyPreview != null || isBotPromptExpanded(draft);

  const mentionNames = useBotPromptMentionNames({
    environmentId: mentionScope?.environmentId ?? mentionWork,
    bots: mentionBots,
    everyone: mentionEveryone,
    people: mentionPeople,
    workOnly: mentionScope === null,
  });

  const draftMentions = useMemo(() => findNameMentions(draft, mentionNames), [draft, mentionNames]);

  const mentionHighlightsRef = useRef<HTMLDivElement>(null);

  const promptTextClassName = cn(
    "text-base leading-5 sm:text-sm",
    expanded ? "px-3.5 pb-10 pt-3" : "min-h-10 px-10.5 py-2.5",
  );

  const mentionsEnabled =
    !readOnly && (mentionScope !== null || mentionWork !== null || mentionBots.length > 0);

  const candidateMentionTrigger =
    mentionsEnabled && caret !== null ? botPromptMentionTrigger(draft, caret) : null;

  const mentionTrigger =
    candidateMentionTrigger && candidateMentionTrigger.rangeStart !== dismissedMentionStart
      ? candidateMentionTrigger
      : null;

  const selectMention = useCallback(
    (item: BotPromptMentionItem) => {
      const input = promptInputRef.current;

      if (!input || input.selectionStart === null) return;
      const trigger = botPromptMentionTrigger(input.value, input.selectionStart);

      if (!trigger) return;
      const next = applyBotPromptMention(input.value, trigger, item);
      persistDraft(next.text);
      setCaret(next.caret);
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    [persistDraft],
  );

  const candidateCommandTrigger = botPromptCommandMenuTrigger({
    draft,
    caret,
    readOnly,
    commandCatalog,
  });

  const commandTrigger =
    candidateCommandTrigger && candidateCommandTrigger.rangeStart !== dismissedCommandStart
      ? candidateCommandTrigger
      : null;

  const selectCommand = useCallback(
    (inserted: string) => {
      const input = promptInputRef.current;

      if (!input || input.selectionStart === null) return;
      const trigger = botPromptCommandTrigger(input.value, input.selectionStart);

      if (!trigger) return;
      const next = applyBotPromptCommand(input.value, trigger, inserted);
      persistDraft(next.text);
      setCaret(next.caret);
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    [persistDraft],
  );

  const closeCommandMenu = useCallback(() => {
    const input = promptInputRef.current;

    const trigger =
      input && input.selectionStart !== null
        ? botPromptCommandTrigger(input.value, input.selectionStart)
        : null;

    setDismissedCommandStart(trigger?.rangeStart ?? null);
  }, []);

  const closeMentionMenu = useCallback(() => {
    const input = promptInputRef.current;

    const trigger =
      input && input.selectionStart !== null
        ? botPromptMentionTrigger(input.value, input.selectionStart)
        : null;

    setDismissedMentionStart(trigger?.rangeStart ?? null);
  }, []);

  const canSubmit = canSubmitBotPrompt(disabled, draft, attachments.length);
  const composerState = botComposerState({ disabled, busy, canSubmit });
  useBotComposerKeyboard({
    readOnly,
    typeToFocus,
    keybindings,
    promptInputRef,
    persistDraft,
    stashCurrentPrompt,
  });

  const dictation = useEnvironmentComposerDictation({
    threadId: draftKey ?? botName,
    draftId: draftKey ?? botName,
    generation: dictationGeneration,
    getDraft: () => {
      const input = promptInputRef.current;
      const text = input?.value ?? draft;
      const start = input?.selectionStart ?? text.length;

      return { text, selection: { start, end: input?.selectionEnd ?? start } };
    },
    applyDraft: (next) => {
      persistDraft(next.text);
      // Restore the caret after React commits the merged value.
      window.requestAnimationFrame(() => {
        const input = promptInputRef.current;

        if (!input || input.value !== next.text) return;
        input.focus();
        input.setSelectionRange(next.selection.start, next.selection.end);
      });
    },
  });

  const retryDictation = useRef(dictation.onRetry);
  retryDictation.current = dictation.onRetry;

  useEffect(() => {
    if (dictation.status !== "failed" || !dictation.errorMessage) return;
    const retry = retryDictation.current;

    toast.error(t("Dictation couldn't be completed"), {
      id: "dictation-failed",
      description: dictation.errorMessage,
      ...(retry ? { action: { label: t("Retry"), onClick: retry } } : {}),
    });
  }, [dictation.errorMessage, dictation.status, t]);

  // While dictating, + turns into × (cancel) and the row shows the voice and the time.
  const dictating =
    dictation.status === "requesting" ||
    dictation.status === "recording" ||
    dictation.status === "transcribing";

  const showDictation =
    !readOnly &&
    composerActionIsDictation({
      hasDraft: draft.trim().length > 0 || attachments.length > 0,
      // A failed dictation is retried from its toast, so it gives the slot back.
      status: dictation.status === "failed" ? "idle" : dictation.status,
    });

  return (
    <form
      data-chat-composer-form="true"
      data-state={composerState}
      aria-disabled={readOnly || undefined}
      className={
        layout === "inline"
          ? "w-full"
          : "w-full px-gutter-48rem pb-4 pt-2 sm:px-gutter-48rem-wide sm:pb-6"
      }
      onSubmit={(event) => {
        event.preventDefault();
        submitDraft({
          disabled,
          mentionBots,
          onSubmit: (prompt, files, respondingBotId) =>
            onSubmit(serializeBotPromptMentions(prompt, mentionNames), files, respondingBotId),
          // Sending with Enter settles a failed dictation, so the empty composer returns to the mic.
          onCleared: () => {
            if (dictation.status === "failed") dictation.onCancel();
          },
        });
      }}
    >
      <div className={layout === "inline" ? undefined : CONVERSATION_MEASURE_CLASS_NAME}>
        <ComposerBanner.Dock className="relative z-0">
          <ComposerBanner.Column>
            {isStashMenuOpen ? (
              <ComposerStashMenu
                entries={stashQueue}
                stashShortcutLabel={shortcutLabelForCommand(keybindings, "composer.stash")}
                onRestore={restoreStashEntry}
                onDelete={deleteStashEntry}
                onClose={() => setIsStashMenuOpen(false)}
              />
            ) : null}
          </ComposerBanner.Column>
          <ComposerStashBadge
            count={stashQueue.length}
            menuOpen={isStashMenuOpen}
            pulseKey={stashPulse.key}
            pulsing={stashPulse.active}
            onToggleMenu={() => setIsStashMenuOpen((open) => !open)}
          />
        </ComposerBanner.Dock>
        {composerBotId !== null ? (
          <BotComposerModelControl botId={composerBotId} disabled={readOnly} />
        ) : null}
        <AnimatePresence initial={false}>
          {pendingActionSlot ? (
            <motion.div
              key="pending-action"
              data-testid="bot-pending-action-motion"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.16, ease: "easeOut" }}
            >
              {pendingActionSlot}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="relative">
          {mentionTrigger ? (
            <BotPromptMentionMenu
              ref={mentionMenuRef}
              listboxId={mentionListboxId}
              trigger={mentionTrigger}
              scope={mentionScope}
              workEnvironmentId={mentionWork}
              bots={mentionBots}
              everyone={mentionEveryone}
              {...(mentionPeople ? { people: mentionPeople } : {})}
              onSelect={selectMention}
              onClose={closeMentionMenu}
              onActiveOptionChange={setActiveMentionOptionId}
            />
          ) : null}
          {commandTrigger && commandCatalog !== undefined ? (
            <BotPromptCommandMenu
              ref={commandMenuRef}
              trigger={commandTrigger}
              catalog={commandCatalog}
              onSelect={selectCommand}
              onClose={closeCommandMenu}
            />
          ) : null}
          <div
            data-testid="bot-prompt-composer"
            data-expanded={expanded || undefined}
            className={cn(
              "relative flex min-h-10 flex-col overflow-hidden rounded-xl border shadow-composer-float transition-composer-shape duration-200 ease-out",
              quietSurface
                ? BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME
                : BOT_COMPOSER_SURFACE_CLASS_NAME,
              pendingActionSlot ? "rounded-t-md border-t-transparent" : undefined,
            )}
          >
            {/* One line, always the same height, so starting a reply never resizes the box. */}
            {replyPreview ? (
              <div
                className="mx-1.5 mt-1.5 flex h-8 items-center gap-2 rounded-md bg-foreground/8 ps-2.5 pe-1 text-xs"
                data-testid="composer-reply-preview"
              >
                <RiCornerDownRightLine
                  aria-hidden="true"
                  className="size-3.5 shrink-0 opacity-60"
                />
                <span className="shrink-0 font-medium">{replyPreview.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {replyPreview.text}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-row"
                        variant="ghost"
                        aria-label={t("Cancel reply")}
                        onClick={onCancelReply}
                      />
                    }
                  >
                    <RiCloseLine />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{t("Cancel reply")}</TooltipPopup>
                </Tooltip>
              </div>
            ) : null}
            <BotPromptAttachments
              attachments={attachments}
              failedIds={failedAttachmentIds}
              className="px-1.5 pt-1.5"
              onExpand={setExpandedAttachmentId}
              onPreviewError={markAttachmentPreviewFailed}
              onRemove={removeAttachment}
            />
            <div className="relative">
              {draftMentions.length > 0 ? (
                <BotPromptMentionHighlights
                  ref={mentionHighlightsRef}
                  text={draft}
                  mentions={draftMentions}
                  className={promptTextClassName}
                />
              ) : null}
              <textarea
                ref={promptInputRef}
                aria-label={inputLabel ?? t("Message {name}", { name: botName })}
                data-testid="bot-prompt-input"
                placeholder={
                  placeholder ?? inputLabel ?? t("Message {name}, @ for context", { name: botName })
                }
                rows={1}
                value={draft}
                readOnly={readOnly}
                tabIndex={readOnly ? -1 : undefined}
                aria-autocomplete={mentionsEnabled ? "list" : undefined}
                aria-controls={
                  mentionTrigger && activeMentionOptionId ? mentionListboxId : undefined
                }
                aria-activedescendant={(mentionTrigger && activeMentionOptionId) || undefined}
                className={cn(
                  "field-sizing-content relative block max-h-56 w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground/70",
                  promptTextClassName,
                  draftMentions.length > 0 && "text-transparent caret-foreground",
                )}
                onScroll={(event) => {
                  if (mentionHighlightsRef.current) {
                    mentionHighlightsRef.current.scrollTop = event.currentTarget.scrollTop;
                  }
                }}
                onChange={(event) => {
                  const { selectionStart, value } = event.currentTarget;
                  persistDraft(value);
                  setCaret(selectionStart);

                  if (botPromptMentionTrigger(value, selectionStart) === null) {
                    setDismissedMentionStart(null);
                  }

                  if (botPromptCommandTrigger(value, selectionStart) === null) {
                    setDismissedCommandStart(null);
                  }
                }}
                onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                onBlur={() => setCaret(null)}
                onKeyDown={(event) => {
                  if (
                    (mentionTrigger && mentionMenuRef.current?.handleKeyDown(event)) ||
                    (commandTrigger && commandMenuRef.current?.handleKeyDown(event))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();

                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                onPaste={(event) => {
                  if (!readOnly && event.clipboardData.files.length > 0) {
                    addFiles(event.clipboardData.files);
                  }
                }}
              />
            </div>
            <div
              data-testid="bot-prompt-controls"
              /* Pinned to the box corners in every state: growing the draft must not move
             the add or send button out from under the pointer. */
              className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center justify-between"
            >
              <div
                className={cn(
                  "pointer-events-auto flex min-w-0 items-center gap-1",
                  dictating && "flex-1 pe-1",
                )}
              >
                {dictating ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="secondary"
                            aria-label={t("Cancel dictation")}
                            onClick={dictation.onCancel}
                          />
                        }
                      >
                        <RiCloseLine />
                      </TooltipTrigger>
                      <TooltipPopup side="top">{t("Cancel dictation")}</TooltipPopup>
                    </Tooltip>
                    <DictationMeter stream={dictation.stream} />
                  </>
                ) : mentionBots.length === 0 ? (
                  // Attaching is the only prompt action here, so the button opens the picker.
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={t("Attach file")}
                          disabled={readOnly}
                          onClick={() => fileInputRef.current?.click()}
                        />
                      }
                    >
                      <RiAddLine />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{t("Attach file")}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={t("Add to prompt")}
                          disabled={readOnly}
                        />
                      }
                    >
                      <RiAddLine />
                    </MenuTrigger>
                    <MenuPopup align="start" side="top" sideOffset={8}>
                      <MenuItem onClick={() => fileInputRef.current?.click()}>
                        <RiAttachment2 />
                        {t("Attach file")}
                      </MenuItem>
                      {mentionBots.map((bot) => {
                        const mention = botPromptMention(bot, mentionBots);

                        return (
                          <MenuItem
                            key={bot.id}
                            onClick={() => persistDraft(appendBotMention(draft, mention.source))}
                          >
                            <RiAtLine />
                            {t("Mention {name}", { name: bot.name })}
                            {mention.detail ? ` (${mention.detail})` : ""}
                            {bot.canTakeWork === false ? (
                              <span className="ms-auto ps-3 text-xs text-muted-foreground">
                                {t("Cannot take handed-off work")}
                              </span>
                            ) : null}
                          </MenuItem>
                        );
                      })}
                    </MenuPopup>
                  </Menu>
                )}
              </div>
              {showDictation ? (
                <div
                  className="pointer-events-auto size-7 shrink-0"
                  data-bot-prompt-dictation="true"
                >
                  <DictationControls
                    appearance="send-slot"
                    {...dictation}
                    onBlockedPress={(reason) => toast.info(reason.replace(/\.$/, ""))}
                  />
                </div>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  variant="primary"
                  aria-label={submitLabel ?? t("Send message")}
                  aria-describedby={
                    [mentionHint ? mentionHintId : null, disabled ? sendBlockedDescriptionId : null]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  disabled={!canSubmit || mentionHint !== null}
                  className="pointer-events-auto"
                >
                  <RiArrowUpLine />
                </Button>
              )}
            </div>
          </div>
        </div>
        {mentionHint ? (
          <p id={mentionHintId} role="status" className="px-4 pt-2 text-xs text-muted-foreground">
            {mentionHint}
          </p>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        aria-label={t("Attach files")}
        multiple
        disabled={readOnly}
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files) addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <FileLightbox
        file={
          expandedAttachment
            ? attachmentLightboxFile(
                { name: expandedAttachment.file.name, mimeType: expandedAttachment.file.type },
                expandedAttachment.previewUrl,
              )
            : null
        }
        hasSiblings={attachments.length > 1}
        onPrevious={
          previousAttachment ? () => setExpandedAttachmentId(previousAttachment.id) : undefined
        }
        onNext={nextAttachment ? () => setExpandedAttachmentId(nextAttachment.id) : undefined}
        onDownload={() => {
          if (expandedAttachment) {
            downloadAttachment(expandedAttachment.previewUrl, expandedAttachment.file.name);
          }
        }}
        onClose={() => setExpandedAttachmentId(null)}
      />
    </form>
  );
}
