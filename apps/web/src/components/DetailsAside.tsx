import { RiCloseLine, RiListCheck } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";

import { useEffect, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { primaryServerKeybindingsAtom } from "../state/server";
import { AppIcon } from "./ui/app-icon";
import { Button } from "./ui/button";
import { Sheet, SheetClose, SheetPopup, SheetTitle } from "./ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useDetailsPanelState } from "./roster/useDetailsPanelState";

/**
 * Otto: The right details sidebar shared by chats and work pages. On desktop it
 * docks beside the main card with a full-height divider and toggles from a
 * RiListCheck button in the top bar's right corner; below the inline
 * breakpoint it opens as a sheet. The page header passes the same `open` as
 * `detailsPanelOpen` so its actions stay clear of the floating toggle.
 */
export function DetailsAside({
  open: desktopOpen,
  onOpenChange,
  title,
  labels,
  testId,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (update: (open: boolean) => boolean) => void;
  /** Centered in the sidebar's own 44px top bar. */
  readonly title: string;
  readonly labels: {
    readonly sidebar: string;
    readonly open: string;
    readonly collapse: string;
    readonly close: string;
    readonly sheetTitle: string;
  };
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const setDesktopOpen = onOpenChange;
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopPanel = useDetailsPanelState(desktopOpen);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "rightPanel.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;

      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }

      if (resolveShortcutCommand(event, keybindings) !== "rightPanel.toggle") return;
      event.preventDefault();
      event.stopPropagation();

      if (window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches) {
        setMobileOpen((open) => !open);
      } else {
        setDesktopOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, setDesktopOpen]);

  const content = (closeButton?: ReactNode) => (
    <>
      <header className="relative flex h-(--workspace-topbar-height) shrink-0 items-center justify-center px-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="absolute right-3 flex items-center min-[981px]:fixed min-[981px]:right-(--workspace-controls-right) min-[981px]:top-(--workspace-controls-top) min-[981px]:z-40 min-[981px]:h-(--workspace-topbar-height)">
          {closeButton}
        </div>
      </header>
      {children}
    </>
  );

  return (
    <>
      <aside
        aria-hidden={!desktopOpen}
        aria-label={labels.sidebar}
        data-testid={testId}
        data-details-panel=""
        data-state={desktopPanel.state}
        onTransitionEnd={desktopPanel.onTransitionEnd}
        className="hidden h-full shrink-0 flex-col items-end overflow-hidden border-l border-border bg-background details-width min-[981px]:flex"
      >
        <div data-details-column="" className="flex min-h-0 flex-1 flex-col">
          {content(
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-expanded="true"
                    aria-label={labels.collapse}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDesktopOpen((open) => !open)}
                  >
                    <AppIcon icon={RiListCheck} />
                  </Button>
                }
              />
              <TooltipPopup side="left">
                {shortcutLabel
                  ? t("Collapse ({shortcut})", { shortcut: shortcutLabel })
                  : t("Collapse")}
              </TooltipPopup>
            </Tooltip>,
          )}
        </div>
      </aside>
      {!desktopOpen ? (
        <div
          className={cn(
            "fixed right-(--workspace-controls-right) top-(--workspace-controls-top) z-40 hidden h-(--workspace-topbar-height) items-center min-[981px]:flex",
            desktopPanel.toggled && "motion-fade-in",
          )}
        >
          <Button
            aria-label={labels.open}
            size="icon-sm"
            variant="ghost"
            onClick={() => setDesktopOpen((open) => !open)}
          >
            <AppIcon icon={RiListCheck} />
          </Button>
        </div>
      ) : null}
      <div className="fixed right-(--workspace-controls-right) top-(--workspace-controls-top) z-40 flex h-(--workspace-topbar-height) items-center min-[981px]:hidden">
        <Button
          aria-label={labels.open}
          size="icon-sm"
          variant="ghost"
          onClick={() => setMobileOpen(true)}
        >
          <AppIcon icon={RiListCheck} />
        </Button>
      </div>
      <Sheet open={mobileOpen} onOpenChange={(open) => setMobileOpen(open)}>
        <SheetPopup
          flush
          className="w-(--spacing-min-92vw-24rem)"
          showCloseButton={false}
          side="right"
        >
          <SheetTitle className="sr-only">{labels.sheetTitle}</SheetTitle>
          {content(
            <SheetClose
              aria-label={labels.close}
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <AppIcon icon={RiCloseLine} />
            </SheetClose>,
          )}
        </SheetPopup>
      </Sheet>
    </>
  );
}
