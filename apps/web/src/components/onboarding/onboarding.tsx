import { useAtomValue } from "@effect/atom-react";
import { RiExternalLinkLine } from "@remixicon/react";
import { providerSupportsBaseUrl } from "@otto/client-runtime/provider-auth";
import { BOT_INSTRUCTIONS_MAX_CHARS, type EnvironmentId } from "@otto/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { environmentBotsAtom, environmentRosterLoadedAtom } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentShell } from "../../state/shell";
import { AuthActions, AuthSurfaceSection, AuthSurfaceShell } from "../auth/auth-surface-shell";
import { CustomizeRow } from "../customize/customize-group";
import { randomBotAvatar } from "../roster/roster.logic";
import { useCreateBot } from "../roster/use-create-bot";
import { SettingsCard } from "../settings/settings-layout";
import { SignInCodeCopy } from "../settings/sign-in-code-copy";
import { SUBSCRIPTION_PROVIDERS } from "../settings/subscription-providers";
import { useSubscriptionAccounts } from "../settings/use-subscription-accounts";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

/** Kept from the earlier setup so people who finished or skipped it never see it again. */
export const ONBOARDING_COMPLETED_STORAGE_KEY = "otto:desktop-onboarding-completed:v1";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Whether first-run setup replaces the app: once the roster has loaded with no bots, until the
 * person creates one or skips. Anyone who already has a bot is marked done for good.
 */
export function useOnboarding() {
  const environmentId = usePrimaryEnvironmentId();
  const atomKey = environmentId ?? NO_ENVIRONMENT;
  const shellLive = useAtomValue(environmentShell.stateValueAtom(atomKey)).status === "live";
  const rosterLoaded = useAtomValue(environmentRosterLoadedAtom(atomKey)) && shellLive;
  const botCount = useAtomValue(environmentBotsAtom(atomKey)).length;

  const [completed, setCompleted] = useState(
    () => window.localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1",
  );

  useEffect(() => {
    if (rosterLoaded && botCount > 0) {
      window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
    }
  }, [botCount, rosterLoaded]);

  const finish = () => {
    window.localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
    setCompleted(true);
  };

  return {
    environmentId: !completed && rosterLoaded && botCount === 0 ? environmentId : null,
    finish,
  };
}

function Header({
  step,
  title,
  description,
}: {
  readonly step: number;
  readonly title: string;
  readonly description: string;
}) {
  const { t } = useI18n();

  return (
    <AuthSurfaceSection className="gap-2">
      <p className="text-xs text-muted-foreground">
        {t("Step {number} of {total}", { number: step, total: 2 })}
      </p>
      <h1 className="text-xl leading-title font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </AuthSurfaceSection>
  );
}

/**
 * Otto: First-run setup, one question per screen in the sign-in column: connect a provider,
 * then create the first bot, which opens in its chat and introduces itself.
 */
export function Onboarding({
  environmentId,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDone: () => void;
}) {
  const { t } = useI18n();
  const accounts = useSubscriptionAccounts(environmentId);
  const { creating, create } = useCreateBot(onDone);
  const [avatar] = useState(randomBotAvatar);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const { activeLogin: login, keyProvider } = accounts;
  const statuses = accounts.statusQuery.data;

  const skip = (
    <Button variant="ghost" disabled={creating} onClick={onDone}>
      {t("Skip setup")}
    </Button>
  );

  const errorAlert = (error: string | null) =>
    error ? (
      <Alert variant="error">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : null;

  let screen: ReactNode;

  if (keyProvider) {
    screen = (
      <>
        <Header
          step={1}
          title={t("Connect {name}", { name: keyProvider.label })}
          description={t("API billing can be separate from your subscription.")}
        />
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void accounts.saveApiKey();
          }}
        >
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
          {errorAlert(accounts.error)}
          <AuthActions>
            <Button
              type="submit"
              variant="primary"
              disabled={accounts.completing || !accounts.pastedCode.trim()}
            >
              {accounts.completing ? <Spinner /> : null}
              {t("Save key")}
            </Button>
            <Button variant="ghost" onClick={accounts.closeApiKey}>
              {t("Back")}
            </Button>
          </AuthActions>
        </form>
      </>
    );
  } else if (login) {
    const definition = SUBSCRIPTION_PROVIDERS.find(
      (candidate) => candidate.id === login.flow.provider,
    );

    const paste = login.flow.completion === "paste";

    const openSignIn = (
      <Button
        variant={paste ? "ghost" : "primary"}
        render={<a href={login.flow.url} target="_blank" rel="noreferrer" />}
      >
        {t("Open sign-in page")}
        <RiExternalLinkLine />
      </Button>
    );

    screen = (
      <>
        <Header
          step={1}
          title={t("Connect {name}", { name: login.providerLabel })}
          description={
            login.flow.userCode
              ? t("Copy this code, then open the sign-in page and enter it.")
              : (login.flow.instructions ??
                t("Finish signing in to {provider} in the browser.", {
                  provider: login.providerLabel,
                }))
          }
        />
        <AuthSurfaceSection>
          {login.flow.userCode ? <SignInCodeCopy code={login.flow.userCode} /> : null}
          {paste ? (
            <Input
              autoFocus
              autoComplete="off"
              aria-label={t("Authorization code")}
              placeholder={t("Paste the authorization code")}
              value={accounts.pastedCode}
              onChange={(event) => accounts.setPastedCode(event.currentTarget.value)}
            />
          ) : login.error ? null : (
            <p className="text-sm text-muted-foreground">{t("Waiting for approval…")}</p>
          )}
          {errorAlert(login.error)}
          <AuthActions>
            {paste ? (
              <Button
                variant="primary"
                disabled={accounts.completing || !accounts.pastedCode.trim()}
                onClick={() => void accounts.complete()}
              >
                {accounts.completing ? <Spinner /> : null}
                {t("Connect")}
              </Button>
            ) : null}
            {openSignIn}
            {definition ? (
              <Button
                variant="ghost"
                onClick={() =>
                  void accounts.cancelLogin().then(() => accounts.openApiKey(definition))
                }
              >
                {t("Use an API key")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void accounts.cancelLogin()}>
              {t("Back")}
            </Button>
          </AuthActions>
        </AuthSurfaceSection>
      </>
    );
  } else if (!statuses?.providers.some((status) => status.connected)) {
    screen = (
      <>
        <Header
          step={1}
          title={t("Connect your provider")}
          description={t("Bots run on your own subscription or API key.")}
        />
        <AuthSurfaceSection>
          {statuses ? (
            <SettingsCard>
              {SUBSCRIPTION_PROVIDERS.map((definition) => (
                <CustomizeRow
                  key={definition.id}
                  logo={<definition.icon aria-hidden className="size-4" />}
                  name={definition.label}
                  detail={t(definition.subscription)}
                  onOpen={() => {
                    if (accounts.busyProvider === null) void accounts.connect(definition);
                  }}
                />
              ))}
            </SettingsCard>
          ) : accounts.statusQuery.error ? (
            <>
              {errorAlert(t("Connections couldn't be loaded"))}
              <Button variant="primary" onClick={() => accounts.statusQuery.refresh()}>
                {t("Try again")}
              </Button>
            </>
          ) : (
            <SkeletonSettingsSections
              label={t("Loading settings")}
              sections={[SUBSCRIPTION_PROVIDERS.length]}
              headings={false}
            />
          )}
          {errorAlert(accounts.error)}
          {skip}
        </AuthSurfaceSection>
      </>
    );
  } else {
    const trimmedName = name.trim();

    screen = (
      <>
        <Header
          step={2}
          title={t("Create your first bot")}
          description={t("It introduces itself and asks about your work.")}
        />
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();

            if (creating || !trimmedName) return;
            void create({
              name: trimmedName,
              avatar,
              engine: null,
              instructions: instructions.trim() || null,
            });
          }}
        >
          <Input
            autoFocus
            maxLength={80}
            aria-label={t("Bot name")}
            placeholder={t("Name your bot")}
            value={name}
            disabled={creating}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Textarea
            rows={4}
            maxLength={BOT_INSTRUCTIONS_MAX_CHARS}
            className="resize-none"
            aria-label={t("Instructions")}
            placeholder={t("Instructions (optional)")}
            value={instructions}
            disabled={creating}
            onChange={(event) => setInstructions(event.currentTarget.value)}
          />
          <AuthActions>
            <Button type="submit" variant="primary" disabled={creating || !trimmedName}>
              {creating ? <Spinner /> : null}
              {t("Create bot")}
            </Button>
            {skip}
          </AuthActions>
        </form>
      </>
    );
  }

  return (
    <>
      {isElectron ? <div aria-hidden className="drag-region fixed inset-x-0 top-0 h-11" /> : null}
      <AuthSurfaceShell>{screen}</AuthSurfaceShell>
    </>
  );
}
