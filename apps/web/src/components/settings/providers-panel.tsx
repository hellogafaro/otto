import { RiLoaderLine } from "@remixicon/react";

import { type ReactNode } from "react";
import type { EnvironmentId, ProviderInstanceId } from "@otto/contracts";
import { providerUsesApiKey, providerSupportsBaseUrl } from "@otto/client-runtime/provider-auth";
import { useAtomValue } from "@effect/atom-react";
import { providerAccessModelNames } from "@otto/client-runtime/provider-access";
import { useI18n } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { SettingsMessageRow } from "./settings-detail-layout";
import { SettingsSection } from "./settings-layout";
import type { SubscriptionProviderDefinition } from "./subscription-providers";
import {
  ProviderAccountRows,
  ProviderApiKeyForm,
  ActiveLoginPanel,
} from "./provider-account-controls";
import { useSubscriptionAccounts } from "./use-subscription-accounts";

export { SUBSCRIPTION_PROVIDERS } from "./subscription-providers";

/**
 * Account section of a provider subpage. A running sign-in or API key form
 * replaces the rows until it finishes or the user cancels.
 */
export function ProviderAccountSection({
  environmentId,
  definition,
  instanceId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly definition: SubscriptionProviderDefinition;
  readonly instanceId?: ProviderInstanceId;
}) {
  const { t } = useI18n();
  const accounts = useSubscriptionAccounts(environmentId, instanceId);
  const serverProviders = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.providers;

  const status = instanceId
    ? accounts.statusQuery.data?.accounts.find(
        (entry) => entry.provider === definition.id && entry.instanceId === instanceId,
      )
    : accounts.statusByProvider.get(definition.id);

  const loadError = status ? null : accounts.statusQuery.error;

  let body: ReactNode;

  if (environmentId === null) {
    body = (
      <SettingsMessageRow>
        {t("Connect to an environment to manage this account.")}
      </SettingsMessageRow>
    );
  } else if (accounts.keyProvider) {
    body = (
      <div data-settings-row="" className="rounded-lg pt-4">
        <h3 className="px-4 pb-3 text-13px font-medium tracking-title-xs text-foreground">
          {status?.connected && providerUsesApiKey(status)
            ? t("Replace API key")
            : t("Add API key")}
        </h3>
        <ProviderApiKeyForm
          supportsBaseUrl={providerSupportsBaseUrl(accounts.keyProvider.id)}
          apiKey={accounts.pastedCode}
          baseUrl={accounts.baseUrl}
          busy={accounts.completing}
          error={accounts.error}
          onKeyChange={accounts.setPastedCode}
          onBaseUrlChange={accounts.setBaseUrl}
          onSave={() => void accounts.saveApiKey()}
          onCancel={accounts.closeApiKey}
        />
      </div>
    );
  } else if (accounts.activeLogin) {
    body = (
      <ActiveLoginPanel
        login={accounts.activeLogin}
        pastedCode={accounts.pastedCode}
        onPastedCodeChange={accounts.setPastedCode}
        onComplete={() => void accounts.complete()}
        onCancel={() => void accounts.cancelLogin()}
        completing={accounts.completing}
      />
    );
  } else if (!status && accounts.statusQuery.isPending) {
    body = (
      <SettingsMessageRow>
        <span className="inline-flex items-center gap-2">
          <RiLoaderLine className="size-3.5 animate-spin" />
          {t("Checking account")}
        </span>
      </SettingsMessageRow>
    );
  } else {
    body = (
      <>
        {loadError ? (
          <SettingsMessageRow
            tone="error"
            action={
              <Button size="sm" variant="outline" onClick={() => accounts.statusQuery.refresh()}>
                {t("Try again")}
              </Button>
            }
          >
            {loadError}
          </SettingsMessageRow>
        ) : null}
        {accounts.error ? (
          <SettingsMessageRow tone="error">{accounts.error}</SettingsMessageRow>
        ) : null}
        <ProviderAccountRows
          definition={definition}
          status={status}
          models={providerAccessModelNames(serverProviders, definition.id)}
          busy={accounts.busyProvider === definition.id}
          disabled={accounts.busyProvider !== null}
          onApiKey={() => accounts.openApiKey(definition)}
          onConnect={() => void accounts.connect(definition)}
          onDisconnect={() => void accounts.disconnect(definition.id)}
          onTest={() => void accounts.testHealth(definition.id)}
        />
      </>
    );
  }

  return (
    <SettingsSection
      id={instanceId ? `provider-account-${instanceId}` : "provider-account"}
      title={instanceId ? t("Instance account") : t("Account")}
    >
      {body}
    </SettingsSection>
  );
}

export { ProviderAccountRows, ProviderApiKeyForm } from "./provider-account-controls";

export { useSubscriptionStatuses } from "./use-subscription-accounts";
