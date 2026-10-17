import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "~/i18n";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settings-layout";

/** Otto: Browser holds Bot browser access: whether an @browser mention lets a bot use a browser on its computer. */
export function BrowserSettingsSection() {
  const { t } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const botAccess = settings.enableAgentBrowserAccess ?? true;

  return (
    <SettingsSection id="browser" title={t("Browser")}>
      <SettingsRow
        title={t("Bot browser access")}
        description={t("Bots can use a browser on their own computer when you mention @browser.")}
        control={
          <Switch
            aria-label={t("Bot browser access")}
            checked={botAccess}
            onCheckedChange={(checked) =>
              updateSettings({ enableAgentBrowserAccess: Boolean(checked) })
            }
          />
        }
      />
    </SettingsSection>
  );
}
