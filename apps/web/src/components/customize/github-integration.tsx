import { isAtomCommandInterrupted } from "@otto/client-runtime/state/runtime";
import type { EnvironmentId, GitHubLinkCode } from "@otto/contracts";
import { RiGithubFill } from "@remixicon/react";
import { Match, Predicate } from "effect";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";
import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { CustomizeRow } from "./customize-group";

const GITHUB_AUTHORIZATIONS_URL = "https://github.com/settings/apps/authorizations";

/** Shows the code to enter on GitHub and waits, at GitHub's pace, until the link lands. */
function GitHubLinkDialog({
  environmentId,
  team,
  code,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly team: boolean;
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
      const result = await poll({ environmentId, input: { team } });

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
  }, [code, environmentId, onClose, poll, t, team]);

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

/** One linked GitHub account: who bots act as, where to add repositories, and Disconnect. */
function GitHubAccountDialog({
  login,
  team,
  installUrl,
  onDisconnect,
  onClose,
}: {
  readonly login: string;
  readonly team: boolean;
  readonly installUrl: string;
  readonly onDisconnect: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("GitHub")}</DialogTitle>
          <DialogDescription>
            {team
              ? t("Bots act as @{login} for anyone who hasn't connected their own GitHub.", {
                  login,
                })
              : t("Bots push and open pull requests as @{login}.", { login })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDisconnect}>
            {t("Disconnect")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void ensureLocalApi()
                .shell.openExternal(installUrl)
                .catch(() => toast.error(t("GitHub couldn't be opened")))
            }
          >
            {t("Add repositories")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Otto: GitHub as an integration in Yours or Team. A person's own link makes bots push and open
 * pull requests as them; the team's link is lent to anyone without their own. `connect` starts
 * the device-code link, `row` is the group's GitHub row once linked, and `dialogs` holds the
 * link and account dialogs.
 */
export function useGitHubIntegration(environmentId: EnvironmentId) {
  const { t } = useI18n();
  const status = useEnvironmentQuery(serverEnvironment.githubStatus({ environmentId, input: {} }));
  const start = useAtomCommand(serverEnvironment.startGitHubLink, { reportFailure: false });
  const disconnect = useAtomCommand(serverEnvironment.disconnectGitHub, { reportFailure: false });
  const [linking, setLinking] = useState<{ code: GitHubLinkCode; team: boolean } | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const refreshStatus = status.refresh;

  const loginFor = (team: boolean) => (team ? status.data?.teamLogin : status.data?.login) ?? null;

  const connect = async (team: boolean) => {
    const result = await start({ environmentId, input: { team } });

    if (Predicate.isTagged(result, "Failure")) {
      if (!isAtomCommandInterrupted(result)) toast.error(t("GitHub couldn't be connected"));

      return;
    }

    setLinking({ code: result.value, team });
  };

  const remove = async (team: boolean) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      team
        ? t(
            "Disconnect the team's GitHub? Bots can no longer push or open pull requests for people without their own.",
          )
        : t(
            "Disconnect GitHub? Bots can no longer push or open pull requests for you. To revoke Otto on GitHub too, visit {url}.",
            { url: GITHUB_AUTHORIZATIONS_URL },
          ),
      { variant: "destructive" },
    );

    if (!confirmed) return;
    setOpen(null);
    const result = await disconnect({ environmentId, input: { team } });

    if (Predicate.isTagged(result, "Failure") && !isAtomCommandInterrupted(result)) {
      toast.error(t("GitHub couldn't be disconnected"));

      return;
    }

    refreshStatus();
  };

  const closeLink = useCallback(
    (connected: boolean) => {
      setLinking(null);

      if (connected) refreshStatus();
    },
    [refreshStatus],
  );

  const row = (team: boolean) => {
    const login = loginFor(team);

    return login ? (
      <CustomizeRow
        key="github"
        logo={<RiGithubFill aria-hidden className="size-4" />}
        name={t("GitHub")}
        detail={`@${login}`}
        status={<Badge variant="success">{t("Connected")}</Badge>}
        onOpen={() => setOpen(team)}
      />
    ) : null;
  };

  const openLogin = open === null ? null : loginFor(open);

  const dialogs = (
    <>
      {linking ? (
        <GitHubLinkDialog
          environmentId={environmentId}
          team={linking.team}
          code={linking.code}
          onClose={closeLink}
        />
      ) : null}
      {open !== null && openLogin && status.data ? (
        <GitHubAccountDialog
          login={openLogin}
          team={open}
          installUrl={status.data.installUrl}
          onDisconnect={() => void remove(open)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );

  return { loaded: status.data !== undefined, linked: loginFor, connect, row, dialogs };
}
