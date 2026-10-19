/** How far back one desktop tab remembers. Older entries drop off the front. */
export const DESKTOP_TAB_HISTORY_LIMIT = 50;

export interface TabHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

export function tabHistoryOf(tab: {
  readonly href: string;
  readonly history?: readonly string[] | undefined;
  readonly index?: number | undefined;
}): TabHistory {
  const raw = tab.history && tab.history.length > 0 ? tab.history : [tab.href];
  const entries = raw.slice(-DESKTOP_TAB_HISTORY_LIMIT);
  const dropped = raw.length - entries.length;
  const rawIndex = Math.trunc(tab.index ?? entries.length - 1 + dropped);
  const index = Math.min(Math.max(rawIndex - dropped, 0), entries.length - 1);

  return { entries, index };
}

/** A real navigation. The same href is not recorded again, so a tab switch is a no-op. */
export function recordTabHistory(history: TabHistory, href: string): TabHistory {
  if (history.entries[history.index] === href) return history;

  const entries = [...history.entries.slice(0, history.index + 1), href].slice(
    -DESKTOP_TAB_HISTORY_LIMIT,
  );

  return { entries, index: entries.length - 1 };
}

export function stepTabHistory(
  history: TabHistory,
  direction: "back" | "forward",
): TabHistory | null {
  const index = history.index + (direction === "back" ? -1 : 1);

  if (index < 0 || index >= history.entries.length) return null;

  return { entries: history.entries, index };
}

export function canGoBack(history: TabHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: TabHistory): boolean {
  return history.index < history.entries.length - 1;
}
