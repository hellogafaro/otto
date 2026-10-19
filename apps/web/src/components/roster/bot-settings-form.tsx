import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import {
  BOT_INSTRUCTIONS_MAX_CHARS,
  BotId,
  IMAGE_PROVIDER_IDS,
  type EnvironmentId,
  type ImageProviderId,
  type Visibility,
} from "@otto/contracts";
import {
  botImageProviderOptionLabel,
  globalDefaultOptionLabel,
} from "@otto/client-runtime/image-generation";
import { driverSupportsDelegation } from "@otto/shared/delegationProviders";

import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../../confirm-dialog";
import { useEnvironmentSettings } from "../../hooks/use-settings";
import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentMcpServersAtom } from "../../state/mcp-servers";
import { environmentSnapshotAtom } from "../../state/shell";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settings-layout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toast } from "sonner";
import { AvatarPickerDialog } from "./avatar-picker-dialog";
import { BotAlwaysAllowed } from "./bot-always-allowed";
import { BotAvatarView } from "./bot-avatar-view";
import { BotEngineFields } from "./bot-engine-fields";
import { BotIdentityFields } from "./bot-identity-fields";
import { BotToolSwitches } from "./bot-tool-switches";
import { BOT_SANDBOX_OPTIONS, botSandboxLabel } from "./bot-sandbox";
import type { Bot } from "./types";
import {
  BOT_IMAGE_PROVIDER_DEFAULT,
  botImageProviderFromSelectValue,
  useBotProfileDraft,
  type BotProfileUpdate,
} from "./use-bot-profile-draft";

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
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const ownerPersonId = bot.owner?.kind === "person" ? bot.owner.personId : null;
  const isOwner = ownerPersonId !== null && ownerPersonId === snapshot?.currentPersonId;
  const [visibility, setVisibility] = useState<Visibility>(bot.visibility ?? "organization");

  const visibilityLabel = (value: Visibility) => (value === "user" ? t("Only me") : t("Team"));

  const onVisibilityChange = useCallback(
    async (next: Visibility) => {
      if (!environmentId || next === visibility) return;
      const previous = visibility;
      setVisibility(next);

      const result = await updateBot({
        environmentId,
        input: { botId: BotId.make(bot.id), visibility: next },
      });

      if (Predicate.isTagged(result, "Failure")) {
        setVisibility(previous);
        toast.error(t("Bot settings couldn't be saved"));
      }
    },
    [bot.id, environmentId, t, updateBot, visibility],
  );

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

  const accessQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.subscriptionAuth({ environmentId, input: {} }),
  );

  const draft = useBotProfileDraft(bot, onSave);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        toast.error(t("{name} couldn't be deleted", { name: bot.name }));

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
          <header>
            <div className="flex items-center gap-4">
              <BotAvatarView
                avatar={bot.avatar}
                name={draft.name || bot.name}
                className="size-14"
              />
              <div className="min-w-0">
                <h1 className="truncate text-22px leading-title font-medium tracking-title-lg">
                  {draft.name || bot.name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("Set up how this bot works with you.")}
                </p>
              </div>
            </div>
          </header>

          <BotIdentityFields bot={bot} draft={draft} onChangeAvatar={() => setAvatarOpen(true)} />

          {ownerPersonId !== null ? (
            <SettingsSection id="access" title={t("Access")}>
              <SettingsRow
                title={t("Visibility")}
                description={
                  isOwner
                    ? t(
                        "Only me hides this bot from everyone except you and the people in its groups.",
                      )
                    : t("Only the bot's owner can change who sees it.")
                }
                control={
                  <Select
                    value={visibility}
                    disabled={!isOwner}
                    onValueChange={(value) => {
                      if (value === "user" || value === "organization") {
                        void onVisibilityChange(value);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-48" aria-label={t("Visibility")}>
                      <SelectValue>{visibilityLabel(visibility)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="user">{visibilityLabel("user")}</SelectItem>
                      <SelectItem value="organization">
                        {visibilityLabel("organization")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />
            </SettingsSection>
          ) : null}

          <SettingsSection id="behavior" title={t("Behavior")}>
            <SettingsRow
              id="instructions"
              title={t("Instructions")}
              description={t(
                "What this bot should do and how it should work. Added to every chat.",
              )}
            >
              <div className="mt-3 pb-3.5">
                <Textarea
                  aria-label={t("Bot instructions")}
                  value={draft.instructions}
                  placeholder={t("Review pull requests and keep replies short")}
                  rows={8}
                  maxLength={BOT_INSTRUCTIONS_MAX_CHARS}
                  className="min-h-40 resize-none"
                  onChange={(event) => {
                    draft.setInstructions(event.currentTarget.value);
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
              title={t("Channels")}
              description={t("Where this bot answers outside Otto.")}
              control={<Badge variant="quiet">{t("Coming soon")}</Badge>}
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

          <BotAlwaysAllowed bot={bot} environmentId={environmentId} />

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
    </>
  );
}
