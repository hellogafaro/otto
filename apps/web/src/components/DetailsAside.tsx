import { RiArrowDownSLine, RiCloseLine, RiListCheck } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";

import * as Schema from "effect/Schema";
import { useEffect, useId, useState, type ReactNode } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
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
  labels,
  testId,
  tabs,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (update: (open: boolean) => boolean) => void;
  readonly labels: {
    readonly sidebar: string;
    readonly open: string;
    readonly collapse: string;
    readonly close: string;
    readonly sheetTitle: string;
  };
  readonly testId?: string;
  /** More tabs than Details; the caller renders the chosen tab's content as children. */
  readonly tabs?: {
    readonly items: ReadonlyArray<DetailsTab<string>>;
    readonly value: string;
    readonly onValueChange: (value: string) => void;
  };
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
      <header className="relative flex h-(--workspace-topbar-height) shrink-0 items-center ps-3 pe-12">
        {tabs ? (
          <DetailsTabs
            label={labels.sidebar}
            tabs={tabs.items}
            value={tabs.value}
            onValueChange={tabs.onValueChange}
          />
        ) : (
          <DetailsTabs label={labels.sidebar} />
        )}
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

export interface DetailsTab<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: typeof RiListCheck;
}

/**
 * Otto: The tabs heading every right sidebar, in place of a title: 28px tabs
 * with a 14px icon and the back button's 13px/500 label, the active one on the
 * secondary fill. Details is always the first tab; a chat adds its Library.
 * Pages reuse the same tabs to filter what they show; a tab row that sits on the page rather
 * than inside a panel uses the 32px `page` size.
 */
export function DetailsTabs<T extends string>({
  label,
  tabs,
  value,
  onValueChange,
  size = "default",
}: {
  readonly label: string;
  readonly size?: "default" | "page";
  readonly tabs?: ReadonlyArray<DetailsTab<T>>;
  readonly value?: T;
  readonly onValueChange?: (value: T) => void;
}) {
  const { t } = useI18n();

  const shown: ReadonlyArray<DetailsTab<string>> = tabs ?? [
    { value: "details", label: t("Details"), icon: RiListCheck },
  ];

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex min-w-0 items-center", size === "page" ? "gap-1" : "gap-0.5")}
    >
      {shown.map((tab) => {
        const selected = tabs === undefined || tab.value === value;
        const Icon = tab.icon;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              const chosen = tabs?.find((candidate) => candidate.value === tab.value);

              if (chosen) onValueChange?.(chosen.value);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md text-13px font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "page" ? "h-8 px-2.5" : "h-7 px-2",
              selected
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Otto: A collapsible group in a details sidebar, headed like the left
 * sidebar's sections (28px row, 12px/500 at 52%) with a chevron; its open
 * state is remembered per group id.
 */
export function DetailsGroup({
  id,
  label,
  summary,
  action,
  children,
}: {
  readonly id: string;
  readonly label: string;
  /** A muted figure beside the label, like a table group's count: a total, a tally. */
  readonly summary?: string | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useLocalStorage(`otto:details-group:${id}`, true, Schema.Boolean);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <div className="flex h-7 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs font-medium text-foreground/52 outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span id={headingId} className="truncate">
            {label}
          </span>
          {summary ? (
            <span className="shrink-0 font-normal tabular-nums text-foreground/40">{summary}</span>
          ) : null}
          <RiArrowDownSLine
            aria-hidden
            className={cn("size-3 shrink-0 transition-transform", !open && "-rotate-90")}
          />
        </button>
        {action}
      </div>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </section>
  );
}

/** One row in a details group: a muted label on the left and its value or quiet control on the right. */
export function DetailsRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <span className="w-24 shrink-0 truncate text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}
