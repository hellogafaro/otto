import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { settingsSectionFromPathname } from "../../settings-dialog-store";
import { useSidebarExperiment } from "../sidebar/experimental-sidebar";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../workspace-breadcrumb";
import { WorkspaceBackButton, WorkspacePageHeader } from "../workspace-page-header";
import { settingsSectionLabel } from "./settings-dialog";
import { SettingsPageTitleContext } from "./settings-layout";

export function SettingsRoutePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const sidebarExperiment = useSidebarExperiment();
  const section = settingsSectionFromPathname(pathname);
  const label = t(settingsSectionLabel(section));
  // Otto: a subpage (a bot, a provider, an app) returns to its section from the top bar.
  const subpage = pathname !== `/settings/${section}`;

  return (
    <SidebarInset
      tone="foreground"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground">
        {sidebarExperiment ? (
          // The panel already says "Settings" and the page opens with its own title.
          <WorkspacePageHeader electron={isElectron}>
            {subpage ? (
              <WorkspaceBackButton
                label={label}
                onBack={() => void navigate({ to: "/settings/$section", params: { section } })}
              />
            ) : null}
          </WorkspacePageHeader>
        ) : (
          <WorkspacePageHeader electron={isElectron} className="border-b border-border/70">
            <WorkspaceBreadcrumb ariaLabel={t("Settings breadcrumb")}>
              <WorkspaceBreadcrumbItem>
                <h1>{t("Settings")}</h1>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current>{label}</WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
          </WorkspacePageHeader>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <SettingsPageTitleContext value={subpage ? null : label}>
            <Outlet />
          </SettingsPageTitleContext>
        </div>
      </div>
    </SidebarInset>
  );
}
