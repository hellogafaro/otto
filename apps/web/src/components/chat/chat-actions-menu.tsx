import { RiMoreLine, RiAlarmLine, RiPushpinLine } from "@remixicon/react";
import { scopedThreadKey } from "@otto/client-runtime/environment";
import { resolveSnoozePresets } from "@otto/client-runtime/state/thread-snoozed";
import type { ScopedThreadRef } from "@otto/contracts";

import { useCallback, useMemo, useRef, useState } from "react";
import { useChatActions } from "../../hooks/use-chat-actions";
import { useNowMinute } from "../../hooks/use-now-minute";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import {
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsSnooze,
  readEnvironmentSupportsTitleRegeneration,
  useThreadShell,
} from "../../state/entities";
import { useUiStateStore } from "../../ui-state-store";
import { CopyMenuItems, useCopyPageActions } from "../copy-menu-items";
import { PageActionMenuItem } from "../page-action-menu-item";
import { ShortcutKbd } from "../shortcut-kbd";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveChatMenuState } from "./chat-actions.logic";
import {
  buildChatPaletteActions,
  type NewChatControl,
  snoozePresetLabel,
} from "./chat-palette-actions";

/**
 * The open chat's state and its menu in the chat header: rename, regenerate the title, pin, mark
 * unread, snooze, copy link and ID, archive, and delete. The same entries are the palette's This
 * chat group and answer the item shortcuts (R, P, U, H, E, ⌘⌫ …) while the chat is open.
 */
export function ChatActionsMenu({
  threadRef,
  newChat = null,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly newChat?: NewChatControl | null;
}) {
  const { t, formatDate } = useI18n();
  const actions = useChatActions();
  const shell = useThreadShell(threadRef);
  // Minute-quantized UTC, so the menu re-reads snooze state once a minute.
  const nowMinute = useNowMinute();
  const now = `${nowMinute}:00.000Z`;

  const lastVisitedAt = useUiStateStore((state) =>
    threadRef ? state.threadLastVisitedAtById[scopedThreadKey(threadRef)] : undefined,
  );

  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [snoozing, setSnoozing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const state = useMemo(
    () =>
      threadRef && shell
        ? resolveChatMenuState({
            shell,
            lastVisitedAt,
            now,
            supports: {
              snooze: readEnvironmentSupportsSnooze(threadRef.environmentId),
              pinning: readEnvironmentSupportsPinning(threadRef.environmentId),
              titleRegeneration: readEnvironmentSupportsTitleRegeneration(threadRef.environmentId),
            },
          })
        : null,
    [lastVisitedAt, now, shell, threadRef],
  );

  const openRename = useCallback(() => {
    if (!shell) return;
    setDraftTitle(shell.title);
    setRenaming(true);
  }, [shell]);

  const openSnooze = useCallback(() => setSnoozing(true), []);
  const threadId = threadRef?.threadId ?? "";
  const copy = useCopyPageActions(`/chats/${threadId}`, threadId);

  const pageActions = useMemo(
    () =>
      buildChatPaletteActions({
        threadRef,
        state,
        newChat,
        actions,
        t,
        openRename,
        openSnooze,
        copy: threadRef ? copy : null,
      }),
    [actions, copy, newChat, openRename, openSnooze, state, t, threadRef],
  );

  usePageActions(t("This chat"), pageActions);

  // A bot with no chat yet has nothing to act on; its first message starts one.
  if (!threadRef || !shell || !state) return null;

  const action = (id: string): PageAction | undefined =>
    pageActions.find((entry) => entry.id === id);

  const row = (id: string, variant?: "destructive") => {
    const entry = action(id);

    return entry ? <PageActionMenuItem action={entry} {...(variant ? { variant } : {})} /> : null;
  };

  const snoozePresets = resolveSnoozePresets(new Date());

  const snoozeItems = snoozePresets.map((preset) => (
    <MenuItem key={preset.id} onClick={() => void actions.snooze(threadRef, preset.snoozedUntil)}>
      <span className="flex-1">{snoozePresetLabel(preset.id, t)}</span>
      <span className="text-xs text-muted-foreground">{preset.whenLabel}</span>
    </MenuItem>
  ));

  const snoozedUntilLabel = state.snoozedUntil
    ? formatDate(new Date(state.snoozedUntil), {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      {state.isPinned ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={t("Pinned")}
                className="flex size-7 items-center justify-center text-muted-foreground"
              />
            }
          >
            <RiPushpinLine className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{t("Pinned")}</TooltipPopup>
        </Tooltip>
      ) : null}
      {snoozedUntilLabel ? (
        <span
          data-testid="chat-state-snoozed"
          className="me-1 rounded-md border border-border px-1.5 py-px text-xs text-muted-foreground"
        >
          {t("Snoozed until {time}", { time: snoozedUntilLabel })}
        </span>
      ) : null}
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    ref={triggerRef}
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Chat actions")}
                    data-testid="chat-actions-trigger"
                  />
                }
              />
            }
          >
            <AppIcon icon={RiMoreLine} />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{t("Chat actions")}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" data-testid="chat-actions-menu">
          {row("rename")}
          {row("regenerate-title")}
          <MenuSeparator />
          {row("pin")}
          {row("unpin")}
          {row("mark-unread")}
          {row("unsnooze")}
          {action("snooze") ? (
            <MenuSub>
              <MenuSubTrigger disabled={!state.canSnooze}>
                <RiAlarmLine />
                {t("Snooze")}
                <ShortcutKbd command="item.snooze" className="ms-auto" />
              </MenuSubTrigger>
              <MenuSubPopup>{snoozeItems}</MenuSubPopup>
            </MenuSub>
          ) : null}
          <MenuSeparator />
          <CopyMenuItems actions={copy} />
          <MenuSeparator />
          {row("archive")}
          <MenuSeparator />
          {row("delete", "destructive")}
        </MenuPopup>
      </Menu>
      {/* Otto: The snooze key opens the presets beside More actions, as if picked from it. */}
      <Menu open={snoozing} onOpenChange={setSnoozing}>
        <MenuPopup align="end" anchor={triggerRef} data-testid="chat-snooze-menu">
          {snoozeItems}
        </MenuPopup>
      </Menu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const title = draftTitle.trim();

              if (!title) return;
              setRenaming(false);

              if (title !== shell.title) void actions.rename(threadRef, title);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Rename chat")}</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <Input
                autoFocus
                aria-label={t("Chat title")}
                maxLength={200}
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={draftTitle.trim().length === 0}>
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export { buildChatPaletteActions, type NewChatControl } from "./chat-palette-actions";

export { useMarkChatVisited } from "./use-mark-chat-visited";
