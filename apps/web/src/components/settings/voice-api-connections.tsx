import { Predicate } from "effect";
import { VOICE_API_PROVIDERS, type EnvironmentId, type VoiceApiProvider } from "@otto/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@otto/client-runtime/state/runtime";
import { useState } from "react";
import { toast } from "sonner";

import { requestConfirmDialog } from "../../confirm-dialog";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { SettingsMessageRow } from "./settings-detail-layout";
import { searchableSetting } from "./settings-search";
import { useI18n } from "../../i18n";
import {
  VOICE_API_NAMES,
  VOICE_API_PROVIDER_LABELS,
  nextVoiceKeyRejected,
  voiceKeyWasRejected,
  voiceCapabilityLabel,
} from "./voice-settings.logic";

export function commandError(result: AtomCommandResult<unknown, unknown>): string {
  if (!Predicate.isTagged(result, "Failure")) return "The request failed.";
  const error = squashAtomCommandFailure(result);

  return error instanceof Error ? error.message : "The request failed.";
}

/**
 * Otto: Voice API keys follow the Composio row: Connect opens a key dialog, a connected
 * provider offers Remove and Replace key, and every result is a toast. A saved key is tested
 * straight away, so a rejected key shows as soon as it is saved.
 */
export function VoiceApiConnectionsSection({
  environmentId,
  connected,
  serverRejected,
  loadError,
  onChanged,
  onKeySaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: ReadonlyArray<VoiceApiProvider> | null;
  readonly serverRejected: Partial<Record<VoiceApiProvider, boolean>>;
  readonly loadError: string | null;
  readonly onChanged: () => void;
  readonly onKeySaved: () => void;
}) {
  const { t } = useI18n();
  const connect = useAtomCommand(serverEnvironment.connectVoiceProvider, { reportFailure: false });

  const disconnect = useAtomCommand(serverEnvironment.disconnectVoiceProvider, {
    reportFailure: false,
  });

  const test = useAtomCommand(serverEnvironment.testVoiceProvider, { reportFailure: false });

  // This client's latest verdicts, shown until the next provider status arrives.
  // Servers that do not report a verdict keep using them.
  const [local, setLocal] = useState<{
    readonly basis: Partial<Record<VoiceApiProvider, boolean>>;
    readonly rejected: Partial<Record<VoiceApiProvider, boolean>>;
  }>({ basis: serverRejected, rejected: {} });

  const rejectedFor = (provider: VoiceApiProvider) =>
    (local.basis === serverRejected ? local.rejected[provider] : undefined) ??
    serverRejected[provider] ??
    local.rejected[provider] ??
    false;

  const recordVerdict = (provider: VoiceApiProvider, rejected: boolean) =>
    setLocal((current) => ({
      basis: serverRejected,
      rejected: { ...current.rejected, [provider]: rejected },
    }));

  const saveKey = async (provider: VoiceApiProvider, apiKey: string): Promise<boolean> => {
    const name = VOICE_API_PROVIDER_LABELS[provider];
    const saved = await connect({ environmentId, input: { provider, apiKey } });

    if (!Predicate.isTagged(saved, "Success")) {
      const failure = squashAtomCommandFailure(saved);
      recordVerdict(provider, nextVoiceKeyRejected(rejectedFor(provider), failure));
      toast.error(
        voiceKeyWasRejected(failure)
          ? t("{name} rejected the key", { name })
          : t("{name} key couldn't be saved", { name }),
      );
      onChanged();

      return false;
    }

    onKeySaved();
    const tested = await test({ environmentId, input: { provider } });
    const failure = Predicate.isTagged(tested, "Failure") ? squashAtomCommandFailure(tested) : null;
    recordVerdict(provider, nextVoiceKeyRejected(rejectedFor(provider), failure));
    onChanged();

    if (failure !== null && voiceKeyWasRejected(failure)) {
      toast.error(t("{name} rejected the key", { name }));

      return true;
    }

    toast.success(t("{name} has been connected", { name }));

    return true;
  };

  const removeKey = async (provider: VoiceApiProvider) => {
    const name = VOICE_API_PROVIDER_LABELS[provider];

    const confirmed =
      (await requestConfirmDialog(
        t(
          "Remove the {name} key? Voice features that use {name} stop working until you connect it again.",
          { name },
        ),
        { variant: "destructive" },
      )) ?? false;

    if (!confirmed) return;
    const result = await disconnect({ environmentId, input: { provider } });
    onChanged();

    if (Predicate.isTagged(result, "Success"))
      toast.success(t("{name} has been disconnected", { name }));
    else toast.error(t("{name} couldn't be disconnected", { name }));
  };

  return (
    <SettingsSection id={searchableSetting("voice-api-connections").id} title={t("API keys")}>
      {loadError ? (
        <SettingsMessageRow>{t("Voice connections couldn't be loaded")}</SettingsMessageRow>
      ) : null}
      {VOICE_API_PROVIDERS.map((provider) => (
        <VoiceApiProviderRow
          key={provider}
          provider={provider}
          connected={connected === null ? undefined : connected.includes(provider)}
          keyRejected={rejectedFor(provider)}
          onSave={(apiKey) => saveKey(provider, apiKey)}
          onRemove={() => void removeKey(provider)}
        />
      ))}
    </SettingsSection>
  );
}

export function VoiceApiProviderRow({
  provider,
  connected,
  keyRejected = false,
  onSave,
  onRemove,
}: {
  readonly provider: VoiceApiProvider;
  /** Undefined until the provider status loads, which hides the actions. */
  readonly connected: boolean | undefined;
  /** The last test found the saved key invalid. */
  readonly keyRejected?: boolean;
  readonly onSave: (apiKey: string) => Promise<boolean>;
  readonly onRemove: () => void;
}) {
  const { t } = useI18n();
  const name = VOICE_API_PROVIDER_LABELS[provider];
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <SettingsRow
        title={
          <span className="flex items-center gap-2">
            {name}
            {connected ? (
              <Badge variant={keyRejected ? "error" : "success"} presentation="connection-kind">
                {keyRejected ? t("Key rejected") : t("Connected")}
              </Badge>
            ) : null}
          </span>
        }
        description={voiceCapabilityLabel(provider)}
        control={
          connected === undefined ? null : connected ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={onRemove}>
                {t("Remove")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                {t("Replace key")}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              {t("Connect")}
            </Button>
          )
        }
      />
      {dialogOpen ? (
        <VoiceKeyDialog
          provider={provider}
          replacing={connected === true}
          onSave={onSave}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

function VoiceKeyDialog({
  provider,
  replacing,
  onSave,
  onClose,
}: {
  readonly provider: VoiceApiProvider;
  readonly replacing: boolean;
  readonly onSave: (apiKey: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const name = VOICE_API_PROVIDER_LABELS[provider];
  const keyLabel = t("{api} key", { api: VOICE_API_NAMES[provider] });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = apiKey.trim();

    if (!trimmed) return;
    setSaving(true);
    const saved = await onSave(trimmed);
    setSaving(false);

    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {replacing ? t("Replace {name} key", { name }) : t("Connect {name}", { name })}
          </DialogTitle>
          <DialogDescription>
            {t("The key stays on this environment. {name} bills its API usage.", { name })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel>
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={keyLabel}
              placeholder={keyLabel}
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!apiKey.trim() || saving}>
              {saving ? <Spinner /> : null}
              {replacing ? t("Replace key") : t("Save key")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
