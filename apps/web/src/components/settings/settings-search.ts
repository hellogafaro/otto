import { isElectron } from "~/env";

export type SettingsPath =
  | "/settings/models"
  | "/settings/voice"
  | "/settings/channels"
  | "/settings/computer"
  | "/settings/general"
  | "/settings/usage"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/memory"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  readonly keywords?: ReadonlyArray<string>;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
}

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "usage",
    title: "Usage",
    to: "/settings/usage",
    keywords: ["limits", "quota", "tokens", "cost"],
  },
  {
    id: "language",
    title: "Language",
    to: "/settings/general",
    keywords: [
      "locale",
      "translation",
      "English",
      "system default",
      "device language",
      "Chinese",
      "中文",
      "简体中文",
    ],
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    // The Color scheme section carries the page's `appearance` anchor.
    targetId: "appearance",
  },
  {
    id: "interface-font-size",
    title: "Interface font size",
    to: "/settings/appearance",
  },
  {
    id: "code-font-size",
    title: "Code font size",
    to: "/settings/appearance",
  },
  {
    id: "sandbox-browser-sharing",
    title: "Sandbox and browser sharing",
    to: "/settings/computer",
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
  },
  {
    id: "memory-enabled",
    title: "Memory",
    to: "/settings/memory",
    keywords: ["durable facts", "remember"],
  },
  {
    id: "memory-private-bot",
    title: "Private bot memory",
    to: "/settings/memory",
    keywords: ["memory"],
  },
  {
    id: "memory-shared-project",
    title: "Ask before saving project memory",
    to: "/settings/memory",
    keywords: ["memory", "approval"],
  },
  {
    id: "local-execution",
    title: "Local execution",
    to: "/settings/computer",
  },
  {
    id: "voice-enabled",
    title: "Voice calls",
    to: "/settings/voice",
  },
  {
    id: "voice-provider",
    title: "Voice provider",
    to: "/settings/voice",
  },
  {
    id: "voice-selection",
    title: "Voice selection",
    to: "/settings/voice",
  },
  {
    id: "voice-openai-voice",
    title: "OpenAI API voice",
    to: "/settings/voice",
    keywords: ["realtime", "interrupt"],
  },
  {
    id: "voice-transcription-provider",
    title: "Transcription provider",
    to: "/settings/voice",
    keywords: ["speech to text", "OpenAI", "ElevenLabs", "Cartesia"],
  },
  {
    id: "voice-synthesis-provider",
    title: "Speech provider",
    to: "/settings/voice",
    keywords: ["text to speech", "OpenAI", "ElevenLabs", "Cartesia", "Fish Audio"],
  },
  {
    id: "voice-synthesis-voice",
    title: "Speech voice",
    to: "/settings/voice",
  },
  {
    id: "voice-api-connections",
    title: "Voice API connections",
    to: "/settings/voice",
    keywords: ["API key", "OpenAI", "ElevenLabs", "Cartesia", "Fish Audio", "billing"],
  },
  {
    id: "image-generation",
    title: "Image generation",
    to: "/settings/models",
    keywords: ["images", "pictures", "ChatGPT", "Grok", "health test"],
  },
  {
    id: "image-provider-chatgpt",
    title: "ChatGPT images",
    to: "/settings/models",
    keywords: ["image", "OpenAI", "subscription"],
  },
  {
    id: "image-provider-grok",
    title: "Grok images",
    to: "/settings/models",
    keywords: ["image", "xAI", "subscription"],
  },
  {
    id: "image-default-provider",
    title: "Default image provider",
    to: "/settings/models",
  },
  {
    id: "image-fallback-order",
    title: "Image fallback order",
    to: "/settings/models",
    keywords: ["retry", "backup"],
  },
  {
    id: "voice-read-aloud",
    title: "Read new replies aloud",
    to: "/settings/voice",
    keywords: ["read aloud", "speech", "playback", "automatic readout"],
  },
  {
    id: "quit-confirmation",
    title: "Quit shortcut",
    to: "/settings/general",
    keywords: ["confirmation", "desktop", "exit", "direct", "hold", "double click", "press twice"],
    desktopOnly: true,
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
    keywords: ["shortcuts", "keyboard"],
  },
  {
    id: "archived-chats",
    title: "Archived chats",
    to: "/settings/archived",
    keywords: ["archive", "unarchive", "restore", "delete"],
  },
  {
    id: "archived-bots",
    title: "Archived bots",
    to: "/settings/archived",
    targetId: "archived-bots",
    keywords: ["archive", "restore", "delete", "bot"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/models",
    keywords: [
      "models",
      "ChatGPT",
      "Codex",
      "Claude",
      "Grok",
      "Kimi",
      "OpenCode",
      "API key",
      "Subscription",
    ],
  },
  {
    id: "sandbox",
    title: "Sandbox",
    to: "/settings/computer",
    keywords: ["computer", "machine"],
  },
  {
    id: "default-sandbox",
    title: "Default sandbox",
    to: "/settings/computer",
  },
  {
    id: "sandbox-auto-idle",
    title: "Sandbox auto-idle",
    to: "/settings/computer",
  },
  {
    id: "agent-browser-access",
    title: "Bot browser access",
    to: "/settings/computer",
    targetId: "browser",
  },
  {
    id: "browser-default-viewport",
    title: "Default browser viewport",
    to: "/settings/computer",
    targetId: "browser",
  },
  {
    id: "browser-default-zoom",
    title: "Default browser zoom",
    to: "/settings/computer",
    targetId: "browser",
  },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    to: "/settings/computer",
    targetId: "browser",
  },
  {
    id: "bot-channels",
    title: "Bot channels",
    to: "/settings/channels",
    keywords: [
      "Channels",
      "Telegram",
      "iMessage",
      "Photon",
      "WhatsApp",
      "Slack",
      "Discord",
      "messaging",
      "webhook",
      "credentials",
    ],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]));

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart. Pass the active translator so
 * the title follows the interface language.
 */
export function searchableSetting(
  id: SettingsSearchItemId,
  translate: (message: string) => string = (message) => message,
) {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;

  return { id: anchorId, title: translate(title) };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
  translateTitle: (title: string) => string = (title) => title,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length === 0) return [];

  return items.filter(
    (item) =>
      (isElectron || item.desktopOnly !== true) &&
      [item.title, translateTitle(item.title), ...(item.keywords ?? [])].some((value) =>
        normalizeSearchText(value).includes(normalizedQuery),
      ),
  );
}
