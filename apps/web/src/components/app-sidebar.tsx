import {
  RiArrowLeftLine,
  RiBox3Line,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiFileTextLine,
  RiMoreLine,
  RiPushpinLine,
  RiSearchLine,
  RiTimeLine,
} from "@remixicon/react";
import { Link, useMatchRoute, useRouterState } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { useEffect } from "react";
import { destinations } from "@/components/app-rail";
import { useCommandPalette } from "@/components/command-palette";
import { type NavigationItem, useNavigation } from "@/components/navigation";
import { OttoLogo } from "@/components/otto-logo";
import { ProfileMenu } from "@/components/profile-menu";
import { useWorkspace } from "@/lib/workspace";
import { SettingsSidebar } from "@/routes/settings";

export function AppSidebar() {
  const matchRoute = useMatchRoute();
  const inSettings = Boolean(matchRoute({ to: "/settings", fuzzy: true }));
  const openPalette = useCommandPalette();
  const { user, workspace } = useWorkspace();
  const { setOpenMobile } = useSidebar();
  const location = useRouterState({ select: (state) => state.location.href });
  const navigation = useNavigation();
  useEffect(() => {
    if (location) setOpenMobile(false);
  }, [location, setOpenMobile]);
  return (
    <Sidebar
      collapsible="offcanvas"
      className="top-(--titlebar) h-[calc(100svh-var(--titlebar))]"
      aria-label={inSettings ? "Settings sidebar" : "Main sidebar"}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a"))
          setOpenMobile(false);
      }}
    >
      <SidebarHeader>
        <div className="flex h-8 items-center gap-1">
          {inSettings ? (
            <SidebarMenuButton render={<Link to="/" />}>
              <RiArrowLeftLine />
              <span>Back to Home</span>
            </SidebarMenuButton>
          ) : (
            <>
              <SidebarMenuButton
                aria-label="Home"
                isActive={Boolean(matchRoute({ to: "/" }))}
                render={<Link to="/" />}
              >
                <OttoLogo className="size-5" />
                <span>Otto</span>
              </SidebarMenuButton>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search"
                onClick={() => openPalette()}
              >
                <RiSearchLine />
              </Button>
            </>
          )}
          <SidebarTrigger aria-label="Collapse navigation" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {inSettings ? (
          <SettingsSidebar />
        ) : (
          <nav aria-label="App navigation">
            <SidebarGroup>
              <SidebarMenu>
                {destinations
                  .filter((destination) => destination.to !== "/")
                  .map(({ to, label, icon, activeIcon }) => {
                    const active = Boolean(matchRoute({ to, fuzzy: true }));
                    const Icon = active ? activeIcon : icon;
                    return (
                      <SidebarMenuItem key={to}>
                        <SidebarMenuButton
                          isActive={active}
                          aria-current={active ? "page" : undefined}
                          render={<Link to={to} />}
                        >
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup role="group" aria-label="Pins">
              <SidebarGroupLabel>Pins</SidebarGroupLabel>
              <SidebarMenu>
                {navigation.pins.map((item) => (
                  <SavedRow
                    key={`${item.type}:${item.id}`}
                    item={item}
                    pinned
                  />
                ))}
              </SidebarMenu>
              {!navigation.pins.length && (
                <p className="px-2 text-xs text-muted-foreground">
                  Pin items from their navigation menu.
                </p>
              )}
            </SidebarGroup>
            <SidebarGroup role="group" aria-label="Recents">
              <SidebarGroupLabel>Recents</SidebarGroupLabel>
              <SidebarMenu>
                {navigation.recents.map((item) => (
                  <SavedRow key={`${item.type}:${item.id}`} item={item} />
                ))}
              </SidebarMenu>
              {!navigation.recents.length && (
                <p className="px-2 text-xs text-muted-foreground">
                  Items you open appear here.
                </p>
              )}
              {navigation.attentionError && (
                <p role="status" className="px-2 text-xs text-muted-foreground">
                  Chat attention is unavailable.
                </p>
              )}
              {navigation.moreAttention && (
                <Link
                  to="/"
                  className="px-2 text-xs text-muted-foreground underline"
                >
                  More activity in Home
                </Link>
              )}
            </SidebarGroup>
          </nav>
        )}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex min-w-0 items-center gap-2">
          <ProfileMenu />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {workspace.title}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function SavedRow({
  item,
  pinned = false,
}: {
  item: NavigationItem;
  pinned?: boolean;
}) {
  const navigation = useNavigation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const icons = {
    chat: RiChat1Line,
    task: RiCheckboxCircleLine,
    project: RiBox3Line,
    schedule: RiTimeLine,
    document: RiFileTextLine,
  };
  const Icon = icons[item.type];
  const status =
    item.type === "chat" ? navigation.attention.get(item.id) : undefined;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={pathname === item.href}
        aria-current={pathname === item.href ? "page" : undefined}
        render={<Link to={item.href} />}
      >
        <Icon />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {status && (
          <span
            role="img"
            aria-label={status}
            title={status}
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        )}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              aria-label={`Navigation actions for ${item.title}`}
            />
          }
        >
          <RiMoreLine />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!pinned && navigation.pinLimit}
              onClick={() => navigation.togglePin(item)}
            >
              <RiPushpinLine />
              {pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            {!pinned && !status && (
              <DropdownMenuItem onClick={() => navigation.forget(item)}>
                Remove from recents
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
