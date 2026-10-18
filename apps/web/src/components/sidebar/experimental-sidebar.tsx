import {
  RiBookShelfLine,
  RiBox3Line,
  RiChat1Line,
  RiHome5Line,
  RiInbox2Line,
  RiTimeLine,
  RiListCheck3,
  type RemixiconComponentType,
} from "@remixicon/react";
import type { KeybindingCommand } from "@otto/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { useChangedSinceMount } from "../../hooks/use-changed-since-mount";
import { cn } from "../../lib/utils";
import { openSettings } from "../../settings-dialog-store";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { notificationEnvironment } from "../../state/notifications";
import { useEnvironmentQuery } from "../../state/query";
import BotRosterSidebar from "../roster/bot-roster-sidebar";
import { resolveRosterListState } from "../roster/roster-route-selection";
import { useRosterStore } from "../roster/roster-store";
import { SettingsPanelNav } from "../settings/settings-sidebar-nav";
import { ShortcutKbd } from "../shortcut-kbd";
import { AppIcon } from "../ui/app-icon";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AccountMenu } from "./account-menu";
import { SidebarUpdatePill } from "./sidebar-update-pill";

/**
 * Codex-style sidebar experiment: a rail of places beside a raised panel.
 * On by default; `?sidebar=classic` on any URL switches back, and the choice
 * sticks in localStorage until `?sidebar=places`.
 */
const EXPERIMENT = "places";

const STORAGE_KEY = "otto:sidebar-experiment";

const RAIL_WIDTH = 60;

const PANEL_WIDTH = 296;

function readExperiment(): boolean {
  const param = new URLSearchParams(window.location.search).get("sidebar");

  if (param !== null) window.localStorage.setItem(STORAGE_KEY, param);

  return (window.localStorage.getItem(STORAGE_KEY) ?? EXPERIMENT) === EXPERIMENT;
}

/** Resolved once per page load; switching layouts is a reload. */
export function useSidebarExperiment(): boolean {
  const [enabled] = useState(readExperiment);

  return enabled;
}

/** Rail plus panel use a fixed width; resizing is ignored while experimenting. */
export const EXPERIMENTAL_SIDEBAR_WIDTH = RAIL_WIDTH + PANEL_WIDTH;

/** Full-width pages and a place with nothing to list show only the rail. */
export const EXPERIMENTAL_RAIL_ONLY_WIDTH = RAIL_WIDTH;

/**
 * Full-width pages, and Chats with no bot to list (the main panel carries its empty state),
 * show only the rail.
 */
export function useRailOnly(): boolean {
  const pathname = useLocation({ select: (location) => location.pathname });
  const environmentId = usePrimaryEnvironmentId();

  const noBots = useRosterStore(
    (state) => resolveRosterListState(environmentId, state.environmentId, state.bots) === "empty",
  );

  if (isFullPage(pathname)) return true;

  return !isPathUnder(pathname, "/settings") && noBots;
}

/**
 * Home, Notifications, Routines, Tasks, Projects and the Library own the whole main panel, so the
 * panel steps aside.
 */
function isFullPage(pathname: string): boolean {
  if (pathname === "/") return true;

  return ["/notifications", "/routines", "/tasks", "/projects", "/library"].some((base) =>
    isPathUnder(pathname, base),
  );
}

function isPathUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function ExperimentalSidebar() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  // Settings is a route, not a panel toggle: the URL decides whether it owns
  // the panel, and leaving it goes back to the chat workspace.
  const onSettings = isPathUnder(pathname, "/settings");
  const onHome = pathname === "/";
  const onNotifications = isPathUnder(pathname, "/notifications");
  const onRoutines = isPathUnder(pathname, "/routines");
  const onTasks = isPathUnder(pathname, "/tasks");
  const onProjects = isPathUnder(pathname, "/projects");
  const onLibrary = isPathUnder(pathname, "/library");
  const onPage = onSettings || isFullPage(pathname);
  const railOnly = useRailOnly();
  // Collapsing hides the panel and keeps the rail; picking a place brings it back.
  const { state: sidebarState, setOpen: setSidebarOpen, isMobile } = useSidebar();

  const revealPanel = () => {
    if (sidebarState === "collapsed") setSidebarOpen(true);
  };

  const openChats = () => {
    revealPanel();

    if (onPage) void navigate({ to: "/chats" });
  };

  const panel = onSettings ? "settings" : "chats";
  // Only rail switches animate; the first paint of the panel stays still.
  const panelSwitched = useChangedSinceMount(panel);
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();

  const notifications = useEnvironmentQuery(
    environmentId ? notificationEnvironment.list({ environmentId, input: {} }) : null,
  );

  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <nav
        aria-label={t("Main")}
        className="flex h-full w-(--rail-width) shrink-0 flex-col items-center pb-3"
        style={{ "--rail-width": `${RAIL_WIDTH}px` }}
      >
        {/* The first icon centers on the panel title row. */}
        <div className={cn("h-topbar-spacer w-full shrink-0", isElectron && "drag-region")} />
        <div className="flex flex-col items-center gap-1">
          {/* Otto: The Otto mark is the rail's first button, a ghost button like the rest, and a second way home. */}
          <button
            type="button"
            aria-label="Otto"
            onClick={() => {
              if (!onHome) void navigate({ to: "/" });
            }}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground outline-none transition-bg-color-shadow duration-(--duration-fast) ease-(--ease-smooth-out) select-none hover:bg-sidebar-wash motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring app-region-no-drag"
          >
            <span aria-hidden="true" className="otto-wordmark-symbol bg-current text-xl" />
          </button>
          <RailButton
            label={t("Home")}
            icon={RiHome5Line}
            shortcut="navigation.home"
            active={onHome}
            onClick={() => {
              if (!onHome) void navigate({ to: "/" });
            }}
          />
          <RailButton
            label={
              unread > 0
                ? t("Notifications, {count} unread", { count: unread })
                : t("Notifications")
            }
            icon={RiInbox2Line}
            shortcut="navigation.notifications"
            active={onNotifications}
            badge={unread > 0}
            onClick={() => {
              if (!onNotifications) void navigate({ to: "/notifications" });
            }}
          />
          <RailButton
            label={t("Chats")}
            icon={RiChat1Line}
            shortcut="navigation.chats"
            active={!onPage}
            onClick={openChats}
          />
          <RailButton
            label={t("Routines")}
            icon={RiTimeLine}
            shortcut="navigation.routines"
            active={onRoutines}
            onClick={() => {
              if (!onRoutines) void navigate({ to: "/routines" });
            }}
          />
          <RailButton
            label={t("Tasks")}
            icon={RiListCheck3}
            shortcut="navigation.tasks"
            active={onTasks}
            onClick={() => {
              if (!onTasks) void navigate({ to: "/tasks" });
            }}
          />
          <RailButton
            label={t("Projects")}
            icon={RiBox3Line}
            shortcut="navigation.projects"
            active={onProjects}
            onClick={() => {
              if (!onProjects) void navigate({ to: "/projects" });
            }}
          />
          <RailButton
            label={t("Library")}
            icon={RiBookShelfLine}
            shortcut="navigation.library"
            active={onLibrary}
            onClick={() => {
              if (!onLibrary) void navigate({ to: "/library" });
            }}
          />
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <SidebarUpdatePill />
          <AccountMenu
            presentation="rail"
            onOpenSettings={() => {
              revealPanel();

              if (!onSettings) openSettings();
            }}
          />
        </div>
      </nav>
      {/* The panel is a raised card; its row tokens are re-based on the card surface. */}
      {/* Fixed width so collapsing clips the panel instead of squeezing its rows. */}
      <div
        className={cn(
          "flex w-(--panel-width) shrink-0 py-panel-gap pr-panel-gap",
          railOnly && !isMobile && "hidden",
        )}
        style={{ "--panel-width": `${PANEL_WIDTH}px` }}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-sidebar-border/70 bg-sidebar shadow-(--shell-card-shadow) sidebar-shell-card">
          <div
            key={panel}
            className={cn("flex min-h-0 flex-1 flex-col", panelSwitched && "motion-place-enter")}
          >
            {onSettings ? (
              <>
                <PanelHeader title={t("Settings")} />
                <SettingsPanelNav />
              </>
            ) : (
              <BotRosterSidebar chrome="panel" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RailButton({
  label,
  icon,
  shortcut,
  active = false,
  badge = false,
  onClick,
}: {
  label: string;
  icon: RemixiconComponentType;
  shortcut: KeybindingCommand;
  active?: boolean;
  /** Otto: A dot for something new behind this place, such as unread notifications. */
  badge?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-current={active || undefined}
            onClick={onClick}
            className={cn(
              "relative flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-bg-color-shadow duration-(--duration-fast) ease-(--ease-smooth-out) select-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring app-region-no-drag",
              active
                ? "bg-(--shell-card) text-sidebar-foreground shadow-xs ring-1 ring-sidebar-border/70"
                : "text-sidebar-muted-foreground hover:bg-sidebar-wash hover:text-sidebar-foreground",
            )}
          >
            <AppIcon icon={icon} className="size-4" />
            {badge ? (
              <span
                aria-hidden
                className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
              />
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="right">
        <span className="flex items-center gap-2">
          {label}
          <ShortcutKbd command={shortcut} variant="inline" />
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

function PanelHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-(--workspace-topbar-height) shrink-0 items-center gap-1.5 pr-2 pl-4",
        isElectron && "drag-region",
      )}
    >
      <h2 className="min-w-0 flex-1 truncate text-base font-medium tracking-title-sm text-sidebar-foreground">
        {title}
      </h2>
      {action}
    </div>
  );
}
