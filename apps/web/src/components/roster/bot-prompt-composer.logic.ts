import { createTranslator, type TranslationParams } from "@otto/client-runtime/i18n";
import {
  type ComposerBotMention,
  resolveComposerBotMention,
} from "@otto/shared/composerBotMentions";

import type { ComposerProviderCatalog } from "../chat/composer-provider-menu-items";
import { botPromptCommandTrigger } from "./bot-prompt-commands.logic";
import type { BotPromptMentionBot } from "./bot-prompt-mentions.logic";

export type BotComposerState = "stopped" | "sending" | "ready" | "empty";

/**
 * The composer's visible state. `stopped` means sending is unavailable, `sending` means a
 * turn is still running, `ready` means this draft can go now. A running turn never blocks a
 * ready draft: a follow-up still sends and queues behind the turn.
 */
export function botComposerState(input: {
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly canSubmit: boolean;
}): BotComposerState {
  if (input.disabled) return "stopped";

  if (input.busy) return "sending";

  return input.canSubmit ? "ready" : "empty";
}

export function isBotPromptExpanded(prompt: string): boolean {
  return prompt.includes("\n") || prompt.length > 80;
}

export function canSubmitBotPrompt(disabled: boolean, prompt: string, fileCount: number): boolean {
  return !disabled && (prompt.trim().length > 0 || fileCount > 0);
}

export function isBotPromptSubmissionCurrent(
  submissionRevision: number,
  currentRevision: number,
): boolean {
  return submissionRevision === currentRevision;
}

/** Appends a bot mention token, `@Name` or `@bot:<id>`, with the spacing the parser needs. */
export function appendBotMention(draft: string, mention: string): string {
  return `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${mention} `;
}

/**
 * Enter returns to the prompt only where nothing else would take it: not in a field,
 * on a button, link or option, or inside a dialog or menu.
 */
export function shouldFocusBotPromptOnEnter(event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly target: EventTarget | null;
}): boolean {
  return (
    event.key === "Enter" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !(
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, button, summary, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      ) !== null
    )
  );
}

export type MentionBot = BotPromptMentionBot;

export type BotMention = ComposerBotMention;

// Resolves the latest whole-word @BotName or @bot:<id>. A bare name shared by two bots
// cannot be routed honestly; the @ menu inserts the id token for those.
export function resolveBotMention(prompt: string, bots: ReadonlyArray<MentionBot>): BotMention {
  return resolveComposerBotMention(prompt, bots);
}

type TranslateMessage = (message: string, params?: TranslationParams) => string;

const translateEnglish: TranslateMessage = createTranslator("en").translate;

export function botMentionHint(
  mention: BotMention,
  t: TranslateMessage = translateEnglish,
): string | null {
  return mention.kind === "ambiguous"
    ? t("More than one bot here is named {name}. Pick one from the @ menu to mention it.", {
        name: mention.name,
      })
    : null;
}

export function restoreBotStashPrompt(currentPrompt: string, stashedPrompt: string): string {
  if (stashedPrompt.length === 0) return currentPrompt;

  return currentPrompt.trim().length > 0
    ? `${currentPrompt.trimEnd()}\n\n${stashedPrompt}`
    : stashedPrompt;
}

/**
 * The `$` or `/` token the command picker opens for. A null catalog still opens it so
 * the picker can say a provider is missing; only an omitted catalog turns it off.
 */
export function botPromptCommandMenuTrigger(input: {
  readonly draft: string;
  readonly caret: number | null;
  readonly readOnly: boolean;
  readonly commandCatalog: ComposerProviderCatalog | null | undefined;
}) {
  if (input.readOnly || input.commandCatalog === undefined || input.caret === null) return null;

  return botPromptCommandTrigger(input.draft, input.caret);
}
