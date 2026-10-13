import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTime } from "../../timestampFormat";
import { buildBotChatRows } from "./botChats.logic";
import { listBotChats } from "./botThreadRuntime.logic";
import { useRosterStore } from "./rosterStore";

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
  botId,
  chats,
  chatOpen,
  onOpen,
}: {
  readonly botId: string;
  readonly chats: ReturnType<typeof useBotChats>;
  /** The bot's own chat view is showing, so its open chat is marked. */
  readonly chatOpen: boolean;
  /** Shows the bot's chat view once the chosen chat is set. */
  readonly onOpen: () => void;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const openChatId = useRosterStore((state) => state.openChatByBotId[botId] ?? null);

  const rows = buildBotChatRows({
    chats,
    currentThreadId: chatOpen ? (openChatId ?? chats[0]?.id ?? null) : null,
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

        return (
          <li key={row.threadId} className="list-none">
            <button
              type="button"
              aria-current={row.current || undefined}
              onClick={() => {
                useRosterStore
                  .getState()
                  .openBotChat(
                    botId,
                    row.newest ? null : row.threadId,
                    `/${environmentId}/${row.threadId}`,
                  );
                onOpen();
              }}
              className={cn(
                "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md ps-7.5 pe-2 text-left text-13px outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                row.current
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-foreground/80 hover:text-sidebar-foreground dark:text-sidebar-foreground/68",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{row.title ?? t("Untitled chat")}</span>
              <span className="flex min-w-6 shrink-0 justify-end text-11px tabular-nums text-sidebar-foreground/52">
                {relative?.suffix ? relative.value : t("now")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
