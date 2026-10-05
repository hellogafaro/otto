import { RiCpuLine } from "@remixicon/react";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { SectionSidebar } from "@/components/section-sidebar";

const sections = [
  { id: "models", group: "Account", label: "Models", icon: RiCpuLine },
] as const;

export function SettingsLayout() {
  const matchRoute = useMatchRoute();
  return (
    <>
      <SectionSidebar title="Settings">
        {(["Account"] as const).map((group) => (
          <div key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarMenu>
              {sections
                .filter((section) => section.group === group)
                .map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={Boolean(
                        matchRoute({
                          to: "/settings/$section",
                          params: { section: id },
                          fuzzy: true,
                        }),
                      )}
                      render={
                        <Link
                          to="/settings/$section"
                          params={{ section: id }}
                        />
                      }
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </div>
        ))}
      </SectionSidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </>
  );
}
