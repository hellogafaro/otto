import { RiArrowDownLine, RiArrowUpLine, RiExternalLinkLine, RiLoaderLine } from "@remixicon/react";
import type { MessageKey } from "@otto/client-runtime/i18n";
import { providerSupportsBaseUrl, providerUsesApiKey } from "@otto/client-runtime/provider-auth";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type SubscriptionProviderStatus,
} from "@otto/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@otto/contracts/settings";
import { Match, Predicate } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import { requestConfirmDialog } from "../../confirm-dialog";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/use-settings";
import { useI18n } from "../../i18n";
import { useSettingsEnvironmentId } from "../../settings-dialog-store";
import { AddMenu, CardCountRow, LogoTile } from "../customize/customize-group";
import { CustomApiIcon } from "../icons";
import { recordLookup } from "../record-lookup";
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
import { MenuItem } from "../ui/menu";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { SettingsMessageRow } from "./settings-detail-layout";
import { SettingsSection } from "./settings-layout";
import { buildProviderInstanceUpdatePatch } from "./settings-panels.logic";
import { SignInCodeCopy } from "./sign-in-code-copy";
import {
  linkedAccountTitle,
  SUBSCRIPTION_PROVIDERS,
  subscriptionProviderTargetId,
  type SubscriptionProviderDefinition,
} from "./subscription-providers";
import { useSubscriptionAccounts } from "./use-subscription-accounts";

type Translate = ReturnType<typeof useI18n>["t"];

const CUSTOM_API_DRIVER = ProviderDriverKind.make("customOpenai");

const CUSTOM_API_INSTANCE_ID = defaultInstanceIdForDriver(CUSTOM_API_DRIVER);

// Otto: The Custom API driver reads its key from this instance variable, stored as a secret.
const CUSTOM_API_KEY_ENV = "CUSTOM_OPENAI_API_KEY";

/** A reset time: the clock time when it is within the day, else the date. */
function formatResetTime(iso: string, locale: string, now: number): string {
  const at = new Date(iso);
  const sameDay = at.getTime() - now < 20 * 60 * 60 * 1000;

  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" },
  ).format(at);
}

type AccountProblem =
  | { readonly kind: "checking" }
  | { readonly kind: "resting"; readonly time: string }
  | { readonly kind: "signed-out"; readonly label: MessageKey }
  | { readonly kind: "unreachable" };

/** What is wrong with an account right now, or null when it works. */
function accountProblem(
  status: SubscriptionProviderStatus,
  busy: boolean,
  locale: string,
  now: number,
): AccountProblem | null {
  if (busy || status.healthChecking === true) return { kind: "checking" };

  if (status.nextRetryAt && Date.parse(status.nextRetryAt) > now) {
    return { kind: "resting", time: formatResetTime(status.nextRetryAt, locale, now) };
  }

  if (status.health === "expired") return { kind: "signed-out", label: "Login expired" };

  if (status.health === "revoked") {
    return {
      kind: "signed-out",
      label: providerUsesApiKey(status) ? "Key rejected" : "Signed out",
    };
  }

  if (status.health === "failed" || status.health === "failed-first-request") {
    return { kind: "unreachable" };
  }

  return null;
}

function connectionTitle(
  definition: SubscriptionProviderDefinition,
  status: SubscriptionProviderStatus,
  t: Translate,
) {
  if (definition.id !== "opencode-go" && providerUsesApiKey(status)) {
    return t("{provider} API key", { provider: definition.label });
  }

  return linkedAccountTitle(definition, status, t);
}

/** The Custom API instance as saved: the explicit instance, else the legacy per-driver settings. */
function customApiInstance(settings: UnifiedSettings): ProviderInstanceConfig {
  const explicit = settings.providerInstances?.[CUSTOM_API_INSTANCE_ID];

  if (explicit) return explicit;

  const legacy = recordLookup(settings.providers, CUSTOM_API_DRIVER);

  if (!legacy) return { driver: CUSTOM_API_DRIVER };
  const { enabled, ...config } = legacy;

  return { driver: CUSTOM_API_DRIVER, enabled, config };
}

function customApiConfig(instance: ProviderInstanceConfig) {
  const config = Predicate.isObject(instance.config) ? instance.config : {};
  const baseUrl = "baseUrl" in config && Predicate.isString(config.baseUrl) ? config.baseUrl : "";

  const models =
    "customModels" in config && Array.isArray(config.customModels)
      ? config.customModels.filter(Predicate.isString)
      : [];

  return { config, baseUrl, models };
}

/**
 * Otto: Models lists every connection bots can run on in one card, like Capy's connections:
 * a count row whose plus signs in to a provider or adds a Custom API, then one row per
 * account. Several accounts of one provider run in order, the first ready one serving and
 * the next taking over when it hits a limit. Sign-in and keys open in a dialog.
 */
export function ModelsConnectionsSection() {
  const { t } = useI18n();
  const environmentId = useSettingsEnvironmentId();

  if (environmentId === null) {
    return (
      <SettingsSection title={t("Connections")}>
        <SettingsMessageRow>
          {t("Connect to an environment to set up providers.")}
        </SettingsMessageRow>
      </SettingsSection>
    );
  }

  return <Connections key={environmentId} environmentId={environmentId} />;
}

function Connections({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t, plural, locale } = useI18n();
  const accounts = useSubscriptionAccounts(environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [customApiOpen, setCustomApiOpen] = useState(false);

  if (!accounts.statusQuery.data && accounts.statusQuery.isPending) {
    return <SkeletonSettingsSections label={t("Loading settings")} sections={[3]} />;
  }

  const linked = accounts.statusQuery.data?.linkedAccounts ?? [];

  const groups = SUBSCRIPTION_PROVIDERS.map((definition) => ({
    definition,
    statuses: linked.filter(
      (status) => status.provider === definition.id && status.accountId !== undefined,
    ),
  }));

  const customApi = customApiInstance(settings);
  const custom = customApiConfig(customApi);
  const customConfigured = custom.baseUrl.length > 0;
  const count = linked.length + (customConfigured ? 1 : 0);
  const locked = accounts.busyProvider !== null;
  const now = Date.now();

  const addConnection = (definition: SubscriptionProviderDefinition) => {
    const target = groups.some(
      (group) => group.definition.id === definition.id && group.statuses.length > 0,
    )
      ? ({ addAccount: true } as const)
      : {};

    void accounts.connect(definition, target);
  };

  const removeAccount = async (
    definition: SubscriptionProviderDefinition,
    status: SubscriptionProviderStatus,
  ) => {
    const name = connectionTitle(definition, status, t);

    const confirmed =
      (await requestConfirmDialog(t("Disconnect {name}? Bots stop using it.", { name }), {
        variant: "destructive",
      })) ?? false;

    if (!confirmed) return;
    await accounts.disconnect(definition.id, status.accountId);
    toast.success(t("{name} has been disconnected", { name }));
  };

  const removeCustomApi = async () => {
    const confirmed =
      (await requestConfirmDialog(
        t("Disconnect {name}? Bots stop using it.", { name: "Custom API" }),
        {
          variant: "destructive",
        },
      )) ?? false;

    if (!confirmed) return;
    const instances = { ...settings.providerInstances };
    delete instances[CUSTOM_API_INSTANCE_ID];
    updateSettings({
      providers: {
        ...settings.providers,
        [CUSTOM_API_DRIVER]: DEFAULT_UNIFIED_SETTINGS.providers.customOpenai,
      },
      providerInstances: instances,
    });
    toast.success(t("{name} has been disconnected", { name: "Custom API" }));
  };

  return (
    <SettingsSection id="providers" title={t("Connections")}>
      <CardCountRow
        label={plural(count, { one: "{count} connection", other: "{count} connections" })}
        action={
          <AddMenu label={t("Add connection")}>
            {SUBSCRIPTION_PROVIDERS.map((definition) => (
              <MenuItem
                key={definition.id}
                disabled={locked}
                onClick={() => addConnection(definition)}
              >
                <definition.icon aria-hidden />
                {definition.label}
              </MenuItem>
            ))}
            {customConfigured ? null : (
              <MenuItem onClick={() => setCustomApiOpen(true)}>
                <CustomApiIcon aria-hidden />
                {t("Custom API")}
              </MenuItem>
            )}
          </AddMenu>
        }
      />
      {accounts.statusQuery.error && !accounts.statusQuery.data ? (
        <SettingsMessageRow
          tone="error"
          action={
            <Button size="sm" variant="outline" onClick={() => accounts.statusQuery.refresh()}>
              {t("Try again")}
            </Button>
          }
        >
          {t("Connections couldn't be loaded")}
        </SettingsMessageRow>
      ) : null}
      {accounts.error && !accounts.activeLogin && !accounts.keyProvider ? (
        <SettingsMessageRow tone="error">{accounts.error}</SettingsMessageRow>
      ) : null}
      {groups.flatMap(({ definition, statuses }) =>
        statuses.map((status, index) => {
          const problem = accountProblem(
            status,
            accounts.busyAccount === status.accountId,
            locale,
            now,
          );

          const title = connectionTitle(definition, status, t);
          const usesKey = providerUsesApiKey(status);

          const move = (offset: -1 | 1) => {
            const ids = statuses.map((entry) => entry.accountId!);
            const [moved] = ids.splice(index, 1);
            ids.splice(index + offset, 0, moved!);
            void accounts.setAccountOrder(definition.id, ids);
          };

          const reconnect = () =>
            usesKey
              ? accounts.openApiKey(definition, { accountId: status.accountId! })
              : void accounts.connect(definition, { accountId: status.accountId! });

          return (
            <div
              key={status.accountId}
              {...(index === 0 ? { id: subscriptionProviderTargetId(definition.id) } : {})}
              data-settings-row=""
              className="flex items-center gap-3 px-4 py-3"
            >
              <LogoTile>
                <definition.icon aria-hidden className="size-4" />
              </LogoTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-13px font-medium text-foreground">
                  {title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {statuses.length > 1
                    ? index === 0
                      ? t("Main account")
                      : t("Backup {number}", { number: String(index) })
                    : t(definition.subscription)}
                </span>
              </span>
              {problem === null
                ? null
                : Match.value(problem).pipe(
                    Match.when({ kind: "checking" }, () => (
                      <Badge variant="quiet">{t("Checking")}</Badge>
                    )),
                    Match.when({ kind: "resting" }, ({ time }) => (
                      <Badge variant="warning">{t("Back at {time}", { time })}</Badge>
                    )),
                    Match.when({ kind: "signed-out" }, ({ label }) => (
                      <Badge variant="error">{t(label)}</Badge>
                    )),
                    Match.when({ kind: "unreachable" }, () => (
                      <Badge variant="error">{t("Unreachable")}</Badge>
                    )),
                    Match.exhaustive,
                  )}
              {statuses.length > 1 ? (
                <span className="flex items-center">
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={t("Move {account} up", { account: title })}
                    disabled={locked || index === 0}
                    onClick={() => move(-1)}
                  >
                    <RiArrowUpLine />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={t("Move {account} down", { account: title })}
                    disabled={locked || index === statuses.length - 1}
                    onClick={() => move(1)}
                  >
                    <RiArrowDownLine />
                  </Button>
                </span>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() => void removeAccount(definition, status)}
              >
                {t("Remove")}
              </Button>
              {problem === null
                ? null
                : Match.value(problem).pipe(
                    Match.when({ kind: "unreachable" }, () => (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() => void accounts.testHealth(definition.id, status.accountId)}
                      >
                        {t("Try again")}
                      </Button>
                    )),
                    Match.when({ kind: "signed-out" }, () => (
                      <Button size="sm" variant="outline" disabled={locked} onClick={reconnect}>
                        {usesKey ? t("Replace key") : t("Sign in again")}
                      </Button>
                    )),
                    Match.orElse(() => null),
                  )}
            </div>
          );
        }),
      )}
      {customConfigured ? (
        <div data-settings-row="" className="flex items-center gap-3 px-4 py-3">
          <LogoTile>
            <CustomApiIcon aria-hidden className="size-4" />
          </LogoTile>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-13px font-medium text-foreground">
              {t("Custom API")}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{custom.baseUrl}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => void removeCustomApi()}>
            {t("Remove")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCustomApiOpen(true)}>
            {t("Edit")}
          </Button>
        </div>
      ) : null}
      {count === 0 && !accounts.statusQuery.error ? (
        <SettingsMessageRow>{t("Connect a provider so bots can reply.")}</SettingsMessageRow>
      ) : null}
      <ConnectDialog accounts={accounts} />
      {customApiOpen ? (
        <CustomApiDialog
          instance={customApi}
          onClose={() => setCustomApiOpen(false)}
          onSave={(instance) => {
            updateSettings(
              buildProviderInstanceUpdatePatch({
                settings,
                instanceId: CUSTOM_API_INSTANCE_ID,
                instance,
                driver: CUSTOM_API_DRIVER,
                isDefault: true,
              }),
            );
            toast.success(t("{name} has been saved", { name: "Custom API" }));
            setCustomApiOpen(false);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

/** The sign-in or API key step of a connection, open while one runs. */
function ConnectDialog({
  accounts,
}: {
  readonly accounts: ReturnType<typeof useSubscriptionAccounts>;
}) {
  const { t } = useI18n();
  const login = accounts.activeLogin;
  const keyProvider = accounts.keyProvider;

  if (keyProvider) {
    const replacing = accounts.keyTarget.accountId !== undefined;

    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : accounts.closeApiKey())}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {replacing
                ? t("Replace {name} key", { name: keyProvider.label })
                : t("Connect {name}", { name: keyProvider.label })}
            </DialogTitle>
            <DialogDescription>
              {t("API billing can be separate from your subscription.")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void accounts.saveApiKey();
            }}
          >
            <DialogPanel className="space-y-3">
              <Input
                autoFocus
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={t("API key")}
                placeholder={t("API key")}
                value={accounts.pastedCode}
                disabled={accounts.completing}
                onChange={(event) => accounts.setPastedCode(event.currentTarget.value)}
              />
              {providerSupportsBaseUrl(keyProvider.id) ? (
                <Input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("Base URL (optional)")}
                  placeholder={t("Base URL (optional)")}
                  value={accounts.baseUrl}
                  disabled={accounts.completing}
                  onChange={(event) => accounts.setBaseUrl(event.currentTarget.value)}
                />
              ) : null}
              {accounts.error ? (
                <p role="alert" className="text-13px text-destructive">
                  {accounts.error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={accounts.closeApiKey}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={accounts.completing || !accounts.pastedCode.trim()}>
                {accounts.completing ? <Spinner /> : null}
                {t("Save key")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    );
  }

  if (!login) return null;
  const { flow } = login;
  const definition = SUBSCRIPTION_PROVIDERS.find((candidate) => candidate.id === flow.provider);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void accounts.cancelLogin())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Connect {name}", { name: login.providerLabel })}</DialogTitle>
          <DialogDescription>
            {flow.userCode
              ? t("Copy this code, then open the sign-in page and enter it.")
              : (flow.instructions ??
                t("Finish signing in to {provider} in the browser.", {
                  provider: login.providerLabel,
                }))}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {flow.userCode ? <SignInCodeCopy code={flow.userCode} className="bg-muted/60" /> : null}
          <Button
            size="sm"
            variant="outline"
            render={<a href={flow.url} target="_blank" rel="noreferrer" />}
          >
            {t("Open sign-in page")}
            <RiExternalLinkLine />
          </Button>
          {flow.completion === "paste" ? (
            <Input
              autoComplete="off"
              value={accounts.pastedCode}
              onChange={(event) => accounts.setPastedCode(event.currentTarget.value)}
              placeholder={t("Paste the authorization code")}
              aria-label={t("Authorization code")}
            />
          ) : !login.error ? (
            <p className="flex items-center gap-2 text-13px text-muted-foreground">
              <RiLoaderLine className="size-3.5 animate-spin" />
              {t("Waiting for approval…")}
            </p>
          ) : null}
          {login.error ? (
            <p role="alert" className="text-13px text-destructive">
              {login.error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {definition ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:me-auto"
              onClick={() =>
                void accounts
                  .cancelLogin()
                  .then(() => accounts.openApiKey(definition, accounts.keyTarget))
              }
            >
              {t("Use an API key")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => void accounts.cancelLogin()}>
            {t("Cancel")}
          </Button>
          {flow.completion === "paste" ? (
            <Button
              disabled={accounts.pastedCode.trim().length === 0 || accounts.completing}
              onClick={() => void accounts.complete()}
            >
              {accounts.completing ? <Spinner /> : null}
              {t("Connect")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Base URL, key and model IDs of the one OpenAI-compatible endpoint. */
function CustomApiDialog({
  instance,
  onSave,
  onClose,
}: {
  readonly instance: ProviderInstanceConfig;
  readonly onSave: (instance: ProviderInstanceConfig) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const saved = customApiConfig(instance);
  const savedKey = instance.environment?.find((variable) => variable.name === CUSTOM_API_KEY_ENV);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(saved.models.join("\n"));
  const validUrl = /^https?:\/\/\S+$/.test(baseUrl.trim());

  const save = () => {
    if (!validUrl) return;
    const key = apiKey.trim();

    const others = (instance.environment ?? []).filter(
      (variable) => variable.name !== CUSTOM_API_KEY_ENV,
    );

    const keyVariable = key ? { name: CUSTOM_API_KEY_ENV, value: key, sensitive: true } : savedKey;

    onSave({
      ...instance,
      driver: CUSTOM_API_DRIVER,
      enabled: true,
      environment: keyVariable ? [...others, keyVariable] : others,
      config: {
        ...saved.config,
        baseUrl: baseUrl.trim(),
        customModels: [
          ...new Set(
            models
              .split(/[\n,]/)
              .map((model) => model.trim())
              .filter((model) => model.length > 0),
          ),
        ],
      },
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Custom API")}</DialogTitle>
          <DialogDescription>
            {t("Any OpenAI-compatible endpoint. The key stays on this environment.")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <DialogPanel className="space-y-3">
            <Input
              autoFocus
              type="url"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("Base URL")}
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("API key")}
              placeholder={savedKey ? t("Saved key, type to replace it") : t("API key")}
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
            <Textarea
              aria-label={t("Model IDs")}
              placeholder={t("Model IDs, one per line")}
              rows={3}
              value={models}
              onChange={(event) => setModels(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!validUrl}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
