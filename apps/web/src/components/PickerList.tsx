import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export interface PickerItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly hint?: string;
}

/** The popup surface menus use, for pickers that keep focus in a text field. */
export const PICKER_SURFACE_CLASS =
  "rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-[0_18px_48px_-24px_rgb(0_0_0/55%)] dark:shadow-[0_22px_56px_-24px_rgb(0_0_0/80%)]";

/**
 * Otto: A keyboard-driven list for pickers whose focus stays in a text field
 * (the editor's / and @ menus, Add resource): rows look like menu items and
 * the active row follows the arrow keys.
 */
export function PickerList<Item extends PickerItem>({
  items,
  active,
  emptyLabel,
  onActiveChange,
  onPick,
}: {
  readonly items: ReadonlyArray<Item>;
  readonly active: number;
  readonly emptyLabel: string;
  readonly onActiveChange: (index: number) => void;
  readonly onPick: (item: Item) => void;
}) {
  if (items.length === 0) {
    return <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div role="listbox" className="flex flex-col">
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActiveChange(index)}
          onClick={() => onPick(item)}
          className={cn(
            "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
            index === active && "bg-secondary",
          )}
        >
          {item.icon}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint ? (
            <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Arrow keys move the active row and Enter picks it; returns whether the key was handled. */
export function handlePickerKey<Item>(
  key: string,
  items: ReadonlyArray<Item>,
  active: number,
  setActive: (index: number) => void,
  pick: (item: Item) => void,
): boolean {
  if (items.length === 0) return false;

  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    setActive((active + step + items.length) % items.length);

    return true;
  }

  if (key === "Enter" || key === "Tab") {
    const item = items[Math.min(active, items.length - 1)];

    if (item !== undefined) pick(item);

    return item !== undefined;
  }

  return false;
}
