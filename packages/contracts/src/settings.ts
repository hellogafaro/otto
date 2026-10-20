import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "./settings/client.ts";
import { ServerSettings, DEFAULT_SERVER_SETTINGS } from "./settings/server.ts";

// ── Server Settings (server-authoritative) ────────────────────

// Moved to environment.ts so orchestration contracts can use it without an
// import cycle; re-exported here for compatibility with deep imports.
export { ThreadEnvMode } from "./environment.ts";

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;

export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

export {
  TimestampFormat,
  DEFAULT_TIMESTAMP_FORMAT,
  SidebarProjectSortOrder,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  SidebarThreadSortOrder,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  SidebarProjectGroupingMode,
  DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  SidebarThreadPreviewCount,
  DEFAULT_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_GLASS_OPACITY,
  MAX_GLASS_OPACITY,
  GlassOpacity,
  DEFAULT_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  InterfaceFontSize,
  DEFAULT_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  CodeFontSize,
  DEFAULT_CODE_FONT_SIZE,
  QuitConfirmationMode,
  DEFAULT_QUIT_CONFIRMATION_MODE,
  OTTO_DOCUMENTATION_URL,
  DEFAULT_BROWSER_VIEWPORT,
  ClientSettingsSchema,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  ClientSettingsPatch,
} from "./settings/client.ts";

export {
  type ProviderSettingsFormControl,
  type ProviderSettingsFormAnnotation,
  type ProviderSettingsFormSchemaAnnotation,
  type ProviderSettingsOrder,
  providerSettingsSchema,
} from "./settings/provider-forms.ts";

export {
  CodexSettings,
  ClaudeSettings,
  GrokSettings,
  KimiSettings,
  OpenCodeGoSettings,
  CustomOpenaiSettings,
  OpenCodeSettings,
  providerInstanceConfigEnabledFlag,
} from "./settings/providers.ts";

export {
  defaultEnabledForDriver,
  resolveProviderInstanceEnabled,
  ObservabilitySettings,
  SourceControlWritingStyleMode,
  SourceControlWritingStyleSettings,
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  BackgroundActivityProfile,
  DEFAULT_BACKGROUND_ACTIVITY_PROFILE,
  BackgroundActivityProfileSelection,
  BackgroundActivityOverrides,
  BackgroundActivitySettings,
  ChannelConnectionProfile,
  ServerSettings,
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsOperation,
  ServerSettingsError,
  ServerSettingsPatch,
  ServerSettingsRpcPatch,
} from "./settings/server.ts";

export {
  SandboxProvider,
  type CloudSandboxProvider,
  CLOUD_SANDBOX_PROVIDERS,
  SANDBOX_PROVIDER_CREDENTIALS,
  SandboxProviderConnection,
  SandboxSettings,
} from "./settings/sandbox.ts";

export { MemorySettings, MemorySettingsPatch } from "./settings/memory.ts";
