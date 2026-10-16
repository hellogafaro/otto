import type { EnvironmentId } from "@otto/contracts";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { useSettingsEnvironmentId } from "../../settings-dialog-store";
import { CustomizeIntegrations, useComposio } from "../customize/customize-integrations";
import { CustomizeSkills } from "../customize/customize-skills";
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
import { toast } from "sonner";
import { Spinner } from "../ui/spinner";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings-layout";

const COMPOSIO_API_KEYS_URL = "https://app.composio.dev/settings/api-keys";

/** Saves a Composio key: the first one, or a replacement for the project's key. */
function ComposioKeyDialog({
  environmentId,
  replacing,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly replacing: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = apiKey.trim();

    if (!trimmed) return;
    setSaving(true);
    const result = await composio.configure({ environmentId, input: { apiKey: trimmed } });
    setSaving(false);

    if (composio.failed(t("Composio key couldn't be saved"), result)) return;
    composio.status.refresh();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{replacing ? t("Replace Composio key") : t("Set up Composio")}</DialogTitle>
          <DialogDescription>
            {replacing
              ? t("Accounts stay connected when the key is from the same Composio project.")
              : t("Composio runs each app's sign-in. The key stays on this Otto server.")}{" "}
            <button
              type="button"
              className="text-foreground underline-offset-4 hover:underline"
              onClick={() =>
                void ensureLocalApi()
                  .shell.openExternal(COMPOSIO_API_KEYS_URL)
                  .catch(() => toast.error(t("Composio couldn't be opened")))
              }
            >
              {t("Get a key")}
            </button>
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
              aria-label={t("Composio API key")}
              autoComplete="off"
              placeholder={t("Composio API key")}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button disabled={!apiKey.trim() || saving} type="submit">
              {saving ? <Spinner /> : null}
              {replacing ? t("Replace key") : t("Save key")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function ComposioRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const configured = composio.status.data?.configured === true;
  const [editing, setEditing] = useState(false);

  const remove = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t(
        "Remove the Composio API key from this environment? Bots lose access to Composio apps until you add a key again.",
      ),
      { variant: "destructive" },
    );

    if (!confirmed) return;
    const result = await composio.remove({ environmentId, input: {} });

    if (!composio.failed(t("Composio key couldn't be removed"), result)) {
      composio.status.refresh();
    }
  };

  return (
    <SettingsRow
      title={t("Composio")}
      description={t("Connect apps like Slack and Gmail.")}
      control={
        <>
          {configured ? (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              {t("Remove")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {configured ? t("Replace key") : t("Set up")}
          </Button>
          {editing ? (
            <ComposioKeyDialog
              environmentId={environmentId}
              replacing={configured}
              onClose={() => setEditing(false)}
            />
          ) : null}
        </>
      }
    />
  );
}

/**
 * Otto: Settings → Integrations holds the workspace's integration accounts, for now the
 * Composio key that lets members connect apps from Customize.
 */
/**
 * Otto: Integrations, under Settings' Customize: the Composio account, then the apps and
 * remote MCP servers bots can use, as Customize showed them.
 */
export function IntegrationsSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId ? (
        <>
          <SettingsSection title={t("Integrations")}>
            <ComposioRow environmentId={environmentId} />
          </SettingsSection>
          <CustomizeIntegrations environmentId={environmentId} />
        </>
      ) : (
        <SkeletonSettingsSections label={t("Loading settings")} />
      )}
    </SettingsPageContainer>
  );
}

/** Otto: Skills, under Settings' Customize, as Customize showed them. */
export function SkillsSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId ? (
        <CustomizeSkills environmentId={environmentId} />
      ) : (
        <SkeletonSettingsSections label={t("Loading settings")} />
      )}
    </SettingsPageContainer>
  );
}
