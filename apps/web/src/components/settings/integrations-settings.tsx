import { useI18n } from "../../i18n";
import { useSettingsEnvironmentId } from "../../settings-dialog-store";
import { CustomizeIntegrations } from "../customize/customize-integrations";
import { CustomizeSkills } from "../customize/customize-skills";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { SettingsPageContainer } from "./settings-layout";

/** Otto: Integrations: GitHub, apps and remote MCP servers, yours and the team's. */
export function IntegrationsSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId ? (
        <CustomizeIntegrations environmentId={environmentId} />
      ) : (
        <SkeletonSettingsSections label={t("Loading settings")} />
      )}
    </SettingsPageContainer>
  );
}

/** Otto: Skills, under Settings' Customize, as Customize showed them. */
export function SkillsSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId ? (
        <CustomizeSkills environmentId={environmentId} />
      ) : (
        <SkeletonSettingsSections label={t("Loading settings")} />
      )}
    </SettingsPageContainer>
  );
}
