import { RiAddLine, RiGroupLine, RiRobot3Line, RiSearchLine } from "@remixicon/react";

import { Link } from "@tanstack/react-router";

import { memo } from "react";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { OttoWordmark } from "../OttoWordmark";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarHeader, SidebarTrigger } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Minimal roster chrome: traffic-light drag space, an optional environment
 * pill, and the new-bot button. No brand row and no stage artwork. The
 * fixed SidebarControl trigger overlays the left edge on desktop, so content
 * starts at the titlebar inset. Icon-collapsed mode empties the row and the
 * rail supplies its own new-bot button.
 */
export const RosterSidebarHeader = memo(function RosterSidebarHeader({
  onNewBot,
  onNewGroup,
}: {
  onNewBot: () => void;
  onNewGroup: () => void;
}) {
  const { t } = useI18n();

  return (
    <SidebarHeader
      dragRegion={isElectron}
      className="h-(--workspace-topbar-height) shrink-0 flex-row items-center gap-1 px-3 py-0 md:px-2"
    >
      <div className="grid min-w-0 flex-1 grid-cols-grow-auto-grow items-center group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-start">
          <SidebarTrigger className="md:hidden" />
        </div>
        <Link
          to="/"
          className="flex items-center justify-center rounded-md text-sidebar-foreground outline-none ring-ring focus-visible:ring-2"
        >
          <OttoWordmark />
        </Link>
        <div className="flex items-center justify-end">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={t("Create")}
                  data-testid="roster-new-bot"
                  className="size-(--workspace-titlebar-control-size)!"
                  size="icon"
                  variant="ghost"
                >
                  <RiAddLine />
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuItem onClick={onNewBot}>
                <RiRobot3Line />
                {t("New bot")}
              </MenuItem>
              <MenuItem onClick={onNewGroup}>
                <RiGroupLine />
                {t("New group")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </SidebarHeader>
  );
});

/**
 * Otto: Header for the roster inside the rail layout. A 16px/500 "Chats"
 * title like the Settings and Routines panels, inset 16px, then search and
 * create as 28px quiet buttons 8px from the edge and 6px apart, the same
 * geometry as the main panel's top bar.
 */
export function RosterPanelHeader({
  onNewBot,
  onNewGroup,
  onSearch,
}: {
  onNewBot: () => void;
  onNewGroup: () => void;
  onSearch: () => void;
}) {
  const { t } = useI18n();

  return (
    <SidebarHeader
      dragRegion={isElectron}
      className="h-(--workspace-topbar-height) shrink-0 flex-row items-center gap-1.5 py-0 pr-2 pl-4"
    >
      <h2 className="min-w-0 flex-1 truncate text-base font-medium tracking-title-sm text-sidebar-foreground">
        {t("Chats")}
      </h2>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("Search")}
              size="icon-sm"
              variant="sidebar-ghost"
              onClick={onSearch}
            >
              <AppIcon icon={RiSearchLine} />
            </Button>
          }
        />
        <TooltipPopup>{t("Search")}</TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={t("Create")}
              data-testid="roster-new-bot"
              size="icon-sm"
              variant="sidebar-ghost"
            >
              <AppIcon icon={RiAddLine} />
            </Button>
          }
        />
        <MenuPopup align="end">
          <MenuItem onClick={onNewBot}>
            <RiRobot3Line />
            {t("New bot")}
          </MenuItem>
          <MenuItem onClick={onNewGroup}>
            <RiGroupLine />
            {t("New group")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </SidebarHeader>
  );
}

/** Create menu for the icon-collapsed rail, pinned above the sidebar footer. */
export function RosterRailCreateMenu({
  onNewBot,
  onNewGroup,
}: {
  onNewBot: () => void;
  onNewGroup: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="hidden shrink-0 flex-col items-center pb-1 group-data-[collapsible=icon]:flex">
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={t("Create")}
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none select-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RiAddLine className="size-4" />
            </button>
          }
        />
        <MenuPopup align="end" side="right">
          <MenuItem onClick={onNewBot}>
            <RiRobot3Line />
            {t("New bot")}
          </MenuItem>
          <MenuItem onClick={onNewGroup}>
            <RiGroupLine />
            {t("New group")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
