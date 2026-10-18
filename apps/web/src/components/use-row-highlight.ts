import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import { isInputFocus, resolveShortcutCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";

let mountedLists = 0;

const ROW_STEPS = new Map([
  ["thread.next", 1],
  ["thread.previous", -1],
]);

/** True while an index page's rows own J and K, so the chat list leaves them alone. */
export function isRowListMounted(): boolean {
  return mountedLists > 0;
}

/**
 * Otto: J and K (Next and Previous) walk an index page's rows in the order they show, with the
 * row's hover wash, taking focus off any button so Enter opens the row; Escape or moving the
 * mouse lets go. Keys typed in an open dialog or menu stay theirs. Rows carry `data-row-key`,
 * which DataTable and DataGrid set, so a collapsed group is skipped. The page publishes the held
 * row's item keys while there is one.
 */
export function useRowHighlight<T>(
  rows: readonly T[],
  getKey: (row: T) => string,
  onOpen: (row: T) => void,
): T | null {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const pointer = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const held = useRef<string | null>(null);
  const highlighted = rows.find((row) => getKey(row) === highlightedKey) ?? null;

  useEffect(() => {
    mountedLists += 1;

    return () => {
      mountedLists -= 1;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isInputFocus(event.target)) return;

      if (
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-keybinding-capture]',
        )
      ) {
        return;
      }

      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

      if (highlighted && plain && event.key === "Escape") {
        held.current = null;
        setHighlightedKey(null);
      } else if (
        highlighted &&
        plain &&
        event.key === "Enter" &&
        !(event.target instanceof Element && event.target.closest("a, button"))
      ) {
        onOpen(highlighted);
      } else {
        const command = resolveShortcutCommand(event, keybindings, {
          context: { inputFocus: false },
        });

        const step = ROW_STEPS.get(String(command)) ?? 0;
        const shown = [...document.querySelectorAll<HTMLElement>("[data-row-key]")];

        if (step === 0 || shown.length === 0) return;
        const index = shown.findIndex((element) => element.dataset.rowKey === held.current);

        const next =
          index === -1
            ? step === 1
              ? shown[0]
              : shown.at(-1)
            : shown[Math.min(Math.max(index + step, 0), shown.length - 1)];

        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        next?.scrollIntoView({ block: "nearest" });
        held.current = next?.dataset.rowKey ?? null;
        setHighlightedKey(held.current);
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [highlighted, keybindings, onOpen]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const last = pointer.current;
      pointer.current = { x: event.clientX, y: event.clientY };

      if (!last || (last.x === event.clientX && last.y === event.clientY)) return;
      held.current = null;
      setHighlightedKey(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  return highlighted;
}
