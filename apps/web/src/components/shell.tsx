import { Outlet } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { AppRail } from "@/components/app-rail";
import { CommandPaletteProvider } from "@/components/command-palette";

// The section sidebar (app-sidebar.tsx) is kept but hidden for now; render
// <AppSidebar /> after the rail to bring it back.
export function Shell() {
  return (
    <CommandPaletteProvider>
      <SidebarProvider>
        <AppRail />
        {/* Screen-height main area: pages scroll inside it, top bars stay put. */}
        <SidebarInset className="h-svh">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </CommandPaletteProvider>
  );
}
