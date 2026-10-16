import {
  sharedProjectMemoryAutoSaves,
  sharedProjectMemoryMode,
} from "@otto/client-runtime/durable-memory";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";

// Otto: Memory is what bots remember. The switches are server settings, so they apply to the whole organization.
export function MemorySettingsPanel() {
  const { memory } = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const { t } = useI18n();

  const disabledHint = memory.enabled ? "" : ` ${t("Turn on Memory to change this.")}`;

  return (
    <SettingsPageContainer>
      <SettingsSection title={t("Memory")}>
        <SettingsRow
          {...searchableSetting("memory-enabled", t)}
          description={t("Keep durable facts that bots can use across chats.")}
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
        <SettingsRow
          {...searchableSetting("memory-private-bot", t)}
          description={`${t("Let each bot keep facts about you that only that bot uses.")}${disabledHint}`}
          control={
            <Switch
              checked={memory.privateBotMemory}
              disabled={!memory.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ memory: { privateBotMemory: Boolean(checked) } })
              }
              aria-label={t("Private bot memory")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("memory-shared-project", t)}
          description={`${t("Bots wait for your approval before saving facts to a shared project.")}${disabledHint}`}
          control={
            <Switch
              checked={!sharedProjectMemoryAutoSaves(memory.sharedProjectMemory)}
              disabled={!memory.enabled}
              onCheckedChange={(checked) =>
                updateSettings({
                  memory: { sharedProjectMemory: sharedProjectMemoryMode(!checked) },
                })
              }
              aria-label={t("Ask before saving project memory")}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
