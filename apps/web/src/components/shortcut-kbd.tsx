import { useAtomValue } from "@effect/atom-react";
import type { KeybindingCommand } from "@otto/contracts";

import { shortcutPartsForCommand } from "../keybindings";
import { cn } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Kbd, KbdGroup } from "./ui/kbd";

/**
 * Otto: A command's current keys, one Kbd cap per key, read from the person's
 * keybindings so a rebound key shows its new caps. Renders nothing while the command
 * has no key here.
 */
export function ShortcutKbd({
  command,
  variant,
  className,
}: {
  readonly command: KeybindingCommand;
  readonly variant?: "inline";
  readonly className?: string;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const parts = shortcutPartsForCommand(keybindings, command);

  if (!parts) return null;

  return (
    <KbdGroup aria-hidden="true" className={cn("gap-0.5", className)}>
      {parts.map((part) => (
        <Kbd key={part} {...(variant ? { variant } : {})}>
          {part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
