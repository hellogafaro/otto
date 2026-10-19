import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiRadioButtonLine,
  RiPushpinLine,
  RiSettings3Line,
  RiUnpinLine,
} from "@remixicon/react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import { PLACEHOLDER_THREAD_TITLE, type ScopedThreadRef } from "@otto/contracts";

import { useNavigate } from "@tanstack/react-router";
import { memo, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useLatestGroupThreadId, useThreadMessages } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTime } from "../../timestamp-format";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarGroup } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotChatTree, useBotChats } from "./bot-chat-tree";
import { BotAvatarView } from "./bot-avatar-view";
import { visibleBotChatMessages } from "./bot-conversation-presentation";
import { useBotPresence, useGroupPresence } from "./bot-presence";
import { useBotRosterUnread, useChatUnread } from "../chat/use-chat-unread";
import { ChatStatusIcon, ThreadStatusIcon } from "./chat-status-icon";
import { useChatActions } from "../../hooks/use-chat-actions";
import { RosterRowAction, RosterRowMore } from "./roster-row-actions";
import { GroupMemberStack } from "./group-member-stack";
import {
  resolveLatestRosterMessage,
  resolveRosterIndicator,
  rosterItemKey,
  type RosterItemRef,
  type RosterLastMessage,
  type RosterPresence,
} from "./roster.logic";
import { useRosterStore } from "./roster-store";
import type { Bot, Group } from "./types";
import { useLatestBotChatRef } from "./use-bot-thread-ref";
import {
  ROSTER_NAME_CLASS,
  ROSTER_REVEAL_CLASS,
  ROSTER_TIME_CLASS,
  ROSTER_TRAIL_ACTIONS_CLASS,
  ROSTER_ROW_FOCUS_CLASS,
  ROSTER_TRAIL_CLASS,
  ROSTER_TRAIL_INFO_CLASS,
} from "./roster-row-classes";

/** Avatar with a warning needs-you light and an accent working light. */
function RosterAvatar({
  bot,
  presence,
  className,
  dotClassName,
}: {
  bot: Bot;
  presence: RosterPresence;
  className: string;
  dotClassName?: string;
}) {
  const indicator = resolveRosterIndicator(presence);

  return (
    <span className="relative flex shrink-0">
      <BotAvatarView avatar={bot.avatar} name={bot.name} state={presence} className={className} />
      {indicator !== null ? (
        <span
          data-testid="bot-presence-dot"
          data-status={indicator}
          className={cn(
            "absolute -bottom-px -right-px rounded-full ring-1 ring-sidebar",
            indicator === "working" ? "bg-primary" : "bg-warning",
            dotClassName ?? "size-2",
          )}
        />
      ) : null}
    </span>
  );
}

function useLatestBotMessage(
  botId: string,
  fallback: RosterLastMessage | null,
): {
  message: RosterLastMessage | null;
  threadRef: ScopedThreadRef | null;
} {
  const threadRef = useLatestBotChatRef(botId);
  const messages = useThreadMessages(threadRef);
  const visibleMessages = useMemo(() => visibleBotChatMessages(messages), [messages]);

  const message = useMemo(
    () => resolveLatestRosterMessage(fallback, visibleMessages, threadRef?.threadId),
    [fallback, visibleMessages, threadRef?.threadId],
  );

  return useMemo(() => ({ message, threadRef }), [message, threadRef]);
}

const rosterFullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Unabbreviated date for the roster row's compact timestamp tooltip. */
function formatRosterFullTimestamp(isoDate: string): string {
  const parsed = new Date(isoDate);

  return Number.isNaN(parsed.getTime()) ? "" : rosterFullTimestampFormatter.format(parsed);
}

/** The group's current chat: its newest chat on the primary environment. */
function useGroupChatRef(groupId: string): ScopedThreadRef | null {
  const environmentId = usePrimaryEnvironmentId();
  const threadId = useLatestGroupThreadId(environmentId, groupId);

  return useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
}

/** The collapsed rail's unread mark; expanded rows show a status icon instead. */
function UnreadDot() {
  const { t } = useI18n();

  return (
    <span
      role="img"
      aria-label={t("Unread")}
      data-testid="roster-unread-dot"
      className="size-2 shrink-0 rounded-full bg-sidebar-foreground"
    />
  );
}

function shortRelativeTime(isoDate: string, t: ReturnType<typeof useI18n>["t"]): string {
  const relative = formatRelativeTime(isoDate);

  return relative?.suffix ? relative.value : t("now");
}

export const BotRosterRow = memo(function BotRosterRow({
  bot,
  lastMessage,
  openThreadId,
  onOpenSettings,
  pinned,
  onArchive,
  shortcutLabel,
}: {
  bot: Bot;
  lastMessage: RosterLastMessage | null;
  /** This bot's chat on screen, if one is: it marks the row and counts as seen. */
  openThreadId: string | null;
  onOpenSettings: (bot: Bot) => void;
  pinned: boolean;
  onArchive: (bot: Bot) => void;
  /** Its jump shortcut while the command modifier is held, in place of the status and time. */
  shortcutLabel: string | null;
}) {
  const { t } = useI18n();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const presence = useBotPresence(bot.id);

  const { message: latestMessage, threadRef: chatRef } = useLatestBotMessage(bot.id, lastMessage);

  const unread = useBotRosterUnread(bot.id, chatRef, openThreadId === chatRef?.threadId);
  const chats = useBotChats(bot.id);
  const [chatsOpen, setChatsOpen] = useState(true);
  const pinnedItems = useRosterStore((state) => state.pinnedItems);

  const pinnedIds = useMemo(
    () =>
      new Set<string>(
        chats.flatMap((chat) =>
          pinnedItems.some((pin) => pin.kind === "chat" && pin.id === chat.id) ? [chat.id] : [],
        ),
      ),
    [chats, pinnedItems],
  );

  const hasChatTree = chats.length - pinnedIds.size > 0;
  // A chat pinned to Pins is marked there, so the bot row is not.
  const pinnedChatOpen = openThreadId !== null && pinnedIds.has(openThreadId);
  const active = openThreadId !== null && !pinnedChatOpen;

  return (
    <li
      role="listitem"
      data-roster-item
      data-pinned={pinned || undefined}
      className="group/bot w-full flex-none list-none"
    >
      <div
        data-testid="roster-bot-row"
        data-bot-hover
        onContextMenu={(event) => {
          event.preventDefault();
          menuTriggerRef.current?.click();
        }}
        className={cn(
          "group/row relative flex w-full items-center rounded-md outline-none select-none",
          ROSTER_ROW_FOCUS_CLASS,
          active
            ? // With its chats listed, only the open chat's row is filled.
              "sidebar-row-current text-sidebar-foreground group-has-[[data-bot-chat-tree]_[aria-current]]/bot:sidebar-row-plain group-has-[[data-bot-chat-tree]_[aria-current]]/bot:hover:sidebar-row-hovered"
            : "sidebar-row-plain text-sidebar-foreground hover:sidebar-row-hovered",
        )}
      >
        <div
          data-roster-row={rosterItemKey({ kind: "bot", id: bot.id })}
          tabIndex={-1}
          aria-current={active || undefined}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none"
        >
          <span
            className={cn(
              "flex",
              hasChatTree && "group-focus-within/row:opacity-0 group-hover/row:opacity-0",
            )}
          >
            <BotAvatarView
              avatar={bot.avatar}
              name={bot.name}
              state={presence}
              className="size-4"
            />
          </span>
          <>
            <span
              className={cn(
                ROSTER_NAME_CLASS,
                active && "text-sidebar-foreground dark:text-sidebar-foreground",
              )}
            >
              {bot.name}
            </span>
          </>
        </div>
        {hasChatTree ? (
          // Like Capy's crews: the chevron takes the avatar's place on hover or focus.
          <span
            className={cn("absolute top-1/2 left-0.5 flex -translate-y-1/2", ROSTER_REVEAL_CLASS)}
          >
            <Button
              size="icon-row"
              variant="sidebar-ghost"
              aria-expanded={chatsOpen}
              aria-label={t(chatsOpen ? "Hide {name} chats" : "Show {name} chats", {
                name: bot.name,
              })}
              onClick={() => setChatsOpen(!chatsOpen)}
            >
              <RiArrowDownSLine
                aria-hidden
                className={cn(
                  "size-3.5 transition-transform duration-100 motion-reduce:transition-none",
                  !chatsOpen && "-rotate-90",
                )}
              />
            </Button>
          </span>
        ) : null}
        <span className={ROSTER_TRAIL_CLASS}>
          <span className={ROSTER_TRAIL_INFO_CLASS}>
            {shortcutLabel ? (
              <Kbd variant="jump">{shortcutLabel}</Kbd>
            ) : hasChatTree && chatsOpen ? null : (
              <ChatStatusIcon
                presence={presence}
                unread={unread}
                fallback={
                  latestMessage ? (
                    <time
                      dateTime={latestMessage.at}
                      aria-label={t("Last message {time}", {
                        time: formatRosterFullTimestamp(latestMessage.at),
                      })}
                      className={ROSTER_TIME_CLASS}
                    >
                      {shortRelativeTime(latestMessage.at, t)}
                    </time>
                  ) : null
                }
              />
            )}
          </span>
          <span className={ROSTER_TRAIL_ACTIONS_CLASS}>
            <RosterRowAction
              label={t("New chat")}
              icon={RiAddLine}
              onClick={() =>
                useRosterStore.getState().openNewChat({ memberKeys: [`bot:${bot.id}`] })
              }
            />
          </span>
        </span>
        <Menu>
          <MenuTrigger
            render={
              <button
                ref={menuTriggerRef}
                type="button"
                tabIndex={-1}
                aria-label={t("Actions for {name}", { name: bot.name })}
                className="sr-only"
              />
            }
          />
          <MenuPopup align="end">
            <MenuItem onClick={() => onOpenSettings(bot)}>
              <RiSettings3Line />
              {t("Bot settings")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => onArchive(bot)}>
              <RiArchiveLine />
              {t("Archive bot")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {hasChatTree && chatsOpen ? (
        <BotChatTree chats={chats} openThreadId={openThreadId} pinnedIds={pinnedIds} />
      ) : null}
    </li>
  );
});

/** One avatar in the icon-collapsed rail, with a name tooltip. */
function RailBotButton({
  bot,
  openThreadId,
  onSelect,
}: {
  bot: Bot;
  /** This bot's chat on screen, if one is: it marks the button and counts as seen. */
  openThreadId: string | null;
  onSelect: (bot: Bot) => void;
}) {
  const presence = useBotPresence(bot.id);
  // The collapsed rail marks unread replies like the expanded row does.
  const chatRef = useLatestBotChatRef(bot.id);
  const unread = useBotRosterUnread(bot.id, chatRef, openThreadId === chatRef?.threadId);
  const isActive = openThreadId !== null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-bot-hover
            aria-current={isActive || undefined}
            onClick={() => onSelect(bot)}
            className={cn(
              "relative flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "bg-sidebar-row-active" : "bg-transparent hover:bg-sidebar-row-hover",
            )}
          >
            <RosterAvatar
              bot={bot}
              presence={presence}
              className="size-7"
              dotClassName="size-1.5"
            />
            {unread ? (
              <span className="absolute top-0.5 right-0.5 flex">
                <UnreadDot />
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="right">{bot.name}</TooltipPopup>
    </Tooltip>
  );
}

/** One group in the icon-collapsed rail, with a name tooltip and its unread dot. */
function RailGroupButton({
  group,
  bots,
  isActive,
  onSelect,
}: {
  group: Group;
  bots: readonly Bot[];
  isActive: boolean;
  onSelect: (group: Group) => void;
}) {
  const unread = useChatUnread(useGroupChatRef(group.id)) && !isActive;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-current={isActive || undefined}
            onClick={() => onSelect(group)}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
            )}
          >
            <GroupMemberStack group={group} bots={bots} size="md" ringClassName="ring-sidebar" />
            {unread ? (
              <span className="absolute top-0.5 right-0.5 flex">
                <UnreadDot />
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="right">{group.name}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Otto: A bot chat pinned to Pins, the same 28px row as a bot's: the bot's 16px avatar, the
 * chat's title, its status and time at rest, and Unpin, Archive and More actions on hover.
 * Opening it shows the bot on that chat; the bot's own chat list leaves it out.
 */
export const ChatRosterRow = memo(function ChatRosterRow({
  threadId,
  bot,
  openThreadId,
  onPin,
}: {
  threadId: string;
  bot: Bot;
  /** The chat on screen, if any. */
  openThreadId: string | null;
  onPin: (item: RosterItemRef, pinned: boolean) => void;
}) {
  const { t } = useI18n();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const item = useMemo(() => ({ kind: "chat" as const, id: threadId }), [threadId]);
  const environmentId = usePrimaryEnvironmentId();
  const chats = useBotChats(bot.id);
  const navigate = useNavigate();
  const actions = useChatActions();
  const shell = chats.find((chat) => chat.id === threadId);

  if (!shell || !environmentId) return null;

  const current = openThreadId === threadId;
  const threadRef = scopeThreadRef(environmentId, shell.id);
  const relative = formatRelativeTime(shell.updatedAt);

  const title =
    shell.title === PLACEHOLDER_THREAD_TITLE || shell.title.trim() === ""
      ? t("Untitled chat")
      : shell.title;

  return (
    <li
      role="listitem"
      data-roster-item
      data-pinned
      onContextMenu={(event) => {
        event.preventDefault();
        menuTriggerRef.current?.click();
      }}
      className={cn(
        "group/row relative flex w-full flex-none items-center rounded-md",
        ROSTER_ROW_FOCUS_CLASS,
        current ? "sidebar-row-current" : "sidebar-row-plain hover:sidebar-row-hovered",
      )}
    >
      <button
        type="button"
        data-roster-row={rosterItemKey(item)}
        aria-current={current || undefined}
        onClick={() => void navigate({ to: "/chats/$threadId", params: { threadId } })}
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none"
      >
        <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
        <span
          className={cn(
            ROSTER_NAME_CLASS,
            current && "text-sidebar-foreground dark:text-sidebar-foreground",
          )}
        >
          {title}
        </span>
      </button>
      <span className={ROSTER_TRAIL_CLASS}>
        <span className={ROSTER_TRAIL_INFO_CLASS}>
          <ThreadStatusIcon
            environmentId={environmentId}
            shell={shell}
            current={current}
            fallback={
              <span className={ROSTER_TIME_CLASS}>
                {relative?.suffix ? relative.value : t("now")}
              </span>
            }
          />
        </span>
        <span className={ROSTER_TRAIL_ACTIONS_CLASS}>
          <RosterRowAction
            label={t("Unpin")}
            icon={RiUnpinLine}
            onClick={() => onPin(item, false)}
          />
          <RosterRowAction
            label={t("Archive")}
            icon={RiArchiveLine}
            onClick={() => void actions.archive(threadRef)}
          />
          <RosterRowMore
            label={t("Actions for {name}", { name: title })}
            triggerRef={menuTriggerRef}
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
      </span>
    </li>
  );
});

export const GroupRosterRow = memo(function GroupRosterRow({
  group,
  bots,
  isActive,
  onSelect,
  pinned,
  onPin,
}: {
  group: Group;
  bots: readonly Bot[];
  isActive: boolean;
  onSelect: (group: Group) => void;
  pinned: boolean;
  onPin: (item: RosterItemRef, pinned: boolean) => void;
}) {
  const { t } = useI18n();
  const item = useMemo(() => ({ kind: "group" as const, id: group.id }), [group.id]);
  const unread = useChatUnread(useGroupChatRef(group.id)) && !isActive;
  const presence = useGroupPresence(group.id);

  return (
    <li
      role="listitem"
      data-roster-item
      data-testid="roster-group-card"
      data-pinned={pinned || undefined}
      className={cn(
        "group/row relative flex w-full flex-none items-center rounded-md",
        ROSTER_ROW_FOCUS_CLASS,
        isActive ? "sidebar-row-current" : "sidebar-row-plain hover:sidebar-row-hovered",
      )}
    >
      <button
        type="button"
        data-roster-row={rosterItemKey({ kind: "group", id: group.id })}
        aria-current={isActive || undefined}
        onClick={() => onSelect(group)}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none",
        )}
      >
        <GroupMemberStack group={group} bots={bots} ringClassName="ring-sidebar" />
        <span
          className={cn(
            ROSTER_NAME_CLASS,
            isActive && "text-sidebar-foreground dark:text-sidebar-foreground",
          )}
        >
          {group.name}
        </span>
      </button>
      <span className={ROSTER_TRAIL_CLASS}>
        <span className={ROSTER_TRAIL_INFO_CLASS}>
          <ChatStatusIcon presence={presence} unread={unread} />
        </span>
        <span className={ROSTER_TRAIL_ACTIONS_CLASS}>
          <RosterRowAction
            label={pinned ? t("Unpin") : t("Pin")}
            icon={pinned ? RiUnpinLine : RiPushpinLine}
            onClick={() => onPin(item, !pinned)}
          />
        </span>
      </span>
    </li>
  );
});

/**
 * Otto: A roster section heading, copied from Capy's sidebar: a 28px row with
 * a 12px/500 label at 52% inset 6px, on the avatars' edge. Pins, Groups and
 * DMs share it, and their rows share one pattern. Sections carry no actions;
 * the header's plus starts every chat.
 */
export function RosterSectionLabel({
  label,
  first,
}: {
  /** The list's first section sits flush; later ones get 12px above. */
  readonly first: boolean;
  readonly label: string;
}) {
  return (
    <li
      role="presentation"
      data-roster-section-label=""
      className={cn(
        "flex h-7 w-full flex-none list-none items-center gap-1 ps-1.5 pe-0.5",
        !first && "mt-3",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground/52">
        {label}
      </span>
    </li>
  );
}

/** Icon-collapsed roster: group buttons first, then every visible bot. */
export function RosterRail({
  groups,
  bots,
  visibleBots,
  openChat,
  onSelectBot,
  onSelectGroup,
}: {
  groups: readonly Group[];
  bots: readonly Bot[];
  visibleBots: readonly Bot[];
  /** The chat on screen, and who it is with. */
  openChat: {
    readonly threadId: string;
    readonly botId: string | null;
    readonly groupId: string | null;
  } | null;
  onSelectBot: (bot: Bot) => void;
  onSelectGroup: (group: Group) => void;
}) {
  return (
    <SidebarGroup className="hidden items-center gap-1 px-0 pt-1 group-data-[collapsible=icon]:flex">
      <ul data-testid="roster-rail" className="flex flex-col items-center gap-1">
        {groups.map((group) => (
          <li key={group.id} className="list-none">
            <RailGroupButton
              group={group}
              bots={bots}
              isActive={openChat?.groupId === group.id}
              onSelect={onSelectGroup}
            />
          </li>
        ))}
        {visibleBots.map((bot) => (
          <li key={bot.id} className="list-none">
            <RailBotButton
              bot={bot}
              openThreadId={openChat?.botId === bot.id ? openChat.threadId : null}
              onSelect={onSelectBot}
            />
          </li>
        ))}
      </ul>
    </SidebarGroup>
  );
}
