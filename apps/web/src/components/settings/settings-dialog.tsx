import {
  RiArchiveLine,
  RiBarChartLine,
  RiUserLine,
  RiGroupLine,
  RiBuildingLine,
  RiBrainLine,
  RiComputerLine,
  RiKeyboardLine,
  RiChat3Line,
  RiPaintBrushLine,
  RiPuzzleLine,
  RiRobot3Line,
  RiSparkling2Line,
  RiLightbulbLine,
  RiSettings3Line,
  type RemixiconComponentType,
} from "@remixicon/react";

import type { MessageKey } from "@otto/client-runtime/i18n";
import { Fragment, Suspense, lazy, type ComponentType } from "react";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { AppIcon } from "~/components/ui/app-icon";
import {
  closeSettings,
  useSettingsDialogStore,
  type SettingsSection,
} from "~/settings-dialog-store";
import { GeneralSettingsPanel } from "./general-settings-panel";
import { SettingsPageSkeleton } from "./settings-layout";

// General, the default page, is imported eagerly so it never waits on a chunk.
// The other pages load on demand.
const AppearanceSettingsPanel = lazy(async () => ({
  default: (await import("./settings-panels")).AppearanceSettingsPanel,
}));

const UsageSettingsPanel = lazy(async () => ({
  default: (await import("../usage/usage-page")).UsagePage,
}));

const ProvidersSettingsPage = lazy(async () => ({
  default: (await import("./settings-pages")).ProvidersSettingsPage,
}));

const ComputerSettingsPage = lazy(async () => ({
  default: (await import("./settings-pages")).ComputerSettingsPage,
}));

const BotChannelsSettingsPanel = lazy(async () => ({
  default: (await import("./bot-channels-settings")).BotChannelsSettingsPanel,
}));

const MemorySettingsPanel = lazy(async () => ({
  default: (await import("./memory-settings")).MemorySettingsPanel,
}));

const KeybindingsSettingsPanel = lazy(async () => ({
  default: (await import("./keybindings-settings")).KeybindingsSettingsPanel,
}));

const ArchivedChatsSettingsPanel = lazy(async () => ({
  default: (await import("./archived-chats-settings")).ArchivedChatsSettingsPanel,
}));

const AccountSettingsPanel = lazy(async () => ({
  default: (await import("./organization-account-settings")).AccountSettingsPanel,
}));

const IntegrationsSettingsPanel = lazy(async () => ({
  default: (await import("./integrations-settings")).IntegrationsSettingsPanel,
}));

const SkillsSettingsPanel = lazy(async () => ({
  default: (await import("./integrations-settings")).SkillsSettingsPanel,
}));

const BotsSettingsPanel = lazy(async () => ({
  default: (await import("./bots-settings")).BotsSettingsPanel,
}));

const OrganizationSettingsPanel = lazy(async () => ({
  default: (await import("./organization-account-settings")).OrganizationSettingsPanel,
}));

const OrganizationMembersSettings = lazy(async () => ({
  default: (await import("./organization-members-settings")).OrganizationMembersSettings,
}));

const SECTION_PANELS: Readonly<Record<SettingsSection, ComponentType>> = {
  account: AccountSettingsPanel,
  organization: OrganizationSettingsPanel,
  integrations: IntegrationsSettingsPanel,
  bots: BotsSettingsPanel,
  skills: SkillsSettingsPanel,
  members: OrganizationMembersSettings,
  general: GeneralSettingsPanel,
  usage: UsageSettingsPanel,
  appearance: AppearanceSettingsPanel,
  keybindings: KeybindingsSettingsPanel,
  memory: MemorySettingsPanel,
  archived: ArchivedChatsSettingsPanel,
  providers: ProvidersSettingsPage,
  channels: BotChannelsSettingsPanel,
  computer: ComputerSettingsPage,
};

export function SettingsPanelForSection({ section }: { readonly section: SettingsSection }) {
  const Panel = SECTION_PANELS[section];

  return (
    <Suspense fallback={<SettingsPageSkeleton />}>
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

export interface SettingsNavGroup {
  /** Null for your own pages, which head the list without a heading, like Capy. */
  readonly label: MessageKey | null;
  readonly items: ReadonlyArray<SettingsNavItem>;
}

/**
 * Nav rows in display order: your own pages first (General, the default page,
 * heads the list), then what bots are and can use, then the organization.
 */
export const SETTINGS_NAV_GROUPS: ReadonlyArray<SettingsNavGroup> = [
  {
    label: null,
    items: [
      { section: "general", label: "General", icon: RiSettings3Line },
      { section: "account", label: "Profile", icon: RiUserLine },
      { section: "appearance", label: "Appearance", icon: RiPaintBrushLine },
      { section: "keybindings", label: "Shortcuts", icon: RiKeyboardLine },
      { section: "archived", label: "Archived", icon: RiArchiveLine },
    ],
  },
  {
    label: "Bots",
    items: [
      { section: "bots", label: "Bots", icon: RiRobot3Line },
      { section: "skills", label: "Skills", icon: RiSparkling2Line },
      { section: "memory", label: "Memory", icon: RiLightbulbLine },
      { section: "integrations", label: "Integrations", icon: RiPuzzleLine },
      { section: "providers", label: "Models", icon: RiBrainLine },
      { section: "channels", label: "Channels", icon: RiChat3Line },
      { section: "computer", label: "Computer", icon: RiComputerLine },
    ],
  },
  {
    label: "Organization",
    items: [
      { section: "organization", label: "General", icon: RiBuildingLine },
      { section: "members", label: "Members", icon: RiGroupLine },
      { section: "usage", label: "Usage", icon: RiBarChartLine },
    ],
  },
];

export const SETTINGS_NAV_ITEMS: ReadonlyArray<SettingsNavItem> = SETTINGS_NAV_GROUPS.flatMap(
  (group) => group.items,
);

/** Catalog key naming a section; callers translate it with `t`. */
export function settingsSectionLabel(section: SettingsSection): MessageKey {
  return SETTINGS_NAV_ITEMS.find((item) => item.section === section)?.label ?? "Settings";
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
            <Fragment key={group.label ?? "personal"}>
              {group.label ? (
                <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground max-sm:hidden">
                  {t(group.label)}
                </div>
              ) : null}
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
