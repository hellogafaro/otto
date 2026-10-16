import { RiExternalLinkLine, RiLoaderLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SignInCodeCopy } from "./sign-in-code-copy";
import type { ActiveLogin } from "./use-subscription-accounts";

export type Translate = ReturnType<typeof useI18n>["t"];

export function ProviderApiKeyForm({
  supportsBaseUrl = true,
  apiKey,
  baseUrl,
  busy,
  error,
  onKeyChange,
  onBaseUrlChange,
  onSave,
  onCancel,
}: {
  readonly supportsBaseUrl?: boolean;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onKeyChange: (value: string) => void;
  readonly onBaseUrlChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <form
      className="space-y-3 px-3 pb-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="block space-y-1 text-sm">
        <span>{t("API key")}</span>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          disabled={busy}
          onChange={(event) => onKeyChange(event.currentTarget.value)}
        />
      </label>
      {supportsBaseUrl ? (
        <label className="block space-y-1 text-sm">
          <span>{t("Base URL (optional)")}</span>
          <Input
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("Provider default")}
            value={baseUrl}
            disabled={busy}
            onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <p className="text-13px text-muted-foreground">
        {supportsBaseUrl
          ? t("The environment sends this key to the selected endpoint.")
          : t("Grok uses its default endpoint.")}{" "}
        {t("API billing can be separate from your subscription.")}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !apiKey.trim()}>
          {busy ? t("Saving…") : t("Save")}
        </Button>
        <Button type="button" size="sm" variant="ghost-muted" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

export function ActiveLoginPanel({
  login,
  pastedCode,
  onPastedCodeChange,
  onComplete,
  onCancel,
  completing,
}: {
  readonly login: ActiveLogin;
  readonly pastedCode: string;
  readonly onPastedCodeChange: (value: string) => void;
  readonly onComplete: () => void;
  readonly onCancel: () => void;
  readonly completing: boolean;
}) {
  const { t } = useI18n();
  const { flow } = login;
  const isApiKey = flow.provider === "opencode-go";

  return (
    <div data-settings-row="" className="space-y-3 rounded-lg p-4">
      <p className="text-13px leading-copy text-muted-foreground">
        {flow.userCode
          ? t("Copy this code, then open the sign-in page and enter it.")
          : (flow.instructions ??
            t("Finish signing in to {provider} in the browser.", {
              provider: login.providerLabel,
            }))}
      </p>

      {/* The shared copy control falls back to manual copy on plain-HTTP remote clients. */}
      {flow.userCode ? <SignInCodeCopy code={flow.userCode} className="bg-muted/60" /> : null}

      <Button
        size="sm"
        variant="outline"
        render={<a href={flow.url} target="_blank" rel="noreferrer" />}
      >
        {isApiKey ? t("Open OpenCode") : t("Open sign-in page")}
        <RiExternalLinkLine className="size-3.5" />
      </Button>

      {flow.completion === "paste" ? (
        <div className="flex gap-2">
          <Input
            type={isApiKey ? "password" : "text"}
            autoComplete="off"
            value={pastedCode}
            onChange={(event) => onPastedCodeChange(event.currentTarget.value)}
            placeholder={isApiKey ? t("Paste the API key") : t("Paste the authorization code")}
            aria-label={isApiKey ? t("API key") : t("Authorization code")}
            className="flex-1"
          />
          <Button disabled={pastedCode.trim().length === 0 || completing} onClick={onComplete}>
            {completing ? <RiLoaderLine className="size-3.5 animate-spin" /> : null}
            {t("Connect")}
          </Button>
        </div>
      ) : !login.error ? (
        <div className="flex items-center gap-2 text-13px text-muted-foreground">
          <RiLoaderLine className="size-3.5 animate-spin" />
          {t("Waiting for approval…")}
        </div>
      ) : null}

      {login.error ? (
        <p role="alert" className="text-13px text-destructive">
          {login.error}
        </p>
      ) : null}

      <Button size="sm" variant="ghost-muted" disabled={completing} onClick={onCancel}>
        {t("Cancel")}
      </Button>
    </div>
  );
}
