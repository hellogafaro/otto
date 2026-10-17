import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@otto/contracts";
import { RiComputerLine, RiExternalLinkLine } from "@remixicon/react";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The desktop page loads its scripts as its own origin, so it needs allow-same-origin. That is safe
 * only because the link is always another origin than Otto (checked before it renders): the frame
 * cannot reach Otto, and the sandbox still blocks top navigation, popups, forms and downloads.
 */
const DESKTOP_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";

/**
 * Otto: A header action that shows a bot's computer live, for watching it work or signing in for
 * it. Each opening asks the server for a fresh link and keeps it only while the dialog is open.
 */
export function WatchComputerButton({
  botName,
  threadRef,
}: {
  readonly botName: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const { t } = useI18n();
  const watch = useAtomCommand(serverEnvironment.watchComputer, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = t("Watch {name}'s computer", { name: botName });

  const start = async () => {
    setOpen(true);
    setUrl(null);
    setError(null);

    const result = await watch({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });

    if (Predicate.isTagged(result, "Success")) {
      return new URL(result.value.url).origin === window.location.origin
        ? setError(t("The desktop did not open."))
        : setUrl(result.value.url);
    }

    const failure = Predicate.isTagged(result, "Failure") ? squashAtomCommandFailure(result) : null;
    setError(failure instanceof Error ? failure.message : t("The desktop did not open."));
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label}
              onClick={() => void start()}
            />
          }
        >
          <AppIcon icon={RiComputerLine} />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next) setUrl(null);
        }}
      >
        <DialogPopup className="max-w-5xl" bottomStickOnMobile={false}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {t("You can click and type here. Sign in if asked, then tell {name} you're done.", {
                name: botName,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 px-5 pb-5">
            <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {url ? (
                <iframe
                  allow="clipboard-read; clipboard-write; fullscreen"
                  className="size-full"
                  sandbox={DESKTOP_FRAME_SANDBOX}
                  src={url}
                  title={label}
                />
              ) : (
                <p className="px-6 text-center text-sm text-muted-foreground" role="status">
                  {error ?? t("Opening the desktop…")}
                </p>
              )}
            </div>
            {url ? (
              <Button
                className="self-end"
                render={<a href={url} rel="noreferrer" target="_blank" />}
                size="compact"
                variant="ghost-muted"
              >
                <RiExternalLinkLine />
                {t("Open in a new window")}
              </Button>
            ) : null}
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}
