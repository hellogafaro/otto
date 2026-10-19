import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { recordTabHistory, stepTabHistory, tabHistoryOf } from "./desktop-tab-history";
import { isElectron } from "./env";
import { randomUUID } from "./lib/utils";

/**
 * Otto: The desktop app's titlebar tabs. Each tab holds one route and its own history;
 * the router stays the source of truth for the open one, so the active tab follows every
 * navigation. Back and forward walk that tab, not the shared window history.
 */
const DesktopTab = Schema.Struct({
  id: Schema.String,
  href: Schema.String,
  history: Schema.optional(Schema.Array(Schema.String)),
  index: Schema.optional(Schema.Number),
});

export type DesktopTab = typeof DesktopTab.Type;

const PersistedDesktopTabs = Schema.Struct({
  tabs: Schema.Array(DesktopTab),
  activeId: Schema.NullOr(Schema.String),
  titles: Schema.Record(Schema.String, Schema.String),
});

export const decodePersistedDesktopTabs = Schema.decodeUnknownOption(PersistedDesktopTabs);

interface DesktopTabsState {
  readonly tabs: readonly DesktopTab[];
  readonly activeId: string | null;
  /** Page titles by pathname, named by the pages themselves. */
  readonly titles: Readonly<Record<string, string>>;
  /** A ⌘- or middle-click in the sidebar sends the navigation it starts to a new tab. */
  readonly nextInNewTab: boolean;
}

export const useDesktopTabs = create<DesktopTabsState>()(
  persist((): DesktopTabsState => ({ tabs: [], activeId: null, titles: {}, nextInNewTab: false }), {
    name: "otto:desktop-tabs",
    storage: createJSONStorage(() => localStorage),
    partialize: ({ tabs, activeId, titles }) => ({
      tabs,
      activeId,
      titles: Object.fromEntries(
        Object.entries(titles).filter(([pathname]) =>
          tabs.some((tab) => desktopTabPathname(tab.href) === pathname),
        ),
      ),
    }),
    merge: (persisted, current) => {
      const decoded = decodePersistedDesktopTabs(persisted);

      return Option.isSome(decoded) ? { ...current, ...decoded.value } : current;
    },
  }),
);

function createTab(href: string): DesktopTab {
  return { id: randomUUID(), href, history: [href], index: 0 };
}

function writeTabHistory(
  tab: DesktopTab,
  history: { readonly entries: readonly string[]; readonly index: number },
): DesktopTab {
  return {
    ...tab,
    href: history.entries[history.index] ?? tab.href,
    history: [...history.entries],
    index: history.index,
  };
}

/** Inserts a tab after the open one and opens it. */
function insertTab(href: string): void {
  useDesktopTabs.setState(({ tabs, activeId }) => {
    const tab = createTab(href);
    const index = tabs.findIndex((candidate) => candidate.id === activeId);

    return {
      tabs: tabs.toSpliced(index === -1 ? tabs.length : index + 1, 0, tab),
      activeId: tab.id,
      nextInNewTab: false,
    };
  });
}

export function activeDesktopTab(): DesktopTab | null {
  const { tabs, activeId } = useDesktopTabs.getState();

  return tabs.find((tab) => tab.id === activeId) ?? null;
}

/** The router moved: the open tab takes the new route, or a new tab does after a new-tab click. */
export function syncDesktopTab(href: string): void {
  const active = activeDesktopTab();

  if (!active || useDesktopTabs.getState().nextInNewTab) {
    insertTab(href);

    return;
  }

  useDesktopTabs.setState(({ tabs }) => ({
    tabs: tabs.map((tab) => {
      if (tab.id !== active.id) return tab;

      return writeTabHistory(tab, recordTabHistory(tabHistoryOf(tab), href));
    }),
  }));
}

/** Moves within the open tab's history. Returns the route to show, or null at the end. */
export function goDesktopTabHistory(direction: "back" | "forward"): string | null {
  const active = activeDesktopTab();

  if (!active) return null;

  const next = stepTabHistory(tabHistoryOf(active), direction);

  if (!next) return null;

  const href = next.entries[next.index] ?? active.href;

  useDesktopTabs.setState(({ tabs }) => ({
    tabs: tabs.map((tab) => (tab.id === active.id ? writeTabHistory(tab, next) : tab)),
  }));

  return href;
}

/** Opens a new tab after the open one; returns the route to show. */
export function openDesktopTab(href: string): string {
  insertTab(href);

  return href;
}

/** Returns the route to show, or null when that tab is already open. */
export function activateDesktopTab(id: string): string | null {
  const { tabs, activeId } = useDesktopTabs.getState();
  const tab = tabs.find((candidate) => candidate.id === id);

  if (!tab || tab.id === activeId) return null;
  useDesktopTabs.setState({ activeId: tab.id });

  return tab.href;
}

/** Closes a tab, never the last one; returns the route to show next, or null when it stays. */
export function closeDesktopTab(id: string): string | null {
  const { tabs, activeId } = useDesktopTabs.getState();
  const index = tabs.findIndex((tab) => tab.id === id);

  if (index === -1 || tabs.length === 1) return null;
  const remaining = tabs.toSpliced(index, 1);

  if (id !== activeId) {
    useDesktopTabs.setState({ tabs: remaining });

    return null;
  }

  const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
  useDesktopTabs.setState({ tabs: remaining, activeId: next?.id ?? null });

  return next?.href ?? null;
}

export function moveDesktopTab(from: number, to: number): void {
  useDesktopTabs.setState(({ tabs }) => {
    const tab = tabs[from];

    return tab ? { tabs: tabs.toSpliced(from, 1).toSpliced(to, 0, tab) } : {};
  });
}

export function openNextNavigationInNewTab(): void {
  useDesktopTabs.setState({ nextInNewTab: true });
  // A click that never navigates must not send a later navigation to a new tab.
  window.setTimeout(() => useDesktopTabs.setState({ nextInNewTab: false }), 2000);
}

export function desktopTabPathname(href: string): string {
  return href.split(/[?#]/)[0] ?? href;
}

/**
 * Names the tab of the page that calls it, which otherwise shows its place, such as Tasks.
 * Keyed by the route the page shows, which the desktop app keeps in the URL hash.
 */
export function useDesktopTabTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;

    const pathname = isElectron
      ? desktopTabPathname(window.location.hash.slice(1) || "/")
      : window.location.pathname;

    if (useDesktopTabs.getState().titles[pathname] === title) return;
    useDesktopTabs.setState(({ titles }) => ({ titles: { ...titles, [pathname]: title } }));
  }, [title]);
}
