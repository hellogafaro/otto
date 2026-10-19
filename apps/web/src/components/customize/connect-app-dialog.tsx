import type {
  ComposioAuthField,
  ComposioToolkit,
  ComposioVisibility,
  EnvironmentId,
  LibraryVisibility,
} from "@otto/contracts";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import { Predicate } from "effect";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { LibraryVisibilitySelect } from "../library/library-actions";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { useComposio } from "./customize-integrations";

/**
 * Connects one app. Managed apps ask for a label and who it serves. Apps Composio does not
 * host also ask for an auth config, using the fields Composio lists. Those fields are forwarded
 * and not stored.
 */
export function ConnectAppDialog({
  environmentId,
  toolkit,
  visibility,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly toolkit: ComposioToolkit;
  readonly visibility: ComposioVisibility;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const setup = useEnvironmentQuery(
    serverEnvironment.composioAuthSetup({ environmentId, input: { slug: toolkit.slug } }),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [createdConfig, setCreatedConfig] = useState<{ id: string; scheme: string } | null>(null);
  const [schemeMode, setSchemeMode] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [alias, setAlias] = useState("");
  const [owner, setOwner] = useState<LibraryVisibility>(visibility);
  const [connecting, setConnecting] = useState(false);
  const [takenLabel, setTakenLabel] = useState<string | null>(null);

  const data = setup.data;
  const managed = data?.managed ?? false;
  const selection = picked ?? (data && !data.managed ? (data.configs[0]?.id ?? "new") : "new");
  const creating = !managed && selection === "new";
  const selectedConfig =
    data?.configs.find((config) => config.id === selection) ??
    (createdConfig?.id === selection
      ? { id: createdConfig.id, name: createdConfig.id, scheme: createdConfig.scheme }
      : undefined);
  const scheme = creating
    ? (schemeMode ?? data?.schemes[0]?.mode ?? "")
    : (selectedConfig?.scheme ?? data?.schemes[0]?.mode ?? "");
  const activeScheme =
    data?.schemes.find((item) => item.mode === scheme) ?? (creating ? data?.schemes[0] : undefined);
  const creationFields = creating ? (activeScheme?.creationFields ?? []) : [];
  const connectionFields = managed ? [] : (activeScheme?.connectionFields ?? []);

  useEffect(() => {
    if (!activeScheme) return;
    setValues((current) => {
      const next = { ...current };
      let changed = false;

      for (const field of [...activeScheme.creationFields, ...activeScheme.connectionFields]) {
        if (field.default && next[field.name] === undefined) {
          next[field.name] = field.default;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeScheme]);

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const ready =
    alias.trim().length > 0 &&
    takenLabel === null &&
    !missing(creationFields, values) &&
    !missing(connectionFields, values) &&
    (managed || Boolean(activeScheme) || Boolean(selectedConfig));

  const connect = async () => {
    if (!ready) return;
    setConnecting(true);

    let authConfigId = creating ? undefined : selectedConfig?.id;

    if (creating && activeScheme) {
      const created = await composio.createAuthConfig({
        environmentId,
        input: {
          toolkitSlug: toolkit.slug,
          scheme: activeScheme.mode,
          credentials: filled(creationFields, values),
        },
      });

      setConnecting(false);

      if (Predicate.isTagged(created, "Failure")) {
        composio.failed(t("{name} couldn't be connected", { name: toolkit.name }), created);

        return;
      }

      authConfigId = created.value.authConfigId;
      setCreatedConfig({ id: authConfigId, scheme: activeScheme.mode });
      setPicked(authConfigId);
      setConnecting(true);
    }

    const connection = filled(connectionFields, values);
    const result = await composio.authorize({
      environmentId,
      input: {
        toolkitSlug: toolkit.slug,
        visibility: owner,
        alias: alias.trim(),
        ...(authConfigId
          ? {
              authConfigId,
              ...(scheme ? { authScheme: scheme } : {}),
              ...(Object.keys(connection).length > 0 ? { connection } : {}),
            }
          : {}),
      },
    });

    setConnecting(false);

    if (Predicate.isTagged(result, "Failure")) {
      const error = squashAtomCommandFailure(result);

      if (Predicate.isTagged(error, "ComposioLabelTakenError")) {
        setTakenLabel(alias.trim());

        return;
      }

      composio.failed(t("{name} couldn't be connected", { name: toolkit.name }), result);

      return;
    }

    if (!result.value.redirectUrl) {
      composio.status.refresh();
      onClose();
      toast.success(t("{name} is connected", { name: toolkit.name }));

      return;
    }

    const url = new URL(result.value.redirectUrl);

    if (url.protocol !== "https:") {
      toast.error(t("{name} couldn't be connected", { name: toolkit.name }));

      return;
    }

    composio.status.refresh();
    onClose();
    void ensureLocalApi()
      .shell.openExternal(url.toString())
      .catch(() => toast.error(t("{name} sign-in couldn't be opened", { name: toolkit.name })));
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className={managed || !data ? "max-w-md" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{t("Connect {name}", { name: toolkit.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            {setup.error ? (
              <p className="text-sm text-muted-foreground">
                {t("Could not reach Composio: {error}", { error: String(setup.error) })}
              </p>
            ) : !data ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <>
                {!managed ? (
                  <UnmanagedFields
                    configs={data.configs}
                    schemes={data.schemes}
                    selection={selection}
                    creating={creating}
                    scheme={scheme}
                    creationFields={creationFields}
                    connectionFields={connectionFields}
                    values={values}
                    onPick={setPicked}
                    onScheme={setSchemeMode}
                    onValue={setValue}
                  />
                ) : null}
                <Field>
                  <div className="flex w-full items-center gap-2">
                    <Input
                      autoFocus={managed}
                      aria-label={t("Label")}
                      value={alias}
                      placeholder={t("Label, like Work or Personal")}
                      onChange={(event) => {
                        setAlias(event.currentTarget.value);
                        setTakenLabel(null);
                      }}
                    />
                    <div className="shrink-0">
                      <LibraryVisibilitySelect value={owner} editable onChange={setOwner} />
                    </div>
                  </div>
                  {takenLabel !== null ? (
                    <FieldError match>
                      {t("You already have an account called {label}.", { label: takenLabel })}
                    </FieldError>
                  ) : null}
                </Field>
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={connecting || !data || Boolean(setup.error) || !ready}>
              {connecting ? <Spinner /> : null}
              {t("Connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function UnmanagedFields({
  configs,
  schemes,
  selection,
  creating,
  scheme,
  creationFields,
  connectionFields,
  values,
  onPick,
  onScheme,
  onValue,
}: {
  readonly configs: ReadonlyArray<{ id: string; name: string; scheme: string }>;
  readonly schemes: ReadonlyArray<{ mode: string; name: string }>;
  readonly selection: string;
  readonly creating: boolean;
  readonly scheme: string;
  readonly creationFields: readonly ComposioAuthField[];
  readonly connectionFields: readonly ComposioAuthField[];
  readonly values: Readonly<Record<string, string>>;
  readonly onPick: (id: string) => void;
  readonly onScheme: (mode: string) => void;
  readonly onValue: (name: string, value: string) => void;
}) {
  const { t } = useI18n();

  if (schemes.length === 0 && configs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Composio did not list a way to connect this app.")}
      </p>
    );
  }

  return (
    <>
      {configs.length > 0 ? (
        <Field>
          <FieldLabel>{t("Configuration")}</FieldLabel>
          <RadioGroup value={selection} onValueChange={(value) => onPick(String(value))}>
            {configs.map((config) => (
              <label key={config.id} className="flex items-start gap-2">
                <Radio value={config.id} />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{config.name}</span>
                  {config.scheme ? (
                    <span className="block text-xs text-muted-foreground">
                      {schemeLabel(config.scheme, t)}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2">
              <Radio value="new" />
              <span className="text-sm text-foreground">{t("New configuration")}</span>
            </label>
          </RadioGroup>
          <FieldDescription>
            {t(
              "Pick a configuration, or create one. Composio keeps the credentials. Otto does not store them.",
            )}
          </FieldDescription>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("Composio keeps these credentials. Otto does not store them.")}
        </p>
      )}
      {creating && schemes.length > 1 ? (
        <Field>
          <FieldLabel>{t("Scheme")}</FieldLabel>
          <RadioGroup value={scheme} onValueChange={(value) => onScheme(String(value))}>
            {schemes.map((item) => (
              <label key={item.mode} className="flex items-center gap-2">
                <Radio value={item.mode} />
                <span className="text-sm text-foreground">{schemeLabel(item.mode, t)}</span>
              </label>
            ))}
          </RadioGroup>
        </Field>
      ) : null}
      <AuthFields fields={creationFields} values={values} onValue={onValue} />
      <AuthFields fields={connectionFields} values={values} onValue={onValue} />
    </>
  );
}

function AuthFields({
  fields,
  values,
  onValue,
}: {
  readonly fields: readonly ComposioAuthField[];
  readonly values: Readonly<Record<string, string>>;
  readonly onValue: (name: string, value: string) => void;
}) {
  const { t } = useI18n();

  return fields.map((field) => {
    const value = values[field.name] ?? "";
    const long = field.name.includes("scope") || (field.default?.length ?? 0) > 80;

    return (
      <Field key={field.name}>
        <FieldLabel>{field.displayName}</FieldLabel>
        {long ? (
          <Textarea
            value={value}
            onChange={(event) => onValue(field.name, event.currentTarget.value)}
          />
        ) : (
          <div className="flex w-full items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              type={field.secret ? "password" : "text"}
              value={value}
              autoComplete="off"
              onChange={(event) => onValue(field.name, event.currentTarget.value)}
            />
            {field.name.includes("redirect") ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(value)}
              >
                {t("Copy")}
              </Button>
            ) : null}
          </div>
        )}
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
      </Field>
    );
  });
}

function schemeLabel(mode: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (mode === "OAUTH2") return t("OAuth");
  if (mode === "S2S_OAUTH2") return t("Server credentials");
  if (mode === "API_KEY") return t("API key");

  return mode;
}

function missing(fields: readonly ComposioAuthField[], values: Readonly<Record<string, string>>) {
  return fields.some((field) => field.required && !(values[field.name] ?? "").trim());
}

function filled(fields: readonly ComposioAuthField[], values: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = (values[field.name] ?? "").trim();

      return value ? [[field.name, value] as const] : [];
    }),
  );
}
