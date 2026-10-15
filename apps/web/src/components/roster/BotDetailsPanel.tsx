import { RiCloseLine, RiComputerLine, RiListCheck, RiSettings3Line } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@otto/contracts";

import { useEffect, useState, type ReactNode } from "react";

import { openComputerViewer } from "../../computerViewerStore";
import { useI18n } from "../../i18n";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { usePrimarySettings } from "../../hooks/useSettings";
import { primaryServerKeybindingsAtom, primaryServerProvidersAtom } from "../../state/server";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Sheet, SheetClose, SheetPopup, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { BotAvatarView } from "./BotAvatarView";
import { BotBrowserPreview } from "./BotBrowserPreview";
import { resolveBotModelLabel } from "./botModelLabel";
import { botPersonalityToneLabel, canonicalizeBotPersonalityTone } from "./botPersonalityTone";
import { botSandboxChoice, botSandboxLabel } from "./botSandbox";
import type { Bot } from "./types";
import { DetailsTabs } from "../DetailsAside";
import {
  ChatLibraryPanel,
  type ChatSidebarTab,
  useChatSidebarTabs,
} from "../library/ChatLibraryPanel";
import { useDetailsPanelState } from "./useDetailsPanelState";
import { useBotDetailsOpen } from "./detailsPanelOpen";

export { type BotProfileUpdate } from "./useBotProfileDraft";

export function BotOverview({
  bot,
  onOpenSettings,
  onOpenComputer,
}: {
  readonly bot: Bot;
  readonly onOpenSettings?: () => void;
  /** Opens the live computer viewer. Omitted until the bot has a chat to attach it to. */
  readonly onOpenComputer?: () => void;
}) {
  const { t } = useI18n();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const settings = usePrimarySettings();
  const modelLabel = resolveBotModelLabel(bot.engine, settings, providers, t);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
      <div className="flex flex-col items-start">
        <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-16" />
        <h3 className="mt-3 text-base font-semibold">{bot.name}</h3>
        {bot.label ? <p className="mt-0.5 text-sm text-muted-foreground">{bot.label}</p> : null}
        {bot.description ? (
          <p className="mt-3 line-clamp-3 max-w-64 text-sm leading-relaxed text-muted-foreground">
            {bot.description}
          </p>
        ) : null}
      </div>

      <Button
        className="mt-6 w-full justify-center"
        variant="outline"
        disabled={!onOpenSettings}
        onClick={onOpenSettings}
      >
        <AppIcon className="size-4" icon={RiSettings3Line} />
        {t("Open bot settings")}
      </Button>
      {onOpenComputer ? (
        <Button
          className="mt-2 w-full justify-center"
          variant="outline"
          onClick={onOpenComputer}
          data-bot-open-computer=""
        >
          <AppIcon className="size-4" icon={RiComputerLine} />
          {t("Open computer")}
        </Button>
      ) : null}

      <dl className="mt-6 divide-y divide-border/70 border-y border-border/70 text-sm">
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-muted-foreground">{t("Personality")}</dt>
          <dd className="font-medium">
            {botPersonalityToneLabel(canonicalizeBotPersonalityTone(bot.personalityTone), t)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-muted-foreground">{t("Model")}</dt>
          <dd className="max-w-44 truncate font-medium">{modelLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-muted-foreground">{t("Sandbox")}</dt>
          <dd className="font-medium">{botSandboxLabel(botSandboxChoice(bot.sandbox), t)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function BotDetailsPanel({
  bot,
  onOpenSettings,
  threadRef = null,
}: {
  readonly bot: Bot;
  /** Opens the full bot settings page. Omitted when no router is available. */
  readonly onOpenSettings?: () => void;
  readonly threadRef?: ScopedThreadRef | null;
}) {
  const { t } = useI18n();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [desktopOpen, setDesktopOpen] = useBotDetailsOpen(bot.id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [tab, setTab] = useState<ChatSidebarTab>("details");
  const tabs = useChatSidebarTabs();
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

  const content = (active: boolean, closeButton?: ReactNode, canExpandBrowser = false) => (
    <>
      {!browserExpanded || !canExpandBrowser ? (
        <header className="relative flex h-(--workspace-topbar-height) shrink-0 items-center ps-3 pe-12">
          <DetailsTabs
            label={t("{name} bot sidebar", { name: bot.name })}
            tabs={tabs}
            value={tab}
            onValueChange={setTab}
          />
          <div className="absolute right-3 flex items-center min-[981px]:fixed min-[981px]:right-(--workspace-controls-right) min-[981px]:top-(--workspace-controls-top) min-[981px]:z-40 min-[981px]:h-(--workspace-topbar-height)">
            {closeButton}
          </div>
        </header>
      ) : null}
      {tab === "library" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatLibraryPanel threadId={threadRef?.threadId ?? null} />
        </div>
      ) : null}
      {tab === "details" ? (
        <BotBrowserPreview
          botName={bot.name}
          threadRef={threadRef}
          expanded={canExpandBrowser && browserExpanded}
          visible={active}
          onExpandedChange={setBrowserExpanded}
          trailingAction={browserExpanded && canExpandBrowser ? closeButton : undefined}
        />
      ) : null}
      {tab === "details" && (!browserExpanded || !canExpandBrowser) ? (
        <>
          <BotOverview
            bot={bot}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            {...(threadRef
              ? {
                  onOpenComputer: () =>
                    openComputerViewer({
                      threadRef,
                      botName: bot.name,
                      sandbox: bot.sandbox,
                      engine: bot.engine,
                    }),
                }
              : {})}
          />
        </>
      ) : null}
    </>
  );

  return (
    <>
      <aside
        aria-hidden={!desktopOpen}
        aria-label={t("{name} bot sidebar", { name: bot.name })}
        data-testid="bot-details-panel"
        data-details-panel=""
        data-state={desktopPanel.state}
        onTransitionEnd={desktopPanel.onTransitionEnd}
        className={cn(
          "hidden h-full shrink-0 flex-col items-end overflow-hidden border-l border-border bg-background min-[981px]:flex",
          browserExpanded ? "details-width-wide" : "details-width",
        )}
      >
        <div data-details-column="" className="flex min-h-0 flex-1 flex-col">
          {content(
            desktopPanel.state === "open",
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-expanded="true"
                    aria-label={t("Collapse {name} bot sidebar", { name: bot.name })}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDesktopOpen(false)}
                  >
                    <AppIcon icon={RiCloseLine} />
                  </Button>
                }
              />
              <TooltipPopup side="left">
                {shortcutLabel
                  ? t("Collapse ({shortcut})", { shortcut: shortcutLabel })
                  : t("Collapse")}
              </TooltipPopup>
            </Tooltip>,
            true,
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-expanded="false"
                  aria-label={t("Open {name} bot sidebar", { name: bot.name })}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setDesktopOpen(true)}
                >
                  <AppIcon icon={RiListCheck} />
                </Button>
              }
            />
            <TooltipPopup side="left">
              {shortcutLabel
                ? t("Open sidebar ({shortcut})", { shortcut: shortcutLabel })
                : t("Open sidebar")}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      <div className="fixed right-(--workspace-controls-right) top-(--workspace-controls-top) z-40 flex h-(--workspace-topbar-height) items-center min-[981px]:hidden">
        <Button
          aria-label={t("Open {name} bot sidebar", { name: bot.name })}
          size="icon-sm"
          variant="ghost"
          onClick={() => setMobileOpen(true)}
        >
          <AppIcon icon={RiListCheck} />
        </Button>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetPopup
          flush
          className="w-(--spacing-min-92vw-24rem)"
          showCloseButton={false}
          side="right"
        >
          <SheetTitle className="sr-only">{t("{name} overview", { name: bot.name })}</SheetTitle>
          {content(
            mobileOpen,
            <SheetClose
              aria-label={t("Close bot sidebar")}
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <AppIcon icon={RiCloseLine} />
            </SheetClose>,
            false,
          )}
        </SheetPopup>
      </Sheet>
    </>
  );
}
