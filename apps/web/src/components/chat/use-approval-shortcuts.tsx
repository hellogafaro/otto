import { useAtomValue } from "@effect/atom-react";
import { APPROVAL_KEYBINDING_COMMANDS, type ApprovalKeybindingCommand } from "@otto/contracts";
import { useEffect, useRef } from "react";

import { isCommandPaletteOpen } from "../../command-palette-bus";
import { resolveShortcutCommand, shortcutPartsForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd, KbdGroup } from "../ui/kbd";

export type ApprovalShortcutHandlers = Partial<Record<ApprovalKeybindingCommand, () => void>>;

const APPROVAL_SHORTCUT_OPTIONS = { context: { approvalPending: true } };

/**
 * Answers a waiting request from anywhere in the window with the approval shortcuts. Only the
 * chat's front request turns it on, so one key never answers two; a command without a handler
 * passes through, and a dialog or open menu keeps its own keys. Returns each shortcut's hint for its button,
 * shown only while on.
 */
export function useApprovalShortcuts(enabled: boolean, handlers: ApprovalShortcutHandlers) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isCommandPaletteOpen()) return;

      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
      ) {
        return;
      }

      const resolved = resolveShortcutCommand(event, keybindings, APPROVAL_SHORTCUT_OPTIONS);
      const command = APPROVAL_KEYBINDING_COMMANDS.find((candidate) => candidate === resolved);
      const run = command ? handlersRef.current[command] : undefined;

      if (!run) return;
      event.preventDefault();
      event.stopPropagation();

      if (!event.repeat) run();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, keybindings]);

  return (command: ApprovalKeybindingCommand) => {
    const parts = enabled
      ? shortcutPartsForCommand(keybindings, command, APPROVAL_SHORTCUT_OPTIONS)
      : null;

    return parts ? (
      <KbdGroup aria-hidden="true" className="gap-0.5">
        {parts.map((part) => (
          <Kbd key={part} variant="inline">
            {part}
          </Kbd>
        ))}
      </KbdGroup>
    ) : null;
  };
}
