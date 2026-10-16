import { RiCloudLine, RiVercelFill } from "@remixicon/react";
import { Predicate } from "effect";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { EnvironmentId, SandboxProvider, SandboxSettings } from "@otto/contracts";
import { useState } from "react";
import { toast } from "sonner";

import { useEnvironmentSettings } from "../../hooks/use-settings";
import { useServerConfigs } from "../../state/entities";
import { useSettingsEnvironmentId } from "../../settings-dialog-store";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AddMenu, CardCountRow, LogoTile } from "../customize/customize-group";
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
import { MenuItem } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { CredentialsDialog } from "./api-key-dialog";
import { SettingsMessageRow } from "./settings-detail-layout";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { searchableSetting } from "./settings-search";
import {
  applyRailwayConnectionChange,
  type RailwayConnectionChange,
  type CloudSandboxProvider,
  disconnectSandboxProvider,
  isSandboxProviderConnected,
  SANDBOX_PROVIDER_DEFINITIONS,
  sandboxProviderDefinition,
  saveSandboxProviderConnection,
  selectableSandboxProviders,
} from "./sandbox-settings-panel.logic";
import { useI18n } from "../../i18n";

// Cloud entries are brand names; `local` is translated at render time.
const SANDBOX_PROVIDER_LABELS: Readonly<Record<SandboxProvider, string>> = {
  local: "Local",
  e2b: "E2B",
  daytona: "Daytona",
  vercel: "Vercel Sandbox",
  railway: "Railway",
  boat: "Boat",
};

function errorMessage(
  result: Parameters<typeof squashAtomCommandFailure>[0],
  fallback: string,
): string {
  const error = squashAtomCommandFailure(result);

  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function SandboxSettingsPanel() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  if (environmentId === null) {
    return (
      <SettingsSection {...searchableSetting("sandbox", t)}>
        <SettingsRow title={t("Connect to an environment first.")} />
      </SettingsSection>
    );
  }

  return <EnvironmentSandboxSettingsPanel key={environmentId} environmentId={environmentId} />;
}

/**
 * Otto: Sandboxes is built like the Models Connections card: a count row whose plus adds a cloud
 * sandbox with its credentials in a dialog, one row per connected sandbox (Remove, Edit), and a
 * Default sandbox row once there is more than Local to choose from.
 */
function EnvironmentSandboxSettingsPanel({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { t, plural } = useI18n();
  const sandbox = useEnvironmentSettings(environmentId, (settings) => settings.sandbox);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [editingProvider, setEditingProvider] = useState<CloudSandboxProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [railwayChange, setRailwayChange] = useState<RailwayConnectionChange | null>(null);
  // Otto: BOAT_API_KEY in the server's environment connects Boat; a key saved here still wins.
  const boatFromServer = useServerConfigs().get(environmentId)?.boatConnectedByServer === true;

  const connectedByServer = (provider: CloudSandboxProvider) =>
    provider === "boat" && boatFromServer && !isSandboxProviderConnected(sandbox, "boat");

  const selectable = selectableSandboxProviders(sandbox, boatFromServer);

  const persist = async (next: SandboxSettings) => {
    setSaving(true);
    const result = await updateSettings({ environmentId, input: { patch: { sandbox: next } } });
    setSaving(false);

    if (Predicate.isTagged(result, "Failure")) {
      toast.error(errorMessage(result, t("The server rejected these sandbox settings.")));

      return false;
    }

    return true;
  };

  const saveConnection = async (
    provider: CloudSandboxProvider,
    draft: Readonly<Record<string, string>>,
  ) => {
    if (provider === "railway" && isSandboxProviderConnected(sandbox, "railway")) {
      setRailwayChange({ kind: "save", draft });

      return true;
    }

    if (!(await persist(saveSandboxProviderConnection({ settings: sandbox, provider, draft }))))
      return false;

    toast.success(t("{name} has been connected", { name: SANDBOX_PROVIDER_LABELS[provider] }));

    return true;
  };

  const remove = async (provider: CloudSandboxProvider) => {
    if (provider === "railway") {
      setRailwayChange({ kind: "disconnect" });

      return;
    }

    if (await persist(disconnectSandboxProvider(sandbox, provider)))
      toast.success(t("{name} has been disconnected", { name: SANDBOX_PROVIDER_LABELS[provider] }));
    else
      toast.error(
        t("{name} couldn't be disconnected", { name: SANDBOX_PROVIDER_LABELS[provider] }),
      );
  };

  const connectedDefinitions = SANDBOX_PROVIDER_DEFINITIONS.filter(
    (definition) =>
      isSandboxProviderConnected(sandbox, definition.id) || connectedByServer(definition.id),
  );

  const availableDefinitions = SANDBOX_PROVIDER_DEFINITIONS.filter(
    (definition) => !connectedDefinitions.includes(definition),
  );

  const editingDefinition = editingProvider ? sandboxProviderDefinition(editingProvider) : null;

  const editingConnected =
    editingDefinition !== null && isSandboxProviderConnected(sandbox, editingDefinition.id);

  const providerLabel = (provider: SandboxProvider) =>
    provider === "local" ? t("Local") : SANDBOX_PROVIDER_LABELS[provider];

  return (
    <>
      <SettingsSection {...searchableSetting("sandbox", t)}>
        <CardCountRow
          label={plural(connectedDefinitions.length, {
            one: "{count} sandbox",
            other: "{count} sandboxes",
          })}
          action={
            availableDefinitions.length === 0 ? null : (
              <AddMenu label={t("Add sandbox")}>
                {availableDefinitions.map((definition) => {
                  const Icon = definition.id === "vercel" ? RiVercelFill : RiCloudLine;

                  return (
                    <MenuItem
                      key={definition.id}
                      disabled={saving}
                      onClick={() => setEditingProvider(definition.id)}
                    >
                      <Icon aria-hidden />
                      {definition.label}
                    </MenuItem>
                  );
                })}
              </AddMenu>
            )
          }
        />
        {connectedDefinitions.map((definition) => {
          const Icon = definition.id === "vercel" ? RiVercelFill : RiCloudLine;

          return (
            <div
              key={definition.id}
              data-settings-row=""
              className="flex items-center gap-3 px-4 py-3"
            >
              <LogoTile>
                <Icon aria-hidden className="size-4" />
              </LogoTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-13px font-medium text-foreground">
                  {definition.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {connectedByServer(definition.id)
                    ? t("Connected by the server")
                    : t(definition.description)}
                </span>
              </span>
              {connectedByServer(definition.id) ? null : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void remove(definition.id)}
                  >
                    {t("Remove")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    aria-label={t("Edit {name}", { name: definition.label })}
                    onClick={() => setEditingProvider(definition.id)}
                  >
                    {t("Edit")}
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {connectedDefinitions.length === 0 ? (
          <SettingsMessageRow>
            {t("Bots run on this computer until you add a sandbox.")}
          </SettingsMessageRow>
        ) : (
          <SettingsRow
            {...searchableSetting("default-sandbox", t)}
            description={t("Bots without an override use this sandbox.")}
            control={
              <Select
                value={sandbox.defaultProvider}
                onValueChange={(value) => {
                  if (value === null) return;
                  // SAFETY: the value is checked against selectableSandboxProviders before persistence.
                  const provider = value as SandboxProvider;

                  if (!selectable.includes(provider)) return;

                  void persist({ ...sandbox, defaultProvider: provider }).then((saved) => {
                    if (!saved) toast.error(t("Default sandbox couldn't be saved"));
                  });
                }}
              >
                <SelectTrigger className="w-44" aria-label={t("Default sandbox")}>
                  <SelectValue>{providerLabel(sandbox.defaultProvider)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {selectable.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {providerLabel(provider)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        )}
      </SettingsSection>

      {editingDefinition ? (
        <CredentialsDialog
          title={
            editingConnected
              ? t("Edit {name}", { name: editingDefinition.label })
              : t("Connect {name}", { name: editingDefinition.label })
          }
          description={t("The server stores these credentials in its secret store.")}
          fields={editingDefinition.fields.map((field) => {
            const saved = sandbox.providers[editingDefinition.id].environment.find(
              (variable) => variable.name === field.name,
            );

            return {
              name: field.name,
              label: t(field.label),
              secret: field.secret,
              saved: field.secret && saved?.valueRedacted === true,
              value: field.secret ? "" : (saved?.value ?? ""),
            };
          })}
          submitLabel={editingConnected ? t("Save changes") : t("Connect")}
          onSave={(draft) => saveConnection(editingDefinition.id, draft)}
          onClose={() => setEditingProvider(null)}
        />
      ) : null}
      <Dialog
        open={railwayChange !== null}
        onOpenChange={(open) => !open && !saving && setRailwayChange(null)}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Retire Railway VMs before changing access")}</DialogTitle>
            <DialogDescription>
              {t(
                "Changing or removing credentials does not stop or delete Railway VMs. They can keep accruing charges. Stop active bot sessions, then open your environment in the Railway dashboard and destroy any VMs you no longer need before removing access. If you are rotating a token, keep access to the same environment to reconnect to existing VMs. Otto preserves saved VM identities and will not silently create replacements.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <a
              href="https://railway.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              {t("Open Railway dashboard")}
            </a>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={() => setRailwayChange(null)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (
                  railwayChange &&
                  (await persist(applyRailwayConnectionChange(sandbox, railwayChange)))
                ) {
                  setRailwayChange(null);
                }
              }}
            >
              {t("I have reviewed my VMs — continue")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
