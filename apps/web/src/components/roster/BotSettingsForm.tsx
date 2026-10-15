import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import {
  BotId,
  IMAGE_PROVIDER_IDS,
  type EnvironmentId,
  type ImageProviderId,
} from "@otto/contracts";
import {
  botImageProviderOptionLabel,
  globalDefaultOptionLabel,
} from "@otto/client-runtime/image-generation";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import { driverSupportsDelegation } from "@otto/shared/delegationProviders";

import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentMcpServersAtom } from "../../state/mcpServers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { AvatarPickerDialog } from "./AvatarPickerDialog";
import { BotAvatarView } from "./BotAvatarView";
import { BotChannelsSheet } from "./BotChannelsSheet";
import { BotEngineFields } from "./BotEngineFields";
import { BotIdentityFields } from "./BotIdentityFields";
import { BotMemorySheet } from "./BotMemorySheet";
import { BotPersonalityToneField } from "./BotPersonalityToneField";
import { BotToolSwitches } from "./BotToolSwitches";
import { BOT_SANDBOX_OPTIONS, botSandboxLabel } from "./botSandbox";
import type { Bot } from "./types";
import { useBotThreadRef } from "./useBotThreadRef";
import {
  BOT_IMAGE_PROVIDER_DEFAULT,
  botImageProviderFromSelectValue,
  useBotProfileDraft,
  type BotProfileUpdate,
} from "./useBotProfileDraft";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** Edits one bot's profile, saving it as you go. */
export function BotSettingsForm({
  bot,
  onSave,
  onDeleted,
}: {
  readonly bot: Bot;
  readonly onSave: (input: BotProfileUpdate) => Promise<boolean>;
  readonly onDeleted: () => void;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const mcpServers = useAtomValue(environmentMcpServersAtom(environmentId ?? NO_ENVIRONMENT));
  const deleteBot = useAtomCommand(botEnvironment.delete, { reportFailure: false });

  const imageSettings = useEnvironmentSettings(
    environmentId ?? NO_ENVIRONMENT,
    (settings) => settings.imageGeneration,
  );

  const imageProviders = useEnvironmentQuery(
    environmentId ? serverEnvironment.imageProviders({ environmentId, input: {} }) : null,
  );

  const imageProviderLabel = (provider: ImageProviderId) =>
    botImageProviderOptionLabel(
      provider,
      imageSettings,
      imageProviders.data?.providers.find((status) => status.provider === provider),
    );

  const threadRef = useBotThreadRef(bot.id);

  const accessQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.subscriptionAuth({ environmentId, input: {} }),
  );

  const draft = useBotProfileDraft(bot, onSave);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const assignedChannels = (bot.channelBindings ?? []).filter(
    (binding) => binding.connectionId || binding.projectId || binding.status !== "disconnected",
  );

  const connectedChannelCount = assignedChannels.filter(
    (binding) => binding.status === "connected",
  ).length;

  const onDeleteBot = useCallback(() => {
    if (!environmentId) return;

    const confirmation = requestConfirmDialog(
      t("Delete {name}? Its chats stay in your history. This cannot be undone.", {
        name: bot.name,
      }),
      { variant: "destructive" },
    );

    if (!confirmation) return;
    setDeleting(true);
    void confirmation.then(async (confirmed) => {
      if (!confirmed) {
        setDeleting(false);

        return;
      }

      const result = await deleteBot({
        environmentId,
        input: { botId: BotId.make(bot.id) },
      });

      setDeleting(false);

      if (Predicate.isTagged(result, "Failure")) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: t("Could not delete {name}", { name: bot.name }),
          description: error instanceof Error ? error.message : t("The command failed."),
        });

        return;
      }

      onDeleted();
    });
  }, [bot, environmentId, deleteBot, onDeleted, t]);

  return (
    <>
      {/* Otto: Leaving a field saves at once; edits otherwise save 800ms after the last one. */}
      <div className="flex min-h-0 flex-1 flex-col" onBlurCapture={draft.flush}>
        <SettingsPageContainer>
          <div className="flex items-center gap-4">
            <BotAvatarView avatar={bot.avatar} name={draft.name || bot.name} className="size-14" />
            <div className="min-w-0">
              <h1 className="truncate text-22px leading-title font-medium tracking-title-lg">
                {draft.name || bot.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("Set up how this bot works with you.")}
              </p>
            </div>
          </div>

          <BotIdentityFields bot={bot} draft={draft} onChangeAvatar={() => setAvatarOpen(true)} />

          <SettingsSection id="behavior" title={t("Behavior")}>
            <SettingsRow
              id="personality"
              title={t("Personality")}
              description={t(
                "Choose how this bot usually sounds. It is a baseline, not a costume. The bot still adapts to you and to the task, so serious work stays serious in every mode.",
              )}
            >
              <div className="mt-3 pb-3.5">
                <BotPersonalityToneField
                  bot={bot}
                  tone={draft.personalityTone}
                  onToneChange={(tone) => {
                    draft.setPersonalityTone(tone);
                    draft.markChanged();
                  }}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={t("Voice calls")}
              description={t(
                "Let this bot take subscription voice calls. Voice must also be enabled in Settings.",
              )}
              control={
                <Switch
                  checked={draft.voiceEnabled}
                  onCheckedChange={(checked) => {
                    draft.setVoiceEnabled(Boolean(checked));
                    draft.markChanged();
                  }}
                  aria-label={
                    draft.voiceEnabled
                      ? t("Disable voice calls for {name}", { name: bot.name })
                      : t("Enable voice calls for {name}", { name: bot.name })
                  }
                />
              }
            />
          </SettingsSection>

          <BotEngineFields bot={bot} draft={draft} environmentId={environmentId} />

          <SettingsSection id="workspace" title={t("Workspace")}>
            <SettingsRow
              title={t("Sandbox")}
              description={t("Where this bot runs commands and edits files.")}
              control={
                <Select
                  value={draft.sandbox}
                  onValueChange={(value) => {
                    if (value === null) return;

                    if (
                      value !== "default" &&
                      !BOT_SANDBOX_OPTIONS.some((option) => option.value === value)
                    )
                      return;
                    // SAFETY: the value has been checked against default and BOT_SANDBOX_OPTIONS before updating the draft.
                    draft.setSandbox(value as typeof draft.sandbox);
                    draft.markChanged();
                  }}
                >
                  <SelectTrigger className="w-full sm:w-48" aria-label={t("Sandbox provider")}>
                    <SelectValue>{botSandboxLabel(draft.sandbox, t)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="default">{botSandboxLabel("default", t)}</SelectItem>
                    {BOT_SANDBOX_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {botSandboxLabel(option.value, t)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />

            <SettingsRow
              title={t("Image generation")}
              description={t(
                "Which subscription this bot uses to create images. The chat model above stays the same.",
              )}
              control={
                <Select
                  value={draft.imageProvider ?? BOT_IMAGE_PROVIDER_DEFAULT}
                  onValueChange={(value) => {
                    draft.setImageProvider(botImageProviderFromSelectValue(value));
                    draft.markChanged();
                  }}
                >
                  <SelectTrigger className="w-full sm:w-56" aria-label={t("Image provider")}>
                    <SelectValue>
                      {draft.imageProvider
                        ? imageProviderLabel(draft.imageProvider)
                        : globalDefaultOptionLabel(imageSettings)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={BOT_IMAGE_PROVIDER_DEFAULT}>
                      {globalDefaultOptionLabel(imageSettings)}
                    </SelectItem>
                    {IMAGE_PROVIDER_IDS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {imageProviderLabel(provider)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />

            <SettingsRow
              title={t("Memory")}
              description={t("Facts this bot keeps between chats.")}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("Manage bot memory")}
                  disabled={!threadRef}
                  onClick={() => setMemoryOpen(true)}
                >
                  {t("Facts and history")}
                </Button>
              }
            />

            <SettingsRow
              title={t("Channels")}
              description={t("Where this bot answers outside Otto.")}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("Manage bot channels")}
                  aria-expanded={channelsOpen}
                  onClick={() => setChannelsOpen(true)}
                >
                  {assignedChannels.length === 0
                    ? t("No channels")
                    : t("{connected} of {total} connected", {
                        connected: connectedChannelCount,
                        total: assignedChannels.length,
                      })}
                </Button>
              }
            />
          </SettingsSection>

          <BotToolSwitches
            bot={bot}
            environmentId={environmentId}
            servers={mcpServers}
            accessStatuses={accessQuery.data?.access ?? []}
            canDelegate={
              draft.activeEntry ? driverSupportsDelegation(draft.activeEntry.driverKind) : true
            }
          />

          <SettingsSection title={t("Danger")}>
            <SettingsRow
              title={t("Delete bot")}
              description={t("Remove {name} from the roster. Its chats stay in your history.", {
                name: bot.name,
              })}
              control={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting || !environmentId}
                  onClick={onDeleteBot}
                >
                  {deleting ? t("Deleting…") : t("Delete")}
                </Button>
              }
            />
          </SettingsSection>
        </SettingsPageContainer>
      </div>

      <AvatarPickerDialog bot={bot} open={avatarOpen} onOpenChange={setAvatarOpen} />
      <BotMemorySheet open={memoryOpen} onOpenChange={setMemoryOpen} threadRef={threadRef} />
      <BotChannelsSheet bot={bot} open={channelsOpen} onOpenChange={setChannelsOpen} />
    </>
  );
}
