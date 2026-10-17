import { DEFAULT_SERVER_SETTINGS } from "@otto/contracts";
import { useState } from "react";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { usePrimaryEnvironment } from "~/state/environments";
import { Switch } from "../ui/switch";
import { useOptionalReplyPlayback } from "../chat/reply-playback-provider";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import { useI18n } from "../../i18n";
import { VoiceModeRows } from "./voice-mode-settings";
import { useVoiceProviders, VoiceApiConnectionsSection } from "./voice-api-connections";
import { AutomaticReadoutRow } from "./voice-readout-settings";
import { VOICE_SPEECH_PROVIDERS } from "./voice-settings.logic";

/** The Voice page's rows; the page supplies the container. */
export function VoiceSettingsSection() {
  const { t } = useI18n();
  const voice = usePrimarySettings((settings) => settings.voice);
  const updateSettings = useUpdatePrimarySettings();
  const replyPlayback = useOptionalReplyPlayback();
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const { connected, serverRejected, loadError, refresh } = useVoiceProviders(environmentId);

  // Bumped when a key is saved so the voice list reloads for the new account.
  const [keyRevision, setKeyRevision] = useState(0);

  return (
    <>
      <SettingsSection id="voice" title={t("Voice")}>
        <SettingsRow
          {...searchableSetting("voice-enabled", t)}
          description="Allow bots with Voice calls enabled to start voice calls."
          resetAction={
            voice.enabled !== DEFAULT_SERVER_SETTINGS.voice.enabled ? (
              <SettingResetButton
                label="voice"
                onClick={() =>
                  updateSettings({ voice: { enabled: DEFAULT_SERVER_SETTINGS.voice.enabled } })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={voice.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ voice: { enabled: Boolean(checked) } })
              }
              aria-label="Enable voice"
            />
          }
        />
        <VoiceModeRows
          voice={voice}
          environmentId={environmentId}
          connected={connected}
          keyRevision={keyRevision}
          onChange={updateSettings}
        />
        {replyPlayback ? <AutomaticReadoutRow preference={replyPlayback.preference} /> : null}
      </SettingsSection>
      {environmentId ? (
        <VoiceApiConnectionsSection
          key={environmentId}
          providers={VOICE_SPEECH_PROVIDERS}
          searchId="voice-api-connections"
          emptyMessage={t("Add a provider for API voice calls and read-aloud.")}
          environmentId={environmentId}
          connected={connected}
          serverRejected={serverRejected}
          loadError={loadError}
          onChanged={refresh}
          onKeySaved={() => setKeyRevision((revision) => revision + 1)}
        />
      ) : null}
    </>
  );
}

export { VoiceModeRows } from "./voice-mode-settings";

export { VoiceApiProviderRow } from "./voice-api-connections";
