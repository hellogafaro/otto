import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowUpLine,
  RiPushpinLine,
  RiSettings3Line,
} from "@remixicon/react";
import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { ScopedThreadRef } from "@otto/contracts";

import { memo, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useLatestGroupThreadId, useThreadMessages } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTime } from "../../timestampFormat";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarGroup } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotChatTree, useBotChats } from "./BotChatTree";
import { BotAvatarView } from "./BotAvatarView";
import { visibleBotChatMessages } from "./botConversationPresentation";
import { useBotPresence } from "./botPresence";
import { useBotRosterUnread, useChatUnread } from "../chat/useChatUnread";
import { GroupMemberStack } from "./GroupMemberStack";
import {
  resolveLatestRosterMessage,
  resolveRosterIndicator,
  rosterItemKey,
  type RosterItemRef,
  type RosterLastMessage,
  type RosterPresence,
} from "./roster.logic";
import { useRosterStore } from "./rosterStore";
import type { Bot, Group } from "./types";
import { useBotChatTarget, useBotThreadCandidate } from "./useBotThreadRef";

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
  const candidate = useBotThreadCandidate(botId);
  const { ref: threadRef } = useBotChatTarget(botId, candidate);
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

/**
 * Otto: Compact roster rows, copied from Capy's sidebar: 28px, a 16px avatar
 * 6px in and centered under the 24px in-row chevron, 8px gap and right inset, 13px name at 80% (68% in dark) that turns full strength
 * when active, and an 11px short time at 52% on the right.
 */
const ROSTER_NAME_CLASS =
  "min-w-0 flex-1 truncate text-13px font-normal text-sidebar-foreground/80 dark:text-sidebar-foreground/68";

/** Row controls appear on hover or keyboard focus, like Capy's row actions. */
const ROSTER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none";

const ROSTER_TIME_CLASS =
  "flex min-w-6 shrink-0 justify-end text-11px tabular-nums text-sidebar-foreground/52";

function shortRelativeTime(isoDate: string, t: ReturnType<typeof useI18n>["t"]): string {
  const relative = formatRelativeTime(isoDate);

  return relative?.suffix ? relative.value : t("now");
}

export const BotRosterRow = memo(function BotRosterRow({
  bot,
  lastMessage,
  isActive,
  chatOpen,
  onSelect,
  onOpenSettings,
  pinned,
  onPin,
  canMoveUp,
  canMoveDown,
  onNudge,
  onArchive,
}: {
  bot: Bot;
  lastMessage: RosterLastMessage | null;
  isActive: boolean;
  /** Only an open chat counts as seen; bot settings still show unread replies. */
  chatOpen: boolean;
  onSelect: (bot: Bot) => void;
  onOpenSettings: (bot: Bot) => void;
  pinned: boolean;
  onPin: (item: RosterItemRef, pinned: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNudge: (item: RosterItemRef, delta: -1 | 1) => void;
  onArchive: (bot: Bot) => void;
}) {
  const { t } = useI18n();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const item = useMemo(() => ({ kind: "bot" as const, id: bot.id }), [bot.id]);
  const presence = useBotPresence(bot.id);

  const { message: latestMessage, threadRef: chatRef } = useLatestBotMessage(bot.id, lastMessage);

  const unread = useBotRosterUnread(bot.id, chatRef, chatOpen);
  const chats = useBotChats(bot.id);
  const [chatsOpen, setChatsOpen] = useState(true);
  const hasChatTree = chats.length > 1;
  const environmentId = usePrimaryEnvironmentId();

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
          isActive
            ? // With its chats listed, only the open chat's row is filled.
              "bg-sidebar-row-active text-sidebar-foreground group-has-[[data-bot-chat-tree]_[aria-current]]/bot:bg-transparent group-has-[[data-bot-chat-tree]_[aria-current]]/bot:hover:bg-sidebar-row-hover"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <button
          type="button"
          data-roster-row={rosterItemKey({ kind: "bot", id: bot.id })}
          aria-current={isActive || undefined}
          onClick={() => onSelect(bot)}
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            className={cn(
              "flex",
              hasChatTree && "group-focus-within/row:opacity-0 group-hover/row:opacity-0",
            )}
          >
            <RosterAvatar
              bot={bot}
              presence={presence}
              className="size-4"
              dotClassName="size-1.5"
            />
          </span>
          <>
            <span
              className={cn(
                ROSTER_NAME_CLASS,
                isActive && "text-sidebar-foreground dark:text-sidebar-foreground",
              )}
            >
              {bot.name}
            </span>
            {unread ? <UnreadDot /> : null}
            {latestMessage ? (
              <time
                dateTime={latestMessage.at}
                aria-label={t("Last message {time}", {
                  time: formatRosterFullTimestamp(latestMessage.at),
                })}
                className={cn(
                  ROSTER_TIME_CLASS,
                  "group-focus-within/row:opacity-0 group-hover/row:opacity-0",
                )}
              >
                {shortRelativeTime(latestMessage.at, t)}
              </time>
            ) : null}
          </>
        </button>
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
        {/* In the same 24px box as the section plus, so they line up. */}
        <span
          className={cn("absolute top-1/2 right-0.5 flex -translate-y-1/2", ROSTER_REVEAL_CLASS)}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-row"
                  variant="sidebar-ghost"
                  aria-label={t("New chat with {name}", { name: bot.name })}
                  onClick={() => {
                    const newest = chats[0];
                    const roster = useRosterStore.getState();

                    if (newest && environmentId) {
                      roster.openBotChat(bot.id, null, `/${environmentId}/${newest.id}`);

                      // An untouched newest chat is already fresh.
                      if (newest.latestUserMessageAt !== null || newest.latestTurn !== null) {
                        roster.requestNewChat(bot.id);
                      }
                    }

                    onSelect(bot);
                  }}
                >
                  <AppIcon icon={RiAddLine} className="size-3" />
                </Button>
              }
            />
            <TooltipPopup>{t("New chat")}</TooltipPopup>
          </Tooltip>
        </span>
        <Menu>
          <MenuTrigger
            render={
              <button
                ref={menuTriggerRef}
                type="button"
                aria-label={t("Actions for {name}", { name: bot.name })}
                className="absolute right-2 top-1/2 size-px -translate-y-1/2 overflow-hidden opacity-0 outline-none focus-visible:size-7 focus-visible:overflow-visible focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          />
          <MenuPopup align="end">
            <MenuItem onClick={() => onOpenSettings(bot)}>
              <RiSettings3Line />
              {t("Bot settings")}
            </MenuItem>
            <MenuItem onClick={() => onPin(item, !pinned)}>
              <RiPushpinLine />
              {pinned ? t("Unpin") : t("Pin")}
            </MenuItem>
            <MenuItem disabled={!canMoveUp} onClick={() => onNudge(item, -1)}>
              <RiArrowUpLine />
              {t("Move up")}
            </MenuItem>
            <MenuItem disabled={!canMoveDown} onClick={() => onNudge(item, 1)}>
              <RiArrowDownLine />
              {t("Move down")}
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => onArchive(bot)}>
              <RiArchiveLine />
              {t("Archive bot")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {hasChatTree && chatsOpen ? (
        <BotChatTree
          botId={bot.id}
          chats={chats}
          chatOpen={chatOpen}
          onOpen={() => onSelect(bot)}
        />
      ) : null}
    </li>
  );
});

/** One avatar in the icon-collapsed rail, with a name tooltip. */
function RailBotButton({
  bot,
  isActive,
  chatOpen,
  onSelect,
}: {
  bot: Bot;
  isActive: boolean;
  /** Only an open chat counts as seen; bot settings still show unread replies. */
  chatOpen: boolean;
  onSelect: (bot: Bot) => void;
}) {
  const presence = useBotPresence(bot.id);
  // The collapsed rail marks unread replies like the expanded row does.
  const { ref: chatRef } = useBotChatTarget(bot.id, useBotThreadCandidate(bot.id));
  const unread = useBotRosterUnread(bot.id, chatRef, chatOpen);

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
            <GroupMemberStack group={group} bots={bots} sizeClassName="size-5" />
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

export const GroupRosterRow = memo(function GroupRosterRow({
  group,
  bots,
  isActive,
  onSelect,
  pinned,
  onPin,
  canMoveUp,
  canMoveDown,
  onNudge,
}: {
  group: Group;
  bots: readonly Bot[];
  isActive: boolean;
  onSelect: (group: Group) => void;
  pinned: boolean;
  onPin: (item: RosterItemRef, pinned: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNudge: (item: RosterItemRef, delta: -1 | 1) => void;
}) {
  const { t } = useI18n();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const item = useMemo(() => ({ kind: "group" as const, id: group.id }), [group.id]);
  const unread = useChatUnread(useGroupChatRef(group.id)) && !isActive;

  return (
    <li
      role="listitem"
      data-roster-item
      data-testid="roster-group-card"
      data-pinned={pinned || undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        menuTriggerRef.current?.click();
      }}
      className={cn(
        "relative flex items-center",
        "w-full flex-none rounded-md",
        isActive && "bg-sidebar-row-active",
      )}
    >
      <button
        type="button"
        data-roster-row={rosterItemKey({ kind: "group", id: group.id })}
        aria-current={isActive || undefined}
        onClick={() => onSelect(group)}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <GroupMemberStack group={group} bots={bots} sizeClassName="size-4" />
        <span
          className={cn(
            ROSTER_NAME_CLASS,
            isActive && "text-sidebar-foreground dark:text-sidebar-foreground",
          )}
        >
          {group.name}
        </span>
        {unread ? <UnreadDot /> : null}
      </button>
      <Menu>
        <MenuTrigger
          render={
            <button
              ref={menuTriggerRef}
              type="button"
              aria-label={t("Actions for {name}", { name: group.name })}
              className="absolute right-2 top-1/2 size-px -translate-y-1/2 overflow-hidden opacity-0 outline-none focus-visible:size-7 focus-visible:overflow-visible focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        />
        <MenuPopup align="end">
          <MenuItem onClick={() => onPin(item, !pinned)}>
            <RiPushpinLine />
            {pinned ? t("Unpin") : t("Pin")}
          </MenuItem>
          <MenuItem disabled={!canMoveUp} onClick={() => onNudge(item, -1)}>
            <RiArrowUpLine />
            {t("Move up")}
          </MenuItem>
          <MenuItem disabled={!canMoveDown} onClick={() => onNudge(item, 1)}>
            <RiArrowDownLine />
            {t("Move down")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
});

/**
 * Otto: A roster section heading, copied from Capy's sidebar: a 28px row with
 * a 12px/500 label at 52% inset 6px, on the avatars' edge, and an optional 24px quiet plus with a
 * 12px glyph inset 2px on the right, the same box as a bot row's new-chat plus,
 * so they line up. Pins, Groups and DMs share it, and their rows share one
 * pattern.
 */
export function RosterSectionLabel({
  label,
  add,
  first,
}: {
  /** The list's first section sits flush; later ones get 12px above. */
  readonly first: boolean;
  readonly label: string;
  /** Omitted for Pinned, which gains rows from each row's menu. */
  readonly add?: { readonly label: string; readonly onClick: () => void };
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
      {add ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={add.label}
                size="icon-row"
                variant="sidebar-ghost"
                onClick={add.onClick}
              >
                <AppIcon icon={RiAddLine} className="size-3" />
              </Button>
            }
          />
          <TooltipPopup>{add.label}</TooltipPopup>
        </Tooltip>
      ) : null}
    </li>
  );
}

/** Icon-collapsed roster: group buttons first, then every visible bot. */
export function RosterRail({
  groups,
  bots,
  visibleBots,
  pathname,
  activeBotId,
  onSelectBot,
  onSelectGroup,
}: {
  groups: readonly Group[];
  bots: readonly Bot[];
  visibleBots: readonly Bot[];
  pathname: string;
  /** The selected bot, or null while a group route is open. */
  activeBotId: string | null;
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
              isActive={pathname === `/groups/${group.id}`}
              onSelect={onSelectGroup}
            />
          </li>
        ))}
        {visibleBots.map((bot) => (
          <li key={bot.id} className="list-none">
            <RailBotButton
              bot={bot}
              isActive={activeBotId === bot.id}
              chatOpen={pathname === `/bots/${bot.id}`}
              onSelect={onSelectBot}
            />
          </li>
        ))}
      </ul>
    </SidebarGroup>
  );
}
