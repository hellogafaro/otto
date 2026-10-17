import type { VoiceApiProvider, VoiceSettings } from "@otto/contracts";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { usePrimaryEnvironment } from "~/state/environments";
import { useI18n } from "../../i18n";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import { useVoiceProviders, VoiceApiConnectionsSection } from "./voice-api-connections";
import {
  VOICE_API_PROVIDER_LABELS,
  VOICE_TRANSCRIPTION_PROVIDERS,
  selectedTranscriptionProvider,
} from "./voice-settings.logic";

/**
 * Otto: Transcription is its own page after Voice, built like Voice and Models: a card with the
 * default provider, then the Providers card listing the transcription-capable providers. Their
 * keys are the same secrets Voice uses.
 */
export function TranscriptionSettingsSection() {
  const { t } = useI18n();
  const voice = usePrimarySettings((settings) => settings.voice);
  const updateSettings = useUpdatePrimarySettings();
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const { connected, serverRejected, loadError, refresh } = useVoiceProviders(environmentId);

  return (
    <>
      <SettingsSection id="transcription" title={t("Transcription")}>
        <TranscriptionProviderRow
          voice={voice}
          connected={connected}
          onChange={(transcriptionProvider) => updateSettings({ voice: { transcriptionProvider } })}
        />
      </SettingsSection>
      {environmentId ? (
        <VoiceApiConnectionsSection
          key={environmentId}
          providers={VOICE_TRANSCRIPTION_PROVIDERS}
          searchId="transcription-providers"
          emptyMessage={t("Add a provider to dictate and to let bots transcribe audio and video.")}
          environmentId={environmentId}
          connected={connected}
          serverRejected={serverRejected}
          loadError={loadError}
          onChanged={refresh}
          onKeySaved={() => {}}
        />
      ) : null}
    </>
  );
}

/** The default provider, chosen among the added transcription providers only. */
export function TranscriptionProviderRow({
  voice,
  connected,
  onChange,
}: {
  readonly voice: VoiceSettings;
  readonly connected: ReadonlyArray<VoiceApiProvider> | null;
  readonly onChange: (provider: (typeof VOICE_TRANSCRIPTION_PROVIDERS)[number]) => void;
}) {
  const { t } = useI18n();
  const options = VOICE_TRANSCRIPTION_PROVIDERS.filter((provider) => connected?.includes(provider));
  const selected = options.find((provider) => provider === selectedTranscriptionProvider(voice));

  return (
    <SettingsRow
      {...searchableSetting("transcription-default-provider", t)}
      title={t("Default provider")}
      description={t(
        "Used for dictation, Transcribe, reply, speak calls and bots transcribing files.",
      )}
      control={
        <Select
          value={selected ?? ""}
          onValueChange={(value) => {
            const next = options.find((provider) => provider === value);

            if (next) onChange(next);
          }}
          disabled={options.length === 0}
        >
          <SelectTrigger
            className="w-full sm:w-44"
            aria-label={t("Default transcription provider")}
          >
            <SelectValue>
              {selected ? VOICE_API_PROVIDER_LABELS[selected] : t("Choose a provider")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {VOICE_API_PROVIDER_LABELS[provider]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
