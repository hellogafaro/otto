import { type RefObject, useEffect } from "react";

import type { ResolvedKeybindingsConfig } from "@otto/contracts";

import { isCommandPaletteOpen } from "../../command-palette-bus";
import { isInputFocus, resolveShortcutCommand } from "../../keybindings";
import { shouldFocusBotPromptOnEnter } from "./bot-prompt-composer.logic";

/**
 * Window-level keys for an editable bot composer: the stash shortcut stashes the draft, and
 * Enter pressed where nothing else takes it returns focus to the prompt. Letters typed
 * outside the prompt stay free for shortcuts such as J and K.
 */
export function useBotComposerKeyboard(input: {
  readonly readOnly: boolean;
  readonly focusOnEnter: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly promptInputRef: RefObject<HTMLTextAreaElement | null>;
  readonly stashCurrentPrompt: () => Promise<void>;
}) {
  const { focusOnEnter, keybindings, promptInputRef, readOnly, stashCurrentPrompt } = input;

  useEffect(() => {
    if (readOnly) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const shortcutCommand = resolveShortcutCommand(event, keybindings, {
        context: {
          modelPickerOpen: false,
          inputFocus: isInputFocus(event.target),
        },
      });

      if (shortcutCommand === "composer.stash") {
        event.preventDefault();
        event.stopPropagation();

        if (!event.repeat && !isCommandPaletteOpen()) void stashCurrentPrompt();

        return;
      }

      if (!focusOnEnter || !shouldFocusBotPromptOnEnter(event)) return;

      event.preventDefault();
      promptInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusOnEnter, keybindings, promptInputRef, readOnly, stashCurrentPrompt]);
}
