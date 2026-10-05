import { Outlet } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { Toaster } from "@workspace/ui/components/sonner";
import { AppRail } from "@/components/app-rail";

// The window: a frame in the sidebar tone holding the rail alone, and the
// page as an inset card (8px from the frame). A section's own navigation
// (Settings) is the card's left panel.
export function Shell() {
  return (
    <>
      <SidebarProvider className="h-svh min-h-0 flex-col bg-sidebar">
        <div className="flex min-h-0 flex-1">
          <AppRail />
          {/* Pages scroll inside the card; top bars stay put. */}
          <SidebarInset className="mt-2 mr-2 mb-2 min-h-0 overflow-hidden rounded-xl shadow-xs ring-1 ring-foreground/10">
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <Outlet />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
      <Toaster />
    </>
  );
}
