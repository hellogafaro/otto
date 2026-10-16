import type { MessageKey } from "@otto/client-runtime/i18n";
import type { SettingsSection } from "./settings-dialog-store";
import {
  parseSettingsDeepLinkId,
  type SettingsDeepLinkId,
} from "@otto/client-runtime/settings-deep-link";

/** Customize is its own page rather than a Settings section. */
export type SettingsDeepLinkSection = SettingsSection | "customize";

// Keyed by every shared id so a new Settings section cannot ship without a web destination.
const destinations: Readonly<
  Record<
    SettingsDeepLinkId,
    {
      readonly section: SettingsDeepLinkSection;
      readonly label: MessageKey;
      readonly targetId?: string;
    }
  >
> = {
  general: { section: "general", label: "General" },
  usage: { section: "usage", label: "Usage" },
  "local-execution": {
    section: "computer",
    label: "Computer > Local execution",
    targetId: "local-execution",
  },
  appearance: { section: "appearance", label: "Appearance" },
  keybindings: { section: "keybindings", label: "Shortcuts" },
  account: { section: "account", label: "Profile" },
  organization: { section: "organization", label: "Organization" },
  members: { section: "members", label: "Members" },
  providers: { section: "providers", label: "Models" },
  channels: { section: "channels", label: "Channels" },
  voice: { section: "providers", label: "Models > Voice", targetId: "voice" },
  "image-generation": {
    section: "providers",
    label: "Models > Image generation",
    targetId: "image-generation",
  },
  browser: { section: "computer", label: "Computer > Browser", targetId: "browser" },
  plugins: { section: "customize", label: "Customize" },
  sandbox: { section: "computer", label: "Computer" },
  // Otto: The Privacy page is gone; its only live settings are on Memory.
  privacy: { section: "memory", label: "Memory" },
  "archived-chats": { section: "archived", label: "Archived chats" },
  // Otto: The bot inbox and Diagnostics pages are gone; old chips open General.
  "bot-inbox": { section: "general", label: "General" },
  diagnostics: { section: "general", label: "General" },
};

export interface SettingsDeepLinkDestination {
  readonly section: SettingsDeepLinkSection;
  readonly targetId: string | null;
  /** Catalog label for the destination, shown as "Open Settings > {label}". */
  readonly label: MessageKey;
}

export function parseSettingsDeepLink(
  href: string | undefined,
): SettingsDeepLinkDestination | null {
  const id = parseSettingsDeepLinkId(href);

  if (id === null) return null;
  const destination = destinations[id];

  return {
    section: destination.section,
    targetId: destination.targetId ?? null,
    label: destination.label,
  };
}
