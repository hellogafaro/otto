import { isAtomCommandInterrupted } from "@otto/client-runtime/state/runtime";
import type { EnvironmentId, GitHubLinkCode } from "@otto/contracts";
import { Match, Predicate } from "effect";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";
import { ensureLocalApi } from "../../local-api";
import { useSettingsEnvironmentId } from "../../settings-dialog-store";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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

const GITHUB_AUTHORIZATIONS_URL = "https://github.com/settings/apps/authorizations";

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

/** Shows the code to enter on GitHub and waits, at GitHub's pace, until the link lands. */
function GitHubLinkDialog({
  environmentId,
  code,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly code: GitHubLinkCode;
  readonly onClose: (connected: boolean) => void;
}) {
  const { t } = useI18n();
  const poll = useAtomCommand(serverEnvironment.pollGitHubLink, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [ended, setEnded] = useState<"expired" | "denied" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const result = await poll({ environmentId, input: {} });

      if (cancelled) return;

      if (Predicate.isTagged(result, "Failure")) {
        if (!isAtomCommandInterrupted(result)) toast.error(t("GitHub couldn't be connected"));
        onClose(false);

        return;
      }

      if (result.value.state === "pending") {
        timer = setTimeout(() => void tick(), code.intervalSeconds * 1_000);

        return;
      }

      if (result.value.state === "connected") {
        onClose(true);

        return;
      }

      setEnded(result.value.state);
    };

    timer = setTimeout(() => void tick(), code.intervalSeconds * 1_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, environmentId, onClose, poll, t]);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose(false))}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Connect GitHub")}</DialogTitle>
          <DialogDescription>
            {Match.value(ended).pipe(
              Match.when("expired", () => t("The code expired. Close this and try again.")),
              Match.when("denied", () => t("GitHub access was declined.")),
              Match.orElse(() =>
                t("Enter this code on GitHub. This closes by itself once you approve."),
              ),
            )}
          </DialogDescription>
        </DialogHeader>
        {ended === null ? (
          <DialogPanel>
            <p className="text-center font-mono text-2xl tracking-widest select-all">
              {code.userCode}
            </p>
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onClose(false)}>
            {ended === null ? t("Cancel") : t("Close")}
          </Button>
          {ended === null ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => copyToClipboard(code.userCode)}
              >
                {isCopied ? t("Copied") : t("Copy code")}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void ensureLocalApi()
                    .shell.openExternal(code.verificationUri)
                    .catch(() => toast.error(t("GitHub couldn't be opened")))
                }
              >
                {t("Open GitHub")}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Otto: each person links their own GitHub, so bots push and open pull requests as them. */
function GitHubRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t } = useI18n();
  const status = useEnvironmentQuery(serverEnvironment.githubStatus({ environmentId, input: {} }));
  const start = useAtomCommand(serverEnvironment.startGitHubLink, { reportFailure: false });
  const disconnect = useAtomCommand(serverEnvironment.disconnectGitHub, { reportFailure: false });
  const [code, setCode] = useState<GitHubLinkCode | null>(null);
  const [starting, setStarting] = useState(false);
  const login = status.data?.login ?? null;
  const refreshStatus = status.refresh;

  const openExternal = (url: string) =>
    void ensureLocalApi()
      .shell.openExternal(url)
      .catch(() => toast.error(t("GitHub couldn't be opened")));

  const connect = async () => {
    setStarting(true);
    const result = await start({ environmentId, input: {} });
    setStarting(false);

    if (Predicate.isTagged(result, "Failure")) {
      if (!isAtomCommandInterrupted(result)) toast.error(t("GitHub couldn't be connected"));

      return;
    }

    setCode(result.value);
  };

  const remove = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t(
        "Disconnect GitHub? Bots can no longer push or open pull requests for you. To revoke Otto on GitHub too, visit {url}.",
        { url: GITHUB_AUTHORIZATIONS_URL },
      ),
      { variant: "destructive" },
    );

    if (!confirmed) return;
    const result = await disconnect({ environmentId, input: {} });

    if (Predicate.isTagged(result, "Failure") && !isAtomCommandInterrupted(result)) {
      toast.error(t("GitHub couldn't be disconnected"));

      return;
    }

    refreshStatus();
  };

  const closeDialog = useCallback(
    (connected: boolean) => {
      setCode(null);

      if (connected) refreshStatus();
    },
    [refreshStatus],
  );

  return (
    <SettingsRow
      title={t("GitHub")}
      description={
        login
          ? t("Bots push and open pull requests as @{login}.", { login })
          : t("Let bots push and open pull requests as you.")
      }
      control={
        <>
          {login ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => void remove()}>
                {t("Disconnect")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => status.data && openExternal(status.data.installUrl)}
              >
                {t("Add repositories")}
              </Button>
            </>
          ) : (
            <Button
              disabled={!status.data || starting}
              size="sm"
              variant="outline"
              onClick={() => void connect()}
            >
              {starting ? <Spinner /> : null}
              {t("Connect")}
            </Button>
          )}
          {code ? (
            <GitHubLinkDialog environmentId={environmentId} code={code} onClose={closeDialog} />
          ) : null}
        </>
      }
    />
  );
}

/**
 * Otto: Integrations, under Settings' Customize: your GitHub and the Composio account, then the apps and
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
            <GitHubRow environmentId={environmentId} />
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
