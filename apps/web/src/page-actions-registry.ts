import type { KeybindingCommand } from "@otto/contracts";
import type { RemixiconComponentType } from "@remixicon/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Otto: One action the open page offers: a chat, a task page or an index page such as Tasks. The
 * page's More actions menu, the command palette's group for it and its keyboard shortcut all run
 * the same entry, so an action never exists in one place without the others.
 */
export interface PageAction {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: RemixiconComponentType;
  readonly searchTerms: ReadonlyArray<string>;
  readonly shortcutCommand?: KeybindingCommand;
  /** Shown but not runnable right now, such as archiving a chat while it runs. */
  readonly disabled?: boolean;
  readonly run: () => Promise<void> | void;
}

/** The open page's actions and the palette group label they show under, such as This chat. */
export interface PageActions {
  readonly label: string;
  readonly actions: ReadonlyArray<PageAction>;
}

const NO_ACTIONS: PageActions = { label: "", actions: [] };

let entries: ReadonlyArray<{ readonly owner: symbol; readonly value: PageActions }> = [];

let active: PageActions = NO_ACTIONS;

const listeners = new Set<() => void>();

function publish(next: typeof entries): void {
  entries = next;
  active = entries.at(-1)?.value ?? NO_ACTIONS;

  for (const listener of listeners) listener();
}

/**
 * The newest registration is the live one; a page that mounts inside another takes over until it
 * unmounts. Returns the cleanup that removes only this owner's entry.
 */
export function registerPageActions(owner: symbol, value: PageActions): () => void {
  const index = entries.findIndex((entry) => entry.owner === owner);

  publish(
    index === -1
      ? [...entries, { owner, value }]
      : entries.map((entry, position) => (position === index ? { owner, value } : entry)),
  );

  return () => unregisterPageActions(owner);
}

export function unregisterPageActions(owner: symbol): void {
  publish(entries.filter((entry) => entry.owner !== owner));
}

export function activePageActions(): PageActions {
  return active;
}

/** The live page's runnable action for a command, when it has one. */
export function pageActionForCommand(command: KeybindingCommand): PageAction | null {
  return (
    active.actions.find((action) => action.shortcutCommand === command && !action.disabled) ?? null
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useActivePageActions(): PageActions {
  return useSyncExternalStore(subscribe, activePageActions, () => NO_ACTIONS);
}

/**
 * Publishes a page's actions while it is mounted. A changed list replaces the entry in place, so
 * the page keeps its place under a page that mounted after it. Pass a memoized list.
 */
export function usePageActions(label: string, actions: ReadonlyArray<PageAction>): void {
  const owner = useRef(Symbol("page-actions"));

  useEffect(() => {
    registerPageActions(owner.current, { label, actions });
  }, [actions, label]);

  useEffect(() => {
    const current = owner.current;

    return () => unregisterPageActions(current);
  }, []);
}
