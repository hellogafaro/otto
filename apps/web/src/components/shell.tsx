import { Outlet, useMatchRoute } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { Toaster } from "@workspace/ui/components/sonner";
import type { CSSProperties } from "react";
import { AppRail } from "@/components/app-rail";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ConfirmProvider } from "@/components/confirm";
import { FloatingChatProvider } from "@/components/floating-chat";
import { TITLE_BAR_HEIGHT, TitleBar, useDesktop } from "@/components/title-bar";
import { WorkspaceBoundary } from "@/lib/workspace";
import { ChatsSidebar } from "@/routes/chats";
import { SettingsSidebar } from "@/routes/settings";

// The window: a frame in the sidebar tone holding the rail alone, and the
// page as an inset card (8px from the frame; flush under the desktop title
// strip). A section's own navigation (Chats, Settings) is the card's left panel. --titlebar is the strip's
// height (0 on the web) for full-screen layers.
export function Shell() {
  return (
    <WorkspaceBoundary>
      <WorkspaceShell />
    </WorkspaceBoundary>
  );
}

function WorkspaceShell() {
  const desktop = useDesktop();
  const matchRoute = useMatchRoute();
  const inChats = Boolean(matchRoute({ to: "/chats", fuzzy: true }));
  const inSettings = Boolean(matchRoute({ to: "/settings", fuzzy: true }));
  return (
    <CommandPaletteProvider>
      <ConfirmProvider>
        <FloatingChatProvider>
          <SidebarProvider
            data-desktop={desktop || undefined}
            style={
              {
                "--titlebar": desktop ? TITLE_BAR_HEIGHT : "0px",
              } as CSSProperties
            }
            className="h-svh min-h-0 flex-col bg-sidebar"
          >
            {desktop && <TitleBar />}
            <div className="flex min-h-0 flex-1">
              <AppRail />
              {/* Pages scroll inside the card; top bars stay put. */}
              <SidebarInset className="mt-2 mr-2 mb-2 min-h-0 overflow-hidden rounded-xl shadow-xs ring-1 ring-foreground/10 group-data-desktop/sidebar-wrapper:mt-0">
                <div className="flex min-h-0 flex-1">
                  {inChats && <ChatsSidebar />}
                  {inSettings && <SettingsSidebar />}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <Outlet />
                  </div>
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </FloatingChatProvider>
        <Toaster />
      </ConfirmProvider>
    </CommandPaletteProvider>
  );
}
