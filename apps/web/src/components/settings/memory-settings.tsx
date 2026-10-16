import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";

// Otto: Memory is what bots remember. The switch is a server setting, so it applies to the whole organization.
export function MemorySettingsPanel() {
  const { memory } = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const { t } = useI18n();

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("Memory")}>
        <SettingsRow
          {...searchableSetting("memory-enabled", t)}
          description={t("Bots remember facts across chats.")}
          control={
            <Switch
              checked={memory.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ memory: { enabled: Boolean(checked) } })
              }
              aria-label={t("Memory")}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
