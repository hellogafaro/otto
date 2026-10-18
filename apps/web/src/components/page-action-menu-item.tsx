import type { KeybindingCommand } from "@otto/contracts";
import type { ComponentProps } from "react";

import { useActivePageActions, type PageAction } from "../page-actions-registry";
import { ShortcutKbd } from "./shortcut-kbd";
import { MenuItem, MenuLetter } from "./ui/menu";

/**
 * Otto: Letters that run a More actions row while its menu is open. These verbs have no key outside
 * a menu, so a letter typed while the composer only looked focused never changes anything.
 */
export const MENU_LETTER_BY_COMMAND: Partial<Record<KeybindingCommand, string>> = {
  "item.rename": "r",
  "item.pin": "p",
  "item.markUnread": "u",
  "item.snooze": "h",
  "item.archive": "e",
  "property.assignToMe": "i",
};

/**
 * Otto: A More actions row drawn from an action list: its glyph, title and, at the right end, either
 * its menu letter or the keys of its command. The keys show only while the action is the open
 * page's, so a row in a list never shows a key that would act on something else. The letter acts
 * on the row itself, so it always shows.
 */
export function PageActionMenuItem({
  action,
  variant,
}: {
  readonly action: PageAction;
  readonly variant?: ComponentProps<typeof MenuItem>["variant"];
}) {
  const live = useActivePageActions().actions.includes(action);
  const Icon = action.icon;

  const letter = action.shortcutCommand
    ? MENU_LETTER_BY_COMMAND[action.shortcutCommand]
    : undefined;

  return (
    <MenuItem
      onClick={() => void action.run()}
      {...(action.disabled ? { disabled: true } : {})}
      {...(variant ? { variant } : {})}
    >
      {Icon ? <Icon /> : null}
      {action.title}
      {letter ? (
        <MenuLetter letter={letter} />
      ) : live && action.shortcutCommand ? (
        <ShortcutKbd command={action.shortcutCommand} className="ms-auto" />
      ) : null}
    </MenuItem>
  );
}
