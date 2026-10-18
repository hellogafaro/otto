import { useAtomValue } from "@effect/atom-react";
import type { KeybindingCommand } from "@otto/contracts";

import { shortcutLabelForCommand } from "../keybindings";
import { useShortcutHintsVisible } from "../shortcut-hints";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Kbd } from "./ui/kbd";

/**
 * Otto: Place inside a positioned control to show its shortcut under it, end-aligned, while
 * the command modifier is held. Nothing renders when the command has no binding.
 */
export function ShortcutHint({ command }: { readonly command: KeybindingCommand }) {
  const visible = useShortcutHintsVisible();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const label = visible ? shortcutLabelForCommand(keybindings, command) : null;

  if (!label) return null;

  return (
    <Kbd aria-hidden variant="shortcut" className="absolute top-full right-0 z-50 mt-1.5">
      {label}
    </Kbd>
  );
}
