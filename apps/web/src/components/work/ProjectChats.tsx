import { PLACEHOLDER_THREAD_TITLE, type ProjectId } from "@otto/contracts";
import { RiAddLine, RiChat1Line } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";

import { useI18n } from "../../i18n";
import { useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { CONTENT_ROW_CLASS } from "../contentRow";
import { BotAvatarView } from "../roster/BotAvatarView";
import { findLatestBotThreadTarget } from "../roster/botThreadRuntime.logic";
import { GroupMemberStack } from "../roster/GroupMemberStack";
import { useRosterStore } from "../roster/rosterStore";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Starts a chat with a bot, filed in the project: the top bar's quiet 28px plus opens the bots. */
export function ProjectNewChat({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bots = useRosterStore((state) => state.bots);

  const activeBots = bots
    .filter((bot) => bot.archivedAt === null)
    .toSorted((left, right) => left.name.localeCompare(right.name));

  if (activeBots.length === 0) return null;

  const start = (botId: string) => {
    const roster = useRosterStore.getState();
    roster.requestProjectChat({ botId, projectId });
    roster.selectBot(botId);
    void navigate({ to: "/bots/$botId", params: { botId } });
  };

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button size="icon" variant="ghost-muted" aria-label={t("New chat")}>
                  <RiAddLine aria-hidden className="size-4" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">{t("New chat")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="min-w-44">
        {activeBots.map((bot) => (
          <MenuItem key={bot.id} onClick={() => start(bot.id)}>
            <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
            {bot.name}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/**
 * Otto: A project's Chats tab: every chat filed in the project, newest first, as 32px content
 * rows with the bot's avatar or the group's member stack, the title and when it last moved.
 * With none, the tab is an empty state; the top bar's plus starts one.
 */
export function ProjectChats({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const shells = useThreadShells();

  const chats = shells
    .filter((shell) => shell.projectId === projectId && shell.archivedAt === null)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const bots = useRosterStore((state) => state.bots);
  const groups = useRosterStore((state) => state.groups);

  if (chats.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <RiChat1Line />
        </EmptyMedia>
        <EmptyDescription>
          {t("No chats yet. Start one with a bot to work on this project.")}
        </EmptyDescription>
      </Empty>
    );
  }

  const openChat = (shell: (typeof chats)[number]) => {
    const roster = useRosterStore.getState();

    if (shell.botId) {
      const newest = findLatestBotThreadTarget(shell.botId, shell.environmentId, shells);
      roster.selectBot(shell.botId);
      roster.openBotChat(
        shell.botId,
        newest?.threadId === shell.id ? null : shell.id,
        `/${shell.environmentId}/${shell.id}`,
      );

      return void navigate({ to: "/bots/$botId", params: { botId: shell.botId } });
    }

    if (shell.groupId) {
      void navigate({ to: "/groups/$groupId", params: { groupId: shell.groupId } });
    }
  };

  return (
    <ul className="flex flex-col">
      {chats.map((shell) => {
        const bot = shell.botId ? bots.find((candidate) => candidate.id === shell.botId) : null;

        const group = shell.groupId
          ? groups.find((candidate) => candidate.id === shell.groupId)
          : null;

        const title = shell.title === PLACEHOLDER_THREAD_TITLE ? t("New chat") : shell.title;

        return (
          <li key={shell.id}>
            <button type="button" className={CONTENT_ROW_CLASS} onClick={() => openChat(shell)}>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {bot ? (
                  <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
                ) : null}
                {!bot && group ? (
                  <GroupMemberStack group={group} bots={bots} sizeClassName="size-4" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatRelativeTimeLabel(shell.updatedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
