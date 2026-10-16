import { useCallback, useMemo } from "react";
import { ProviderDriverKind } from "@otto/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@otto/contracts/settings";
import * as Equal from "effect/Equal";
import { readAppearanceModePreference, useTheme } from "../../hooks/use-theme";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/use-settings";
import { ensureLocalApi, readLocalApi } from "../../local-api";
import { toast } from "sonner";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
} from "./settings-panels.logic";
import { useI18n } from "../../i18n";

export const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

export function resetBackgroundActivitySettings() {
  return {
    backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  };
}

export function useSettingsRestore(onRestored?: () => void) {
  const { appearanceMode, setAppearanceMode } = useTheme();

  const { t, translate } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = useMemo(
    () => [
      ...(appearanceMode !== "system" ? ["Color scheme"] : []),
      ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible chats"]
        : []),
      ...getChangedTypographySettingLabels(settings),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Diff whitespace changes"]
        : []),
      ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
        ? ["Show skills in slash menu"]
        : []),
      ...(settings.enableLegacyTokenStreaming !==
      DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming
        ? ["Stream token by token"]
        : []),
      ...(settings.botSandboxBrowserSharing !== DEFAULT_UNIFIED_SETTINGS.botSandboxBrowserSharing
        ? ["Sandbox and browser sharing"]
        : []),
      ...(isBackgroundActivityDirty ? ["Background activity"] : []),
      ...(settings.localExecutionMode !== DEFAULT_UNIFIED_SETTINGS.localExecutionMode
        ? ["Local execution"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? ["Quit shortcut"] : []),
      ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
      ...getChangedBrowserSettingLabels(settings),
      ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
        ? ["Bot browser access"]
        : []),
      ...(!Equal.equals(settings.voice, DEFAULT_UNIFIED_SETTINGS.voice) ? ["Voice"] : []),
    ],
    [
      isTextGenerationModelDirty,
      isBackgroundActivityDirty,
      settings.browserDefaultViewport,
      settings.browserDefaultZoomFactor,
      settings.browserDefaultAppearance,
      settings.enableAgentBrowserAccess,
      settings.voice,
      settings.confirmQuit,
      settings.addProjectBaseDirectory,
      settings.localExecutionMode,
      settings.diffIgnoreWhitespace,
      settings.fontSizeCode,
      settings.fontSizeInterface,
      settings.glassOpacity,
      settings.enableLegacyTokenStreaming,
      settings.enableProviderUpdateChecks,
      settings.botSandboxBrowserSharing,
      settings.sidebarThreadPreviewCount,
      settings.showSkillsInSlashMenu,
      settings.timestampFormat,
      appearanceMode,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();

    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      [
        t("Restore default settings?"),
        t("This will reset: {settings}.", {
          settings: changedSettingLabels.map((label) => translate(label)).join(", "),
        }),
      ].join("\n"),
      { variant: "destructive" },
    );

    if (!confirmed) return;

    if (readAppearanceModePreference("otto-paper") !== "system" && !setAppearanceMode("system")) {
      toast.error(t("Theme settings couldn't be restored"));

      return;
    }

    updateSettings({
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      enableLegacyTokenStreaming: DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      botSandboxBrowserSharing: DEFAULT_UNIFIED_SETTINGS.botSandboxBrowserSharing,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      localExecutionMode: DEFAULT_UNIFIED_SETTINGS.localExecutionMode,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      // Re-granted like any other default. The confirmation dialog lists it by
      // name, so a user restoring defaults is told the agent regains access
      // rather than discovering it later.
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
      voice: DEFAULT_UNIFIED_SETTINGS.voice,
    });
    onRestored?.();
  }, [changedSettingLabels, onRestored, setAppearanceMode, t, translate, updateSettings]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}
