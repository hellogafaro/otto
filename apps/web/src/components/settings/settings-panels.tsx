import { ColorSchemeSettings } from "./theme-settings";
import { SettingsPageContainer, SettingsSection } from "./settings-layout";
import { useI18n } from "../../i18n";
import { TypographyRows } from "./typography-settings";

export function AppearanceSettingsPanel() {
  const { t } = useI18n();

  return (
    <SettingsPageContainer>
      <SettingsSection id="display" title={t("Appearance")}>
        <ColorSchemeSettings />
        <TypographyRows />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export { useSettingsRestore } from "./use-settings-restore";

export {
  BotSandboxBrowserSharingSettings,
  FallbackModelSettingsRow,
  BotWorkspaceSettingsSection,
} from "./bot-workspace-settings";
