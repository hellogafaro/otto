import { Outlet } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { Toaster } from "@workspace/ui/components/sonner";
import type { CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ConfirmProvider } from "@/components/confirm";
import { FloatingChatProvider } from "@/components/floating-chat";
import { NavigationProvider } from "@/components/navigation";
import { TITLE_BAR_HEIGHT, TitleBar, useDesktop } from "@/components/title-bar";
import { WorkspaceBoundary } from "@/lib/workspace";
export function Shell() {
  return (
    <WorkspaceBoundary>
      <WorkspaceShell />
    </WorkspaceBoundary>
  );
}

function WorkspaceShell() {
  const desktop = useDesktop();
  return (
    <NavigationProvider>
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
                <AppSidebar />
                <NavigationTrigger />
                <SidebarInset className="mt-2 mr-2 mb-2 min-h-0 overflow-hidden rounded-xl shadow-xs ring-1 ring-foreground/10 group-data-desktop/sidebar-wrapper:mt-0">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <Outlet />
                  </div>
                </SidebarInset>
              </div>
            </SidebarProvider>
          </FloatingChatProvider>
          <Toaster />
        </ConfirmProvider>
      </CommandPaletteProvider>
    </NavigationProvider>
  );
}

function NavigationTrigger() {
  const { open, isMobile } = useSidebar();
  if (open && !isMobile) return null;
  return (
    <div className="shrink-0 p-1 pt-3 group-data-desktop/sidebar-wrapper:pt-1">
      <SidebarTrigger aria-label="Open navigation" />
    </div>
  );
}
