import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@otto/contracts";
import { RiComputerLine } from "@remixicon/react";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { usePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "../ui/drawer";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { Bot } from "./types";

/**
 * The desktop page loads its scripts as its own origin, so it needs allow-same-origin. That is safe
 * only because the link is always another origin than Otto (checked before it renders): the frame
 * cannot reach Otto, and the sandbox still blocks top navigation, popups, forms and downloads.
 */
const DESKTOP_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";

/**
 * Otto: A header action that shows a bot's computer live, for watching it work or signing in for
 * it. Every bot chat has it; it is disabled, saying why, when there is no desktop to watch. Each
 * opening asks the server for a fresh link and keeps it only while the drawer is open.
 */
export function WatchComputerButton({
  botName,
  sandbox,
  threadRef,
}: {
  readonly botName: string;
  readonly sandbox: Bot["sandbox"];
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { t } = useI18n();
  const defaultSandbox = usePrimarySettings((settings) => settings.sandbox.defaultProvider);
  const watch = useAtomCommand(serverEnvironment.watchComputer, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = t("Watch {name}'s computer", { name: botName });
  const computer = sandbox ?? defaultSandbox;

  // Only Boat computers have a desktop to show; a bot on this host has no computer at all.
  const unavailable =
    computer === "local"
      ? t("{name} has no computer to watch", { name: botName })
      : computer !== "boat"
        ? t("{name}'s computer has no desktop to watch", { name: botName })
        : threadRef === null
          ? t("{name} has no computer to watch", { name: botName })
          : null;

  const start = async () => {
    if (threadRef === null) return;
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

  const button = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={unavailable ?? label}
      disabled={unavailable !== null}
      onClick={() => void start()}
    >
      <AppIcon icon={RiComputerLine} />
    </Button>
  );

  return (
    <>
      <Tooltip>
        {/* A disabled button takes no pointer events, so its tooltip hangs on a wrapper. */}
        <TooltipTrigger
          render={
            unavailable === null ? (
              button
            ) : (
              <span className="inline-flex" tabIndex={0}>
                {button}
              </span>
            )
          }
        />
        <TooltipPopup side="bottom">{unavailable ?? label}</TooltipPopup>
      </Tooltip>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next) setUrl(null);
        }}
      >
        <DrawerContent>
          <DrawerTitle className="sr-only">{label}</DrawerTitle>
          <div className="mx-auto w-full max-w-min-80rem-16x9-dvh-15rem">
            <div className="flex aspect-video w-full items-center justify-center bg-muted">
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
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
