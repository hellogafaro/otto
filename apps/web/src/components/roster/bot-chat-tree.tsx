import { RiArchiveLine, RiDeleteBinLine, RiPushpinLine, RiRadioButtonLine } from "@remixicon/react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useRef } from "react";

import { useChatActions } from "../../hooks/use-chat-actions";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTime } from "../../timestamp-format";
import { buildBotChatRows } from "./bot-chats.logic";
import { ThreadStatusIcon } from "./chat-status-icon";
import { listBotChats } from "./bot-thread-runtime.logic";
import {
  ROSTER_TIME_CLASS,
  ROSTER_TRAIL_ACTIONS_CLASS,
  ROSTER_TRAIL_CLASS,
  ROSTER_TRAIL_INFO_CLASS,
} from "./roster-row-classes";
import { RosterRowAction, RosterRowMore } from "./roster-row-actions";
import { useRosterStore } from "./roster-store";

/** The bot's chats, newest first; the roster lists them once there are two. */
export function useBotChats(botId: string) {
  const environmentId = usePrimaryEnvironmentId();
  const shells = useThreadShells();

  return useMemo(
    () => (environmentId ? listBotChats(botId, environmentId, shells) : []),
    [botId, environmentId, shells],
  );
}

/**
 * Otto: A bot's chats nested under its roster row, like Capy's captain
 * threads. Rows are full-width 28px rows 2px apart with their text on the bot
 * name's edge, in the roster's name and time styles; the open chat is at full
 * strength on the active fill. A 1px guide line drops from the 16px avatar's
 * center and is drawn above the row fills, so it never breaks.
 */
export function BotChatTree({
  chats,
  openThreadId,
  pinnedIds,
  botPinned,
}: {
  readonly chats: ReturnType<typeof useBotChats>;
  /** This bot's chat on screen, if one is, marked in the list. */
  readonly openThreadId: string | null;
  /** This bot's chats pinned to Pins, which list there instead. */
  readonly pinnedIds: ReadonlySet<string>;
  /** The whole bot is in Pins, so its chats are already there and offer no Pin. */
  readonly botPinned: boolean;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const actions = useChatActions();
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>());

  const rows = buildBotChatRows({
    chats,
    currentThreadId: openThreadId,
    pinnedIds,
  });

  return (
    <ul
      aria-label={t("Chats")}
      className="relative mt-0.5 flex flex-col gap-0.5"
      data-bot-chat-tree=""
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3.5 z-10 w-px bg-sidebar-border"
      />
      {rows.map((row) => {
        const relative = formatRelativeTime(row.updatedAt);

        const time = (
          <span className={ROSTER_TIME_CLASS}>{relative?.suffix ? relative.value : t("now")}</span>
        );

        const shell = chats.find((chat) => chat.id === row.threadId);
        const title = row.title ?? t("Untitled chat");
        const threadRef = environmentId && shell ? scopeThreadRef(environmentId, shell.id) : null;

        return (
          <li
            key={row.threadId}
            onContextMenu={(event) => {
              const trigger = menuTriggers.current.get(row.threadId);

              if (!trigger) return;
              event.preventDefault();
              trigger.click();
            }}
            className={cn(
              "group/row relative list-none rounded-md",
              row.current ? "sidebar-row-current" : "sidebar-row-plain hover:sidebar-row-hovered",
            )}
          >
            <button
              type="button"
              aria-current={row.current || undefined}
              onClick={() =>
                void navigate({ to: "/chats/$threadId", params: { threadId: row.threadId } })
              }
              className={cn(
                "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md ps-7.5 pe-2 text-left text-13px outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                row.current
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/80 group-hover/row:text-sidebar-foreground dark:text-sidebar-foreground/68",
              )}
            >
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">{title}</span>
            </button>
            <span className={ROSTER_TRAIL_CLASS}>
              <span className={ROSTER_TRAIL_INFO_CLASS}>
                {environmentId && shell ? (
                  <ThreadStatusIcon
                    environmentId={environmentId}
                    shell={shell}
                    current={row.current}
                    fallback={time}
                  />
                ) : (
                  time
                )}
              </span>
              {threadRef ? (
                <span className={ROSTER_TRAIL_ACTIONS_CLASS}>
                  {botPinned ? null : (
                    <RosterRowAction
                      label={t("Pin")}
                      icon={RiPushpinLine}
                      onClick={() =>
                        useRosterStore
                          .getState()
                          .setItemPinned({ kind: "chat", id: row.threadId }, true)
                      }
                    />
                  )}
                  <RosterRowAction
                    label={t("Archive")}
                    icon={RiArchiveLine}
                    onClick={() => void actions.archive(threadRef)}
                  />
                  <RosterRowMore
                    label={t("Actions for {name}", { name: title })}
                    triggerRef={(node) => {
                      if (node) menuTriggers.current.set(row.threadId, node);
                      else menuTriggers.current.delete(row.threadId);
                    }}
                  >
                    <MenuItem onClick={() => actions.markUnread(threadRef)}>
                      <RiRadioButtonLine />
                      {t("Mark unread")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem variant="destructive" onClick={() => void actions.delete(threadRef)}>
                      <RiDeleteBinLine />
                      {t("Delete chat")}
                    </MenuItem>
                  </RosterRowMore>
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
