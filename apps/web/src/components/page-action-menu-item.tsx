import type { ComponentProps } from "react";

import { useActivePageActions, type PageAction } from "../page-actions-registry";
import { ShortcutKbd } from "./shortcut-kbd";
import { MenuItem } from "./ui/menu";

/**
 * Otto: A More actions row drawn from an action list: its glyph, title and, at the right end, the
 * keys of its command. The keys show only while the action is the open page's, so a row in a list
 * never shows a key that would act on something else.
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

  return (
    <MenuItem
      onClick={() => void action.run()}
      {...(action.disabled ? { disabled: true } : {})}
      {...(variant ? { variant } : {})}
    >
      {Icon ? <Icon /> : null}
      {action.title}
      {live && action.shortcutCommand ? (
        <ShortcutKbd command={action.shortcutCommand} className="ms-auto" />
      ) : null}
    </MenuItem>
  );
}
