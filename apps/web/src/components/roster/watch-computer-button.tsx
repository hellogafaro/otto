import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@otto/contracts";
import { RiCloseLine, RiComputerLine, RiLoopRightLine } from "@remixicon/react";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { usePrimarySettings } from "~/hooks/use-settings";
import { useI18n } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "../ui/drawer";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Spinner } from "../ui/spinner";
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

  const [view, setView] = useState<
    | { readonly kind: "opening" }
    | { readonly kind: "live"; readonly url: string }
    | { readonly kind: "off" }
    | { readonly kind: "failed"; readonly message: string | null }
  >({ kind: "opening" });

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
    setView({ kind: "opening" });

    const result = await watch({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });

    if (Predicate.isTagged(result, "Success")) {
      return setView(
        new URL(result.value.url).origin === window.location.origin
          ? { kind: "failed", message: null }
          : { kind: "live", url: result.value.url },
      );
    }

    const failure = Predicate.isTagged(result, "Failure") ? squashAtomCommandFailure(result) : null;

    setView(
      Predicate.isTagged(failure, "ComputerNotRunningError")
        ? { kind: "off" }
        : { kind: "failed", message: failure instanceof Error ? failure.message : null },
    );
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

          if (!next) setView({ kind: "opening" });
        }}
      >
        <DrawerContent className="mx-auto w-fit">
          <DrawerHeader className="flex-row items-center justify-between gap-2 pt-1">
            <DrawerTitle className="min-w-0 truncate">{label}</DrawerTitle>
            <DrawerClose
              aria-label={t("Close")}
              className="-me-1.5"
              render={<Button size="icon-sm" variant="ghost-muted" />}
            >
              <RiCloseLine />
            </DrawerClose>
          </DrawerHeader>
          <div className="box-content w-watch-frame p-4">
            {Match.value(view).pipe(
              Match.when({ kind: "live" }, ({ url }) => (
                <iframe
                  allow="clipboard-read; clipboard-write; fullscreen"
                  className="block aspect-video w-full rounded-lg border bg-muted"
                  sandbox={DESKTOP_FRAME_SANDBOX}
                  src={url}
                  title={label}
                />
              )),
              Match.when({ kind: "opening" }, () => (
                <div
                  className="flex aspect-video w-full items-center justify-center gap-2 rounded-lg border bg-muted text-sm text-muted-foreground"
                  role="status"
                >
                  <Spinner aria-hidden className="size-4" />
                  {t("Opening the desktop…")}
                </div>
              )),
              Match.orElse((stopped) => (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <RiComputerLine />
                    </EmptyMedia>
                    <EmptyTitle>
                      {stopped.kind === "off" ? t("No computer") : t("The desktop did not open")}
                    </EmptyTitle>
                    <EmptyDescription>
                      {stopped.kind === "off"
                        ? t("{name}'s computer starts when {name} works in this chat.", {
                            name: botName,
                          })
                        : (stopped.message ?? t("Try again in a moment."))}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={() => void start()}>
                      <RiLoopRightLine />
                      {t("Try again")}
                    </Button>
                  </EmptyContent>
                </Empty>
              )),
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
