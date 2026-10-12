import {
  RiArchiveLine,
  RiBarChartLine,
  RiUserLine,
  RiGroupLine,
  RiBuildingLine,
  RiRobot2Line,
  RiGlobalLine,
  RiHardDriveLine,
  RiImageLine,
  RiKeyboardLine,
  RiLink,
  RiChat3Line,
  RiPaintBrushLine,
  RiShieldCheckLine,
  RiSettings3Line,
  RiEqualizerLine,
  type RemixiconComponentType,
} from "@remixicon/react";

import type { MessageKey } from "@otto/client-runtime/i18n";
import { Fragment, Suspense, lazy, type ComponentType } from "react";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { AppIcon } from "~/components/ui/app-icon";
import { Spinner } from "~/components/ui/spinner";
import { closeSettings, useSettingsDialogStore, type SettingsSection } from "~/settingsDialogStore";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";

// General, the default page, is imported eagerly so it never waits on a chunk.
// The other pages load on demand.
const AppearanceSettingsPanel = lazy(async () => ({
  default: (await import("./SettingsPanels")).AppearanceSettingsPanel,
}));

const UsageSettingsPanel = lazy(async () => ({
  default: (await import("../usage/UsagePage")).UsagePage,
}));

const ProvidersSettingsPage = lazy(async () => ({
  default: (await import("./SettingsPages")).ProvidersSettingsPage,
}));

const SandboxSettingsPage = lazy(async () => ({
  default: (await import("./SettingsPages")).SandboxSettingsPage,
}));

const BrowserSettingsPage = lazy(async () => ({
  default: (await import("./SettingsPages")).BrowserSettingsPage,
}));

const AdvancedSettingsPage = lazy(async () => ({
  default: (await import("./SettingsPages")).AdvancedSettingsPage,
}));

const BotChannelsSettingsPanel = lazy(async () => ({
  default: (await import("./BotChannelsSettings")).BotChannelsSettingsPanel,
}));

const PrivacySettingsPanel = lazy(async () => ({
  default: (await import("./PrivacySettings")).PrivacySettingsPanel,
}));

const ConnectionsSettings = lazy(async () => ({
  default: (await import("./ConnectionsSettings")).ConnectionsSettings,
}));

const KeybindingsSettingsPanel = lazy(async () => ({
  default: (await import("./KeybindingsSettings")).KeybindingsSettingsPanel,
}));

const ImageGenerationSettingsPanel = lazy(async () => ({
  default: (await import("./ImageGenerationSettings")).ImageGenerationSettingsPanel,
}));

const ArchivedChatsSettingsPanel = lazy(async () => ({
  default: (await import("./ArchivedChatsSettings")).ArchivedChatsSettingsPanel,
}));

const DiagnosticsSettingsPanel = lazy(async () => ({
  default: (await import("./DiagnosticsSettings")).DiagnosticsSettingsPanel,
}));

const AccountSettingsPanel = lazy(async () => ({
  default: (await import("./OrganizationAccountSettings")).AccountSettingsPanel,
}));

const OrganizationSettingsPanel = lazy(async () => ({
  default: (await import("./OrganizationAccountSettings")).OrganizationSettingsPanel,
}));

const OrganizationMembersSettings = lazy(async () => ({
  default: (await import("./OrganizationMembersSettings")).OrganizationMembersSettings,
}));

const SECTION_PANELS: Readonly<Record<SettingsSection, ComponentType>> = {
  account: AccountSettingsPanel,
  organization: OrganizationSettingsPanel,
  members: OrganizationMembersSettings,
  general: GeneralSettingsPanel,
  usage: UsageSettingsPanel,
  appearance: AppearanceSettingsPanel,
  keybindings: KeybindingsSettingsPanel,
  connections: ConnectionsSettings,
  privacy: PrivacySettingsPanel,
  archived: ArchivedChatsSettingsPanel,
  advanced: AdvancedSettingsPage,
  providers: ProvidersSettingsPage,
  channels: BotChannelsSettingsPanel,
  sandbox: SandboxSettingsPage,
  browser: BrowserSettingsPage,
  "image-generation": ImageGenerationSettingsPanel,
  diagnostics: DiagnosticsSettingsPanel,
};

export function SettingsPanelForSection({ section }: { readonly section: SettingsSection }) {
  const Panel = SECTION_PANELS[section];

  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <Panel />
    </Suspense>
  );
}

export interface SettingsNavItem {
  readonly section: SettingsSection;
  /** Catalog key; translate with `t(item.label)` at render time. */
  readonly label: MessageKey;
  readonly icon: RemixiconComponentType;
}

/**
 * Nav rows in display order, grouped. App comes first so General, the default
 * page, heads the list. Diagnostics has no row; it opens from links inside
 * other pages.
 */
export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly label: MessageKey;
  readonly items: ReadonlyArray<SettingsNavItem>;
}> = [
  {
    label: "App",
    items: [
      { section: "general", label: "General", icon: RiSettings3Line },
      { section: "usage", label: "Usage", icon: RiBarChartLine },
      { section: "appearance", label: "Appearance", icon: RiPaintBrushLine },
      { section: "keybindings", label: "Keyboard", icon: RiKeyboardLine },
      { section: "connections", label: "Connections", icon: RiLink },
      { section: "privacy", label: "Privacy & data", icon: RiShieldCheckLine },
      { section: "archived", label: "Archived", icon: RiArchiveLine },
      { section: "advanced", label: "Advanced", icon: RiEqualizerLine },
    ],
  },
  {
    label: "Organization",
    items: [
      { section: "account", label: "Account", icon: RiUserLine },
      { section: "organization", label: "Organization", icon: RiBuildingLine },
      { section: "members", label: "Members", icon: RiGroupLine },
    ],
  },
  {
    label: "Bots",
    items: [
      { section: "providers", label: "Providers", icon: RiRobot2Line },
      { section: "channels", label: "Channels", icon: RiChat3Line },
      { section: "sandbox", label: "Sandbox", icon: RiHardDriveLine },
      { section: "browser", label: "Browser", icon: RiGlobalLine },
      { section: "image-generation", label: "Image generation", icon: RiImageLine },
    ],
  },
];

export const SETTINGS_NAV_ITEMS: ReadonlyArray<SettingsNavItem> = SETTINGS_NAV_GROUPS.flatMap(
  (group) => group.items,
);

/** Header labels for pages without a nav row. */
const UNLISTED_SECTION_LABELS: Readonly<Partial<Record<SettingsSection, MessageKey>>> = {
  diagnostics: "Diagnostics",
};

/** Catalog key naming a section; callers translate it with `t`. */
export function settingsSectionLabel(section: SettingsSection): MessageKey {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.section === section)?.label ??
    UNLISTED_SECTION_LABELS[section] ??
    "Settings"
  );
}

export function SettingsDialog() {
  const { t } = useI18n();
  const section = useSettingsDialogStore((state) => state.section);
  const openSettings = useSettingsDialogStore((state) => state.openSettings);

  return (
    <Dialog
      open={section !== null}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <DialogPopup
        className="h-(--spacing-min-44rem-88dvh) max-w-4xl flex-row overflow-hidden max-sm:flex-col"
        bottomStickOnMobile={false}
      >
        <DialogTitle className="sr-only">{t("Settings")}</DialogTitle>
        <nav
          aria-label={t("Settings sections")}
          className="flex w-52 shrink-0 flex-col gap-0.5 border-e bg-muted/30 p-2 max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-e-0 max-sm:border-b"
        >
          {SETTINGS_NAV_GROUPS.map((group) => (
            <Fragment key={group.label}>
              <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground max-sm:hidden">
                {t(group.label)}
              </div>
              {group.items.map((item) => {
                const isActive = section === item.section;

                return (
                  <button
                    key={item.section}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => openSettings(item.section)}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <AppIcon className="size-4 shrink-0" icon={item.icon} />
                    <span className="truncate">{t(item.label)}</span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {section ? <SettingsPanelForSection section={section} /> : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
