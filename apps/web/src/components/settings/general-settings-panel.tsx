import { recordLookup } from "../record-lookup";
import { Predicate } from "effect";
import { useCallback, useState } from "react";
import type { MessageKey } from "@otto/client-runtime/i18n";
import type { DesktopUpdateChannel } from "@otto/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type QuitConfirmationMode } from "@otto/contracts/settings";

import { APP_VERSION } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktop-update.logic";
import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/use-settings";
import { ensureLocalApi } from "../../local-api";
import { useDesktopUpdateState } from "../../state/desktop-update";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { LanguageSetting } from "./language-setting";
import { searchableSetting } from "./settings-search";

// General is the default Settings page, so it ships in the main bundle instead
// of the lazy SettingsPanels chunk. Its values come from synchronous settings
// state, so the page renders complete on first paint. Keep imports light.

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const satisfies Record<string, MessageKey>;

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, MessageKey> = {
  hold: "Hold",
  "double-click": "Double press",
  direct: "Direct",
};

const UPDATE_CHANNEL_LABELS: Record<DesktopUpdateChannel, MessageKey> = {
  latest: "Stable",
  beta: "Beta",
};

function AboutVersionTitle() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{t("Version")}</span>
      <code className="text-11px font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const { t } = useI18n();
  const updateState = useDesktopUpdateState();
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);

  const handleButtonClick = useCallback(async () => {
    const bridge = window.desktopBridge;

    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch(() => {
        toast.error(t("Update couldn't be downloaded"));
      });

      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;

      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
        );
      } catch {
        setIsUpdateActionPending(false);
        toast.error(t("Update couldn't be confirmed"));

        return;
      }

      if (!confirmed) {
        setIsUpdateActionPending(false);

        return;
      }

      void bridge
        .installUpdate()
        .catch(() => {
          toast.error(t("Update couldn't be installed"));
        })
        .finally(() => setIsUpdateActionPending(false));

      return;
    }

    if (!Predicate.isFunction(bridge.checkForUpdate)) return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toast.error(t("Updates couldn't be checked"));
        }
      })
      .catch(() => {
        toast.error(t("Updates couldn't be checked"));
      });
  }, [isUpdateActionPending, t, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;

  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel = { download: "Download", install: "Install" } satisfies Record<
    string,
    MessageKey
  >;

  const statusLabel = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  } satisfies Record<string, MessageKey>;

  const buttonLabel = t(
    recordLookup(actionLabel, action) ??
      recordLookup(statusLabel, updateState?.status ?? "") ??
      "Check for Updates",
  );

  const description =
    action === "download" || action === "install"
      ? t("Update available.")
      : t("Current version of the application.");

  return (
    <SettingsRow
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                disabled={buttonDisabled || isUpdateActionPending}
                onClick={handleButtonClick}
              >
                {buttonLabel}
              </Button>
            }
          />
          {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
        </Tooltip>
      }
    />
  );
}

function UpdateChannelSetting() {
  const { t } = useI18n();
  const updateState = useDesktopUpdateState();
  const [isChangingChannel, setIsChangingChannel] = useState(false);
  const channel = updateState?.channel ?? "latest";

  const handleChannelChange = (nextChannel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;

    if (!bridge || nextChannel === channel) return;

    setIsChangingChannel(true);
    void bridge
      .setUpdateChannel(nextChannel)
      .catch(() => {
        toast.error(t("Update channel couldn't be changed"));
      })
      .finally(() => setIsChangingChannel(false));
  };

  return (
    <SettingsRow
      {...searchableSetting("update-channel", t)}
      description={t("Beta installs a new build after every change, before it reaches Stable.")}
      control={
        <Select
          value={channel}
          onValueChange={(value) => {
            if (value === "latest" || value === "beta") handleChannelChange(value);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label={t("Update channel")}
            disabled={isChangingChannel}
          >
            <SelectValue>{t(UPDATE_CHANNEL_LABELS[channel])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="latest">
              {t(UPDATE_CHANNEL_LABELS.latest)}
            </SelectItem>
            <SelectItem hideIndicator value="beta">
              {t(UPDATE_CHANNEL_LABELS.beta)}
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function GeneralSettingsPanel() {
  const { t } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  // SAFETY: every entry comes from the exhaustive QuitConfirmationMode label table.
  return (
    <SettingsPageContainer>
      <SettingsSection title={t("Preferences")}>
        <LanguageSetting />
        <SettingsRow
          {...searchableSetting("time-format", t)}
          description={t("System default follows your browser or OS clock preference.")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label={t("time format")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t("Timestamp format")}>
                <SelectValue>{t(TIMESTAMP_FORMAT_LABELS[settings.timestampFormat])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {t(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {t(TIMESTAMP_FORMAT_LABELS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {t(TIMESTAMP_FORMAT_LABELS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        {isElectron ? (
          <SettingsRow
            {...searchableSetting("quit-confirmation", t)}
            description={t("Hold mode also quits on two quick presses.")}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  label={t("quit shortcut behavior")}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={t("Quit shortcut behavior")}
                >
                  <SelectValue>
                    {t(QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {(
                    Object.entries(QUIT_CONFIRMATION_MODE_LABELS) as Array<
                      [QuitConfirmationMode, MessageKey]
                    >
                  ).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("About")}>
        {isElectron ? (
          <>
            <AboutVersionSection />
            <UpdateChannelSetting />
          </>
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description={t("Current version of the application.")}
          />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
