import type { ProviderDriverKind } from "@otto/contracts";
import { detectComposerTrigger } from "@otto/shared/composerTrigger";

import { COMPOSER_SLASH_COMMANDS } from "../../composer-logic";
import { providerCommandPrefix } from "../chat/composer-provider-menu-items";

export interface BotPromptCommandTrigger {
  /**
   * `skill` for a `$` token anywhere, `slash-command` for a `/` that starts a line, `invite`
   * for the name after `/invite` at the start of the message.
   */
  readonly kind: "skill" | "slash-command" | "invite";
  /** Text typed after `$`, `/` or `/invite @`, used to rank the picker. */
  readonly query: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

const INVITE_PATTERN = /^\/invite\s+@?(\S*)$/;

/** The `$` skill, `/` command or `/invite` name being typed at the caret, or null when the picker stays closed. */
export function botPromptCommandTrigger(
  draft: string,
  caret: number,
): BotPromptCommandTrigger | null {
  const invite = INVITE_PATTERN.exec(draft.slice(0, caret));

  if (invite) return { kind: "invite", query: invite[1] ?? "", rangeStart: 0, rangeEnd: caret };

  const trigger = detectComposerTrigger(draft, caret);

  // The shared detector reads a bare `/model` as the classic composer's model picker.
  if (trigger?.kind === "slash-model" && draft.slice(trigger.rangeStart, caret) === "/model") {
    return { ...trigger, kind: "slash-command", query: "model" };
  }

  if (trigger?.kind !== "skill" && trigger?.kind !== "slash-command") return null;

  return {
    kind: trigger.kind,
    query: trigger.query,
    rangeStart: trigger.rangeStart,
    rangeEnd: trigger.rangeEnd,
  };
}

/**
 * Replaces the typed token with the picked `$skill ` or `/command ` text. A space right
 * after the token is absorbed so picking never leaves a double space.
 */
export function applyBotPromptCommand(
  draft: string,
  trigger: BotPromptCommandTrigger,
  inserted: string,
) {
  const before = draft.slice(0, trigger.rangeStart);
  const after = draft.slice(trigger.rangeEnd).replace(/^[ \t]/, "");

  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/**
 * The prompt as the provider reads it: a provider command that moved to its prefix because Otto
 * has one of the same name, such as `/claude:model`, goes back to `/model`.
 */
export function providerCommandPrompt(prompt: string, provider: ProviderDriverKind): string {
  const prefix = `/${providerCommandPrefix(provider)}:`;

  return prompt
    .split("\n")
    .map((line) => {
      const rest = line.slice(prefix.length);
      const name = rest.split(/\s/, 1)[0];

      return line.startsWith(prefix) && COMPOSER_SLASH_COMMANDS.some((command) => command === name)
        ? `/${rest}`
        : line;
    })
    .join("\n");
}
