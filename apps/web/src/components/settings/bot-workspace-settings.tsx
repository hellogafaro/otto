import { useState } from "react";
import type { BotSandboxBrowserSharing } from "@otto/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@otto/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/use-settings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import { useI18n } from "../../i18n";
import type { MessageKey } from "@otto/client-runtime/i18n";

const BOT_SANDBOX_BROWSER_SHARING_LABELS: Record<BotSandboxBrowserSharing, MessageKey> = {
  separate: "One per bot",
  shared: "Shared by all",
};

export function BotSandboxBrowserSharingSettings({
  value,
  onChange,
}: {
  readonly value: BotSandboxBrowserSharing;
  readonly onChange: (value: BotSandboxBrowserSharing) => void;
}) {
  const { t } = useI18n();
  const [pendingValue, setPendingValue] = useState<BotSandboxBrowserSharing | null>(null);

  return (
    <>
      <SettingsRow
        {...searchableSetting("sandbox-browser-sharing", t)}
        description={t(
          "One per bot gives each bot its own files and browser logins. Shared by all lets every bot use the same ones.",
        )}
        resetAction={
          value !== DEFAULT_UNIFIED_SETTINGS.botSandboxBrowserSharing ? (
            <SettingResetButton
              label={t("bot computers")}
              onClick={() => setPendingValue(DEFAULT_UNIFIED_SETTINGS.botSandboxBrowserSharing)}
            />
          ) : null
        }
        control={
          <Select
            value={value}
            onValueChange={(nextValue) => {
              if ((nextValue === "shared" || nextValue === "separate") && nextValue !== value) {
                setPendingValue(nextValue);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label={t("Bot computers")}>
              <SelectValue>{t(BOT_SANDBOX_BROWSER_SHARING_LABELS[value])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="separate">
                {t(BOT_SANDBOX_BROWSER_SHARING_LABELS.separate)}
              </SelectItem>
              <SelectItem hideIndicator value="shared">
                {t(BOT_SANDBOX_BROWSER_SHARING_LABELS.shared)}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />

      <Dialog open={pendingValue !== null} onOpenChange={(open) => !open && setPendingValue(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("Change bot computers?")}</DialogTitle>
            <DialogDescription>
              {pendingValue === "shared"
                ? t(
                    "Bots finish what they are doing first. From their next turn, every bot uses one shared computer. Files and browser logins on their own computers do not move.",
                  )
                : t(
                    "Bots finish what they are doing first. From their next turn, each bot gets its own computer with its own files and browser logins. The shared computer's files stay where they are.",
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingValue(null)}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => {
                const nextValue = pendingValue;
                setPendingValue(null);

                if (nextValue) onChange(nextValue);
              }}
            >
              {t("Change mode")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/**
 * Otto: Environment-wide workspace policy. Bots always run with full access (that is what
 * sandboxes are for), so the only choice left is whether each bot gets its own computer.
 */
export function BotWorkspaceSettingsSection() {
  const { t } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsSection title={t("Workspace")}>
      <BotSandboxBrowserSharingSettings
        value={settings.botSandboxBrowserSharing}
        onChange={(value) => updateSettings({ botSandboxBrowserSharing: value })}
      />
    </SettingsSection>
  );
}
