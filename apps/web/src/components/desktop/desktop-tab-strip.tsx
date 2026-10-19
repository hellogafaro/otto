import type { MessageKey } from "@otto/client-runtime/i18n";
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBookShelfLine,
  RiBox3Line,
  RiChat1Line,
  RiCloseLine,
  RiHome5Line,
  RiInbox2Line,
  RiListCheck3,
  RiSettings3Line,
  RiShapesLine,
  RiTimeLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { useLocation, useRouter, type AnyRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import { ThreadId } from "@otto/contracts";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { canGoBack, canGoForward, tabHistoryOf } from "../../desktop-tab-history";
import {
  activateDesktopTab,
  activeDesktopTab,
  closeDesktopTab,
  desktopTabPathname,
  goDesktopTabHistory,
  moveDesktopTab,
  openDesktopTab,
  openNextNavigationInNewTab,
  syncDesktopTab,
  useDesktopTabs,
  type DesktopTab,
} from "../../desktop-tabs-store";
import { useI18n } from "../../i18n";
import { cn, isMacPlatform } from "../../lib/utils";
import { readLocalApi } from "../../local-api";
import { desktopHistoryShortcut, desktopLinkAction } from "./desktop-link-navigation";
import { isModelPickerOpen } from "../../model-picker-visibility";
import { useShortcutHintsVisible } from "../../shortcut-hints";
import { useThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ThreadStatusIcon } from "../roster/chat-status-icon";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const isMac = isMacPlatform(navigator.platform);

interface TabPlace {
  readonly label: MessageKey;
  readonly icon: RemixiconComponentType;
}

const PLACES: ReadonlyArray<TabPlace & { readonly base: string }> = [
  { base: "/settings", label: "Settings", icon: RiSettings3Line },
  { base: "/notifications", label: "Notifications", icon: RiInbox2Line },
  { base: "/tasks", label: "Tasks", icon: RiListCheck3 },
  { base: "/projects", label: "Projects", icon: RiBox3Line },
  { base: "/routines", label: "Routines", icon: RiTimeLine },
  { base: "/library", label: "Library", icon: RiBookShelfLine },
  { base: "/customize", label: "Customize", icon: RiShapesLine },
];

/** The digit ⌘ jumps to a tab with: 1–8 by position, and 9 for the last tab. */
export function tabJumpDigit(index: number, count: number): number | null {
  if (index === count - 1) return Math.min(count, 9);

  return index < 8 ? index + 1 : null;
}

/** A route's place: the rail's glyph and name, which a page's own title replaces. */
function tabPlace(href: string): TabPlace {
  const pathname = desktopTabPathname(href);

  if (pathname === "/") return { label: "Home", icon: RiHome5Line };

  return (
    PLACES.find((place) => pathname === place.base || pathname.startsWith(`${place.base}/`)) ?? {
      label: "Chats",
      icon: RiChat1Line,
    }
  );
}

function showRoute(router: AnyRouter, next: string | null): void {
  if (next !== null) router.history.push(next);
}

/**
 * Otto: A ⌘- or middle-click in the sidebar opens what it points at in a new tab. The click
 * is replayed as a plain one, so every row keeps its own navigation.
 */
export function openSidebarClickInNewTab(event: MouseEvent<HTMLElement>): void {
  const middle = event.type === "auxclick" && event.button === 1;
  const modified = event.type === "click" && (isMac ? event.metaKey : event.ctrlKey);

  if (!middle && !modified) return;

  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("a, button, [role=button], [role=link]")
      : null;

  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  openNextNavigationInNewTab();
  target.click();
}

/**
 * Otto: The desktop titlebar row: the window controls, then one tab per open route and a
 * button for a new one. The row drags the window everywhere but its controls.
 */
export function DesktopTabStrip() {
  const { t } = useI18n();
  const trafficLights = useMacTrafficLights();
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const tabs = useDesktopTabs((state) => state.tabs);
  const activeId = useDesktopTabs((state) => state.activeId);
  const titles = useDesktopTabs((state) => state.titles);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const jumpHints = useShortcutHintsVisible("command");
  // The app starts on its first route; the saved open tab wins once.
  const restoreHref = useRef<string | null | undefined>(undefined);

  if (restoreHref.current === undefined) {
    const active = activeDesktopTab();
    restoreHref.current = active && active.href !== href ? active.href : null;
  }

  useEffect(() => {
    const restore = restoreHref.current;

    if (restore && restore !== href) {
      router.history.replace(restore);

      return;
    }

    restoreHref.current = null;
    syncDesktopTab(href);
  }, [href, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;

      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }

      const direction = desktopHistoryShortcut(event, navigator.platform);

      if (direction) {
        event.preventDefault();
        event.stopPropagation();
        showRoute(router, goDesktopTabHistory(direction));

        return;
      }

      const { tabs: open, activeId: openId } = useDesktopTabs.getState();
      const index = open.findIndex((tab) => tab.id === openId);
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      let next: DesktopTab | undefined;

      if (event.ctrlKey && key === "tab") {
        next = open.at((index + (event.shiftKey ? -1 : 1)) % open.length);
      } else if (mod && !event.shiftKey && key === "t") {
        event.preventDefault();
        showRoute(router, openDesktopTab("/"));

        return;
      } else if (mod && !event.shiftKey && key === "w") {
        // The last tab leaves ⌘W to the window, which closes it.
        if (open.length === 1) return;
        event.preventDefault();
        showRoute(router, closeDesktopTab(openId ?? ""));

        return;
      } else if (mod && !event.shiftKey && /^[1-9]$/.test(key) && !isModelPickerOpen()) {
        next = key === "9" ? open.at(-1) : open[Number(key) - 1];
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (next) showRoute(router, activateDesktopTab(next.id));
    };

    // Capture, so tabs win ⌘1–9 over the sidebar's chat shortcuts and editors.
    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [router]);

  useEffect(() => {
    const onMouse = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented) return;

      if (event.type === "click" && event.button !== 0) return;

      if (event.type === "auxclick" && event.button !== 1) return;

      const target = event.target;

      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");

      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (anchor.classList.contains("chat-markdown-file-link")) return;

      if (anchor.closest("[contenteditable='true'], [contenteditable='']")) return;

      const result = desktopLinkAction({
        href: anchor.getAttribute("href"),
        baseHref: window.location.href,
        target: anchor.target,
        download: anchor.hasAttribute("download"),
        editable: false,
        electron: true,
        click: {
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          platform: navigator.platform,
        },
      });

      if (result.type === "ignore") return;
      event.preventDefault();
      event.stopPropagation();

      if (result.type === "same-tab") {
        showRoute(router, result.route);

        return;
      }

      if (result.type === "new-tab") {
        showRoute(router, openDesktopTab(result.route));

        return;
      }

      void readLocalApi()
        ?.shell.openExternal(result.url)
        .catch(() => undefined);
    };

    document.addEventListener("click", onMouse, true);
    document.addEventListener("auxclick", onMouse, true);

    return () => {
      document.removeEventListener("click", onMouse, true);
      document.removeEventListener("auxclick", onMouse, true);
    };
  }, [router]);

  const show = (next: string | null) => showRoute(router, next);
  const openTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const history = openTab ? tabHistoryOf(openTab) : null;

  return (
    <div
      className={cn(
        "drag-region fixed inset-x-0 top-0 z-20 flex h-(--app-titlebar-height) items-start gap-panel-gap pt-panel-gap pr-2 wco:pr-(--workspace-native-controls-inset)",
        trafficLights ? "pl-22" : "pl-2",
      )}
    >
      <div className="flex shrink-0 items-center gap-panel-gap">
        <HistoryButton
          label={t("Back")}
          shortcut="<"
          disabled={!history || !canGoBack(history)}
          onClick={() => show(goDesktopTabHistory("back"))}
          icon={RiArrowLeftSLine}
        />
        <HistoryButton
          label={t("Forward")}
          shortcut=">"
          disabled={!history || !canGoForward(history)}
          onClick={() => show(goDesktopTabHistory("forward"))}
          icon={RiArrowRightSLine}
        />
      </div>
      <div
        role="tablist"
        aria-label={t("Tabs")}
        className="flex min-w-0 items-center gap-panel-gap"
      >
        {tabs.map((tab, index) => {
          const place = tabPlace(tab.href);
          const active = tab.id === activeId;
          const chatId = /^\/chats\/([^/]+)$/.exec(desktopTabPathname(tab.href))?.[1] ?? null;
          const jumpDigit = jumpHints ? tabJumpDigit(index, tabs.length) : null;

          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDragIndex(index);
              }}
              onDragOver={(event) => {
                if (dragIndex !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();

                if (dragIndex !== null) moveDesktopTab(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                "group/tab relative flex h-7 w-48 min-w-0 items-center overflow-hidden rounded-md app-region-no-drag transition-bg-color-shadow duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none",
                active
                  ? "sidebar-row-raised text-sidebar-foreground shadow-xs ring-1 ring-sidebar-border/70"
                  : "desktop-tab-fill text-sidebar-muted-foreground hover:text-sidebar-foreground",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => show(activateDesktopTab(tab.id))}
                className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 overflow-hidden rounded-md pl-2 text-13px font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AppIcon icon={place.icon} className="size-3.5 shrink-0" />
                <span>{titles[desktopTabPathname(tab.href)] ?? t(place.label)}</span>
              </button>
              <span className="sidebar-row-trail absolute inset-y-0 right-0 flex items-center pr-1 pl-5">
                {jumpDigit !== null ? (
                  <Kbd variant="jump">{isMac ? `⌘${jumpDigit}` : `Ctrl+${jumpDigit}`}</Kbd>
                ) : chatId ? (
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center",
                      tabs.length > 1 &&
                        "group-hover/tab:hidden group-has-focus-visible/tab:hidden",
                    )}
                  >
                    <TabChatStatus threadId={chatId} current={active} />
                  </span>
                ) : null}
                {tabs.length > 1 && jumpDigit === null ? (
                  <span className="hidden group-hover/tab:flex group-has-focus-visible/tab:flex">
                    <Button
                      variant="ghost-muted"
                      size="icon-micro"
                      aria-label={t("Close tab")}
                      onClick={() => show(closeDesktopTab(tab.id))}
                    >
                      <RiCloseLine aria-hidden />
                    </Button>
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={t("New tab")}
              onClick={() => show(openDesktopTab("/"))}
            >
              <RiAddLine aria-hidden />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          <span className="flex items-center gap-2">
            {t("New tab")}
            <KbdGroup>
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>T</Kbd>
            </KbdGroup>
          </span>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Otto: A 28px titlebar history button, the same quiet control as New tab. */
function HistoryButton({
  label,
  shortcut,
  disabled,
  onClick,
  icon: Icon,
}: {
  readonly label: string;
  readonly shortcut: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly icon: RemixiconComponentType;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="app-region-no-drag inline-flex">
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={label}
              disabled={disabled}
              onClick={onClick}
            >
              <Icon aria-hidden />
            </Button>
          </span>
        }
      />
      <TooltipPopup side="bottom">
        <span className="flex items-center gap-2">
          {label}
          <KbdGroup>
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>{shortcut}</Kbd>
          </KbdGroup>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

/** The status of the chat a tab shows, like its sidebar row: working, waiting or unread. */
function TabChatStatus({
  threadId,
  current,
}: {
  readonly threadId: string;
  readonly current: boolean;
}) {
  const environmentId = usePrimaryEnvironmentId();

  const threadRef = useMemo(
    () => (environmentId ? scopeThreadRef(environmentId, ThreadId.make(threadId)) : null),
    [environmentId, threadId],
  );

  const shell = useThreadShell(threadRef);

  if (!environmentId || !shell) return null;

  return <ThreadStatusIcon environmentId={environmentId} shell={shell} current={current} />;
}

/** True while the macOS traffic lights show, which full screen hides. */
function useMacTrafficLights(): boolean {
  const bridge = window.desktopBridge;

  const [fullscreen, setFullscreen] = useState(() =>
    Predicate.isFunction(bridge?.getWindowFullscreenState)
      ? bridge.getWindowFullscreenState()
      : false,
  );

  useEffect(() => {
    if (!isMac || !Predicate.isFunction(bridge?.onWindowFullscreenStateChange)) return;

    return bridge.onWindowFullscreenStateChange(setFullscreen);
  }, [bridge]);

  return isMac && Boolean(bridge) && !fullscreen;
}
