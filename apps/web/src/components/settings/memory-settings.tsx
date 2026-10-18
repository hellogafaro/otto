import { RiArrowRightSLine } from "@remixicon/react";
import { useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { BotMemorySheet } from "../roster/bot-memory-sheet";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";

// Otto: Memory is what bots remember. The switch is a server setting, so it applies to the whole organization.
export function MemorySettingsPanel() {
  const { memory } = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const environmentId = usePrimaryEnvironmentId();
  const [open, setOpen] = useState(false);
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
        <SettingsRow
          title={t("Memories")}
          description={t("Yours and the team's. Add, fix or delete what bots remember.")}
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!environmentId}
              onClick={() => setOpen(true)}
            >
              {t("View")}
              <RiArrowRightSLine aria-hidden />
            </Button>
          }
        />
      </SettingsSection>
      {environmentId ? (
        <BotMemorySheet
          open={open}
          onOpenChange={setOpen}
          environmentId={environmentId}
          projectId={null}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
