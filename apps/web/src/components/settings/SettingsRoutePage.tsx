import { Outlet, useLocation } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { settingsSectionFromPathname } from "../../settingsDialogStore";
import { useSidebarExperiment } from "../sidebar/ExperimentalSidebar";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { settingsSectionLabel } from "./SettingsDialog";
import { SettingsPageTitleContext } from "./settingsLayout";

export function SettingsRoutePage() {
  const { t } = useI18n();
  const pathname = useLocation({ select: (location) => location.pathname });
  const sidebarExperiment = useSidebarExperiment();
  const section = settingsSectionFromPathname(pathname);
  const label = t(settingsSectionLabel(section));

  return (
    <SidebarInset
      tone="foreground"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground">
        {sidebarExperiment ? (
          // The panel already says "Settings" and the page opens with its own title.
          <WorkspacePageHeader electron={isElectron} />
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
          <SettingsPageTitleContext value={pathname === `/settings/${section}` ? label : null}>
            <Outlet />
          </SettingsPageTitleContext>
        </div>
      </div>
    </SidebarInset>
  );
}
