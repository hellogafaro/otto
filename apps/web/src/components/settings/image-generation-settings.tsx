import { RiGrokAiFill, RiOpenaiFill, type RemixiconComponentType } from "@remixicon/react";
import type {
  EnvironmentId,
  ImageGenerationSettings,
  ImageProviderId,
  ImageProviderStatus,
} from "@otto/contracts";
import { IMAGE_PROVIDER_IDS } from "@otto/contracts";
import {
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDER_SUBSCRIPTIONS,
  effectiveDefaultProvider,
  imageProviderHealthDisplay,
  imageProviderTogglePatch,
  isImageProviderEnabled,
} from "@otto/client-runtime/image-generation";
import { useMemo } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/use-settings";
import { useI18n } from "../../i18n";
import { openSettings, useSettingsEnvironmentId } from "../../settings-dialog-store";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { LogoTile } from "../customize/customize-group";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsMessageRow } from "./settings-detail-layout";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import { subscriptionProviderTargetId } from "./subscription-providers";

const IMAGE_PROVIDER_ICONS: Readonly<Record<ImageProviderId, RemixiconComponentType>> = {
  chatgpt: RiOpenaiFill,
  grok: RiGrokAiFill,
};

export function ImageGenerationSettingsSection() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  if (environmentId === null) {
    return (
      <SettingsSection id="image-generation" title={t("Image generation")}>
        <SettingsMessageRow>
          {t("Connect to an environment to set up image generation.")}
        </SettingsMessageRow>
      </SettingsSection>
    );
  }

  return <ImageGenerationSettingsContent key={environmentId} environmentId={environmentId} />;
}

/**
 * Otto: Images reuses the ChatGPT and Grok connections from Models: one row per provider with a
 * switch, which Connect replaces while the connection is missing, and a default only when both
 * are on. The other provider is always the fallback.
 */
export function ImageGenerationSettingsContent({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { t } = useI18n();
  const settings = useEnvironmentSettings(environmentId, (value) => value.imageGeneration);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);

  const providersQuery = useEnvironmentQuery(
    serverEnvironment.imageProviders({ environmentId, input: {} }),
  );

  const statusByProvider = useMemo(
    () => new Map(providersQuery.data?.providers.map((status) => [status.provider, status]) ?? []),
    [providersQuery.data],
  );

  const enabledCount = IMAGE_PROVIDER_IDS.filter((id) =>
    isImageProviderEnabled(settings, id),
  ).length;

  return (
    <SettingsSection id="image-generation" title={t("Image generation")}>
      <SettingsMessageRow>
        {t("Bots can't create images in chats yet. Choose which subscriptions they will use.")}
      </SettingsMessageRow>
      {providersQuery.error ? (
        <SettingsMessageRow
          tone="error"
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={providersQuery.isPending}
              onClick={providersQuery.refresh}
            >
              {t("Try again")}
            </Button>
          }
        >
          {t("Image providers couldn't be loaded")}
        </SettingsMessageRow>
      ) : null}
      {IMAGE_PROVIDER_IDS.map((provider) => (
        <ImageProviderRow
          key={provider}
          provider={provider}
          status={statusByProvider.get(provider)}
          enabled={isImageProviderEnabled(settings, provider)}
          loadFailed={providersQuery.error !== null}
          onToggle={(enabled) =>
            updateSettings({
              imageGeneration: imageProviderTogglePatch(settings, provider, enabled),
            })
          }
          onConnect={() =>
            openSettings(
              "models",
              subscriptionProviderTargetId(IMAGE_PROVIDER_SUBSCRIPTIONS[provider]),
              environmentId,
            )
          }
        />
      ))}
      {enabledCount > 1 ? (
        <ImageDefaultProviderRow
          settings={settings}
          onChange={(patch) => updateSettings({ imageGeneration: patch })}
        />
      ) : null}
    </SettingsSection>
  );
}

export function ImageProviderRow({
  provider,
  status,
  enabled,
  loadFailed,
  onToggle,
  onConnect,
}: {
  readonly provider: ImageProviderId;
  readonly status: ImageProviderStatus | undefined;
  readonly enabled: boolean;
  readonly loadFailed: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onConnect: () => void;
}) {
  const { t } = useI18n();
  const label = IMAGE_PROVIDER_LABELS[provider];
  const ProviderIcon = IMAGE_PROVIDER_ICONS[provider];
  const connected = status?.connected === true;
  const signedOut = status?.health === "revoked" || status?.health === "expired";
  const health = imageProviderHealthDisplay(status, enabled, loadFailed);
  const problem = connected && (health.variant === "error" || status.health === "unsupported");

  const detail =
    status === undefined
      ? loadFailed
        ? t("Status unavailable")
        : t("Checking…")
      : connected
        ? t("Uses your {provider} connection", { provider: label })
        : t("Connect {provider} in Models first", { provider: label });

  return (
    <div
      id={searchableSetting(`image-provider-${provider}`).id}
      data-settings-row=""
      className="flex items-center gap-3 px-4 py-3"
    >
      <LogoTile>
        <ProviderIcon aria-hidden className="size-4" />
      </LogoTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13px font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {problem ? <Badge variant={health.variant}>{health.label}</Badge> : null}
      {connected && !signedOut ? (
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(Boolean(checked))}
          aria-label={t("Use {provider} for images", { provider: label })}
        />
      ) : (
        <Button size="sm" variant="outline" disabled={status === undefined} onClick={onConnect}>
          {signedOut ? t("Sign in again") : t("Connect")}
        </Button>
      )}
    </div>
  );
}

export function ImageDefaultProviderRow({
  settings,
  onChange,
}: {
  readonly settings: ImageGenerationSettings;
  readonly onChange: (patch: {
    readonly defaultProvider: ImageProviderId;
    readonly fallbackOrder: ImageProviderId[];
  }) => void;
}) {
  const { t } = useI18n();
  const defaultProvider = effectiveDefaultProvider(settings);

  return (
    <SettingsRow
      {...searchableSetting("image-default-provider", t)}
      title={t("Default provider")}
      description={t("Bots try this one first and use the other when it fails.")}
      control={
        <Select
          value={defaultProvider}
          onValueChange={(value) => {
            const next = IMAGE_PROVIDER_IDS.find((id) => id === value);

            if (!next) return;

            onChange({
              defaultProvider: next,
              fallbackOrder: [next, ...IMAGE_PROVIDER_IDS.filter((id) => id !== next)],
            });
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={t("Default image provider")}>
            <SelectValue>
              {defaultProvider ? IMAGE_PROVIDER_LABELS[defaultProvider] : null}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {IMAGE_PROVIDER_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {IMAGE_PROVIDER_LABELS[id]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
