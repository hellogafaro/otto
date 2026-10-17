import { RiSettings3Line, RiShapesLine } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";

import type { EnvironmentId, McpServer } from "@otto/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import {
  loadCatalog,
  resolveCatalogInstallations,
  type PluginDefinition,
} from "../../../../../plugins";

import { createTranslator, type PluralForms } from "@otto/client-runtime/i18n";

import { useI18n } from "../../i18n";
import { openSettings } from "../../settings-dialog-store";
import { openCustomize } from "../../customize-navigation";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentMcpServersAtom } from "../../state/mcp-servers";
import { OttoWordmark } from "../otto-wordmark";
import { isBuiltinMcpServer } from "../roster/bot-tools.logic";
import { cn } from "../../lib/utils";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../sidebar-stage-backdrop";
import { Badge } from "../ui/badge";
import { AppIcon } from "../ui/app-icon";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarProviderUpdatePill } from "./sidebar-provider-update-pill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./sidebar-update-pill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const { t } = useI18n();
  const pillLabel = resolveEnvironmentIdentificationPillLabel(useEnvironmentStageLabel());

  return (
    <SidebarHeader
      dragRegion={isElectron}
      className="@container/sidebar-header relative h-(--workspace-topbar-height) shrink-0 flex-row items-center gap-1 px-3 py-0 md:px-2"
    >
      <div className="relative z-10 grid min-w-0 flex-1 grid-cols-grow-auto-grow items-center group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-start">
          <SidebarTrigger className="md:hidden" />
        </div>
        <div className="relative flex items-center justify-center">
          <Link
            aria-label={t("Go to chats")}
            className="flex items-center justify-center rounded-md text-sidebar-foreground outline-none ring-ring focus-visible:ring-2 app-region-no-drag"
            to="/chats"
          >
            <OttoWordmark />
          </Link>
          {pillLabel ? (
            <Badge
              presentation="environment-pill"
              className="absolute left-full ml-2"
              data-environment-identification="pill"
              size="sm"
              variant="secondary"
            >
              {pillLabel}
            </Badge>
          ) : null}
        </div>
        <div aria-hidden />
      </div>
    </SidebarHeader>
  );
});

const PLUGIN_CATALOG = loadCatalog();

type Pluralize = (count: number, forms: PluralForms) => string;

const englishTranslator = createTranslator("en");

export function formatEnabledPluginStatus(
  enabledCount: number,
  t: (message: string) => string = englishTranslator.translate,
  plural: Pluralize = englishTranslator.plural,
): string {
  if (enabledCount === 0) return t("No plugins enabled");

  return plural(enabledCount, { one: "{count} plugin enabled", other: "{count} plugins enabled" });
}

export function formatEnabledPluginBadge(enabledCount: number): string | null {
  if (enabledCount === 0) return null;

  return enabledCount > 99 ? "99+" : String(enabledCount);
}

export function summarizeEnabledPlugins(
  servers: readonly McpServer[],
  catalog: readonly PluginDefinition[] = PLUGIN_CATALOG,
) {
  const enabledIds = new Set<string>(
    servers.flatMap((server) => (server.enabled ? [server.id] : [])),
  );

  const installations = resolveCatalogInstallations(servers, catalog);

  const enabledPluginIds = new Set(
    installations.flatMap((installation) =>
      installation.kind === "catalog" && enabledIds.has(installation.serverId)
        ? [installation.plugin.id]
        : [],
    ),
  );

  return {
    enabledPlugins: catalog.filter((plugin) => enabledPluginIds.has(plugin.id)),
    enabledCount:
      installations.filter((installation) => enabledIds.has(installation.serverId)).length +
      servers.filter((server) => server.enabled && !isBuiltinMcpServer(server)).length,
  };
}

function SidebarPluginSummaryForEnvironment({
  environmentId,
  onClick,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClick: () => void;
}) {
  const { t, plural } = useI18n();
  const servers = useAtomValue(environmentMcpServersAtom(environmentId));
  const { enabledCount } = summarizeEnabledPlugins(servers);
  const statusLabel = formatEnabledPluginStatus(enabledCount, t, plural);

  return (
    <SidebarPluginButton enabledCount={enabledCount} onClick={onClick} statusLabel={statusLabel} />
  );
}

function SidebarPluginButton({
  enabledCount,
  onClick,
  statusLabel,
}: {
  readonly enabledCount: number;
  readonly onClick: () => void;
  readonly statusLabel: string;
}) {
  const { t } = useI18n();
  const badgeLabel = formatEnabledPluginBadge(enabledCount);
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={t("Customize, {status}", { status: statusLabel })}
              className="relative overflow-visible!"
              onClick={onClick}
            >
              <AppIcon className="size-4" icon={RiShapesLine} />
              <span className="truncate group-data-[collapsible=icon]:hidden">
                {t("Customize")}
              </span>
              {/* Expanded, the count sits inline where it can be read as a
                  number; collapsed, it becomes the badge on the glyph. */}
              {badgeLabel ? (
                <span
                  aria-hidden="true"
                  className="ms-auto text-xs tabular-nums text-sidebar-muted-foreground group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-right-1 group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:ms-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:min-w-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:text-9px group-data-[collapsible=icon]:font-semibold"
                >
                  {badgeLabel}
                </span>
              ) : null}
            </SidebarMenuButton>
          }
        />
        {collapsed ? (
          <TooltipPopup side="right">
            {t("Customize · {status}", { status: statusLabel })}
          </TooltipPopup>
        ) : null}
      </Tooltip>
    </SidebarMenuItem>
  );
}

function SidebarPluginSummary({ onClick }: { readonly onClick: () => void }) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();

  if (!environmentId) {
    return (
      <SidebarPluginButton
        enabledCount={0}
        onClick={onClick}
        statusLabel={t("Connect an environment")}
      />
    );
  }

  return <SidebarPluginSummaryForEnvironment environmentId={environmentId} onClick={onClick} />;
}

/** Status that must stay visible whatever chrome hosts it: update notices. */
export function SidebarStatusStack({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 empty:hidden", className)}>
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
    </div>
  );
}

/**
 * A footer destination. Expanded, it reads as a labeled row — four unlabeled
 * icons asked the user to remember which glyph meant Usage and which meant
 * Feedback. Collapsed to the icon rail there is no room for the label, so the
 * tooltip carries it there and only there.
 */
export function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const { state } = useSidebar();

  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              className="group-data-[collapsible=icon]:justify-center"
              onClick={onClick}
            >
              {icon}
              <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
            </SidebarMenuButton>
          }
        />
        {state === "collapsed" ? <TooltipPopup side="right">{label}</TooltipPopup> : null}
      </Tooltip>
    </SidebarMenuItem>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const handlePluginsClick = useCallback(() => {
    closeMobileSidebar();
    openCustomize();
  }, [closeMobileSidebar]);

  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    openSettings();
  }, [closeMobileSidebar]);

  return (
    <SidebarFooter className="max-h-(--spacing-min-45dvh-22rem) shrink-0 overflow-y-auto overscroll-contain p-(--sidebar-content-inset)">
      <div className="flex flex-col gap-2 empty:hidden group-data-[collapsible=icon]:hidden">
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
      </div>
      {/* A labeled column, not a row of glyphs: each destination gets a
          full-width row with a comfortable hit target. The icon rail collapses
          it back to centered icons. */}
      <SidebarMenu density="tight" className="flex-col flex-nowrap overflow-visible">
        <SidebarPluginSummary onClick={handlePluginsClick} />
      </SidebarMenu>
      <div className="flex empty:hidden group-data-[collapsible=icon]:justify-center">
        <SidebarUpdatePill />
      </div>
      <SidebarMenu density="tight" className="flex-col flex-nowrap overflow-visible">
        <SidebarUtilityItem
          icon={<AppIcon className="size-4" icon={RiSettings3Line} />}
          label={t("Settings")}
          onClick={handleSettingsClick}
        />
      </SidebarMenu>
    </SidebarFooter>
  );
});
