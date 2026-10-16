import { RiArrowLeftLine, RiSearchLine } from "@remixicon/react";

import { useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { AppIcon } from "../ui/app-icon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import { SidebarChromeHeader } from "../sidebar/sidebar-chrome";
import { SETTINGS_NAV_GROUPS, SETTINGS_NAV_ITEMS, type SettingsNavItem } from "./settings-dialog";
import { searchSettings } from "./settings-search";
import { isElectron } from "../../env";

function useSettingsNavigation() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  const go = (to: string) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to });
  };

  return { pathname, go };
}

function SettingsPanelRow({
  item,
  label,
  active,
  onClick,
}: {
  readonly item: SettingsNavItem;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-13px font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground/85 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <AppIcon
          className="size-4 shrink-0"
          tone={active ? "sidebar" : "sidebar-muted"}
          icon={item.icon}
        />
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

/**
 * Section list for the rail layout's raised panel, under a search field that
 * swaps the list for matching settings. The rail owns the way back to chats,
 * so there is no footer here.
 */
export function SettingsPanelNav() {
  const { t } = useI18n();
  const { pathname, go } = useSettingsNavigation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const results = searchSettings(query, undefined, t);

  return (
    <>
      <div className="px-1.5 pb-1">
        <InputGroup>
          <InputGroupAddon>
            <RiSearchLine aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            size="sm"
            type="search"
            aria-label={t("Search settings")}
            placeholder={t("Search settings")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query.length > 0) {
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </InputGroup>
      </div>
      <nav
        aria-label={t("Settings sections")}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2"
      >
        {query.trim().length > 0 ? (
          results.length === 0 ? (
            <p className="px-2.5 py-2 text-13px text-sidebar-muted-foreground">
              {t("No settings found")}
            </p>
          ) : (
            <ul className="flex flex-col gap-px pt-1">
              {results.map((result) => {
                const page = SETTINGS_NAV_ITEMS.find(
                  (item) => `/settings/${item.section}` === result.to,
                );

                if (!page) return null;

                return (
                  <SettingsPanelRow
                    key={result.id}
                    item={page}
                    label={t(result.title)}
                    active={false}
                    onClick={() => {
                      setQuery("");
                      void navigate({
                        to: "/settings/$section",
                        params: { section: page.section },
                        hash: result.targetId ?? result.id,
                      });
                    }}
                  />
                );
              })}
            </ul>
          )
        ) : (
          SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.label ?? "personal"} className="pb-2">
              {group.label ? (
                <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-sidebar-muted-foreground">
                  {t(group.label)}
                </div>
              ) : null}
              <ul className="flex flex-col gap-px">
                {group.items.map((item) => {
                  const to = `/settings/${item.section}`;

                  return (
                    <SettingsPanelRow
                      key={item.section}
                      item={item}
                      label={t(item.label)}
                      active={pathname === to || pathname.startsWith(`${to}/`)}
                      onClick={() => go(to)}
                    />
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </>
  );
}

/** Classic flat sidebar (`?sidebar=classic`) for the settings route. */
export function SettingsSidebarNav() {
  const { t } = useI18n();
  const { pathname, go } = useSettingsNavigation();

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent className="overflow-x-hidden">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label ?? "personal"} className="p-(--sidebar-content-inset)">
            {group.label ? <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel> : null}
            <SidebarMenu>
              {group.items.map((item) => {
                const to = `/settings/${item.section}`;
                const active = pathname === to || pathname.startsWith(`${to}/`);

                return (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      aria-current={active ? "page" : undefined}
                      isActive={active}
                      onClick={() => go(to)}
                      tooltip={t(item.label)}
                    >
                      <AppIcon
                        className="size-4"
                        tone={active ? undefined : "sidebar-muted"}
                        icon={item.icon}
                      />
                      <span className="truncate group-data-[collapsible=icon]:hidden">
                        {t(item.label)}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-(--sidebar-content-inset)">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => go("/")} tooltip={t("Back to chats")}>
              <RiArrowLeftLine />
              <span className="group-data-[collapsible=icon]:hidden">{t("Back to chats")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
