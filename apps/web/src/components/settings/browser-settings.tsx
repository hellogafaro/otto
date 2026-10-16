import { RiGlobalLine } from "@remixicon/react";
import { useState } from "react";
import { toast } from "sonner";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "~/i18n";
import { LogoTile } from "../customize/customize-group";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ApiKeyDialog } from "./api-key-dialog";
import { SettingsRow, SettingsSection } from "./settings-layout";

/**
 * Otto: Browser holds Bot browser access and Browserbase as a provider row, like Images: Connect
 * opens the key dialog, and once a key is saved a switch takes its place beside Remove.
 */
export function BrowserSettingsSection() {
  const { t } = useI18n();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const browser = settings.browserProvider;
  const connected = browser.browserbaseApiKeyRedacted === true;
  const botAccess = settings.enableAgentBrowserAccess ?? true;

  return (
    <SettingsSection id="browser" title={t("Browser")}>
      <SettingsRow
        title={t("Bot browser access")}
        description={t("Bots can use the in-app browser for research and previews.")}
        control={
          <Switch
            aria-label={t("Bot browser access")}
            checked={botAccess}
            onCheckedChange={(checked) =>
              updateSettings({ enableAgentBrowserAccess: Boolean(checked) })
            }
          />
        }
      />
      <div data-settings-row="" className="flex items-center gap-3 px-4 py-3">
        <LogoTile>
          <RiGlobalLine aria-hidden className="size-4" />
        </LogoTile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13px font-medium text-foreground">Browserbase</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t("Hosted browser sessions for bots")}
          </span>
        </span>
        {connected ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                updateSettings({
                  browserProvider: {
                    enabled: false,
                    browserbaseApiKey: "",
                    browserbaseApiKeyRedacted: false,
                  },
                });
                toast.success(t("{name} has been disconnected", { name: "Browserbase" }));
              }}
            >
              {t("Remove")}
            </Button>
            <Switch
              aria-label={t("Use Browserbase")}
              checked={browser.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ browserProvider: { enabled: Boolean(checked) } })
              }
            />
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            {t("Connect")}
          </Button>
        )}
      </div>
      {dialogOpen ? (
        <ApiKeyDialog
          name="Browserbase"
          keyLabel={t("Browserbase API key")}
          replacing={false}
          onSave={async (apiKey) => {
            updateSettings({
              browserProvider: {
                enabled: true,
                browserbaseApiKey: apiKey,
                browserbaseApiKeyRedacted: false,
              },
            });
            toast.success(t("{name} has been connected", { name: "Browserbase" }));

            return true;
          }}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </SettingsSection>
  );
}
