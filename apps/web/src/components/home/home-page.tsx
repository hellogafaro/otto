import { scopedThreadKey, scopeThreadRef } from "@otto/client-runtime/environment";
import {
  BotId,
  type EnvironmentId,
  type Notification,
  type NotificationType,
  type WorkParticipant,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  RiChat1Line,
  RiCheckDoubleLine,
  RiInbox2Line,
  RiListCheck3,
  RiTimeLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { environmentSnapshotAtom } from "../../state/shell";
import { useThreadShells } from "../../state/entities";
import { notificationEnvironment } from "../../state/notifications";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel, localDateKey } from "../../timestamp-format";
import { useUiStateStore } from "../../ui-state-store";
import { hasUnseenCompletion } from "../chat/chat-actions.logic";
import { CustomizeGroup, CustomizeRow } from "../customize/customize-group";
import { Button } from "../ui/button";
import { SkeletonTableRows } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer, PageTitle } from "../workspace-page-container";
import { WorkStatusIcon } from "../work/work-status";
import { ParticipantAvatar, participantName } from "../work/work-participants";
import { WorkPage, useWorkData } from "../work/work-pages";
import { pickGreeting, routinesToday, routineTime, tasksDue } from "./home.logic";

type ChatState = "needs" | "working" | "ready";

const CHAT_STATE_ORDER: Record<ChatState, number> = { needs: 0, ready: 1, working: 2 };

const NOTIFICATION_TEXT = {
  assigned: "{name} assigned you {title}",
  owner: "{name} made you the owner of {title}",
  mention: "{name} mentioned you on {title}",
  reply: "{name} replied to you on {title}",
  comment: "{name} commented on {title}",
  chat_mention: "{name} mentioned you in {title}",
} as const satisfies Record<NotificationType, string>;

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const formatDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

function Meta({ children }: { readonly children: string }) {
  return (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

/**
 * Otto: Home, where a person lands: a greeting, then four cards like Skills and Integrations,
 * each with its count and its own empty state. Today holds their open tasks due today or
 * overdue, Chats the chats waiting on them, with a reply they haven't seen or with a bot
 * working, Routines what runs today, and Notifications theirs, with Mark all read.
 */
export function HomePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { environmentId, loaded, projects, tasks, participants, currentPersonId } = useWorkData();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const shells = useThreadShells();
  const lastVisited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const [now] = useState(() => new Date());
  const [greeting] = useState(() => pickGreeting(now.getHours(), Math.random()));
  const today = localDateKey(now);
  const me = participants.people.find((person) => person.personId === currentPersonId);
  const firstName = me?.displayName.split(/\s+/)[0] ?? "";

  const title = greeting.includes("{name}")
    ? firstName
      ? t(greeting, { name: firstName })
      : t("Welcome back")
    : t(greeting);

  const due = currentPersonId ? tasksDue(tasks, currentPersonId, today) : [];
  const routines = routinesToday(snapshot?.routines ?? [], today);

  const chatState = (shell: (typeof shells)[number]): ChatState | null => {
    if (shell.hasPendingApprovals || shell.hasPendingUserInput) return "needs";

    if (shell.session?.status === "running" || shell.session?.status === "starting") {
      return "working";
    }

    const key = scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id));

    return hasUnseenCompletion(shell.latestTurn?.completedAt, lastVisited[key]) ? "ready" : null;
  };

  const chats = shells
    .filter(
      (shell) =>
        shell.environmentId === environmentId &&
        (shell.botId != null || shell.groupId != null) &&
        shell.parentThreadId == null &&
        shell.archivedAt === null,
    )
    .flatMap((shell) => {
      const state = chatState(shell);

      return state ? [{ shell, state }] : [];
    })
    .toSorted(
      (left, right) =>
        CHAT_STATE_ORDER[left.state] - CHAT_STATE_ORDER[right.state] ||
        right.shell.updatedAt.localeCompare(left.shell.updatedAt),
    );

  const chatStateLabel: Record<ChatState, string> = {
    needs: t("Waiting on you"),
    ready: t("New reply"),
    working: t("Working"),
  };

  const query = useEnvironmentQuery(
    environmentId ? notificationEnvironment.list({ environmentId, input: {} }) : null,
  );

  const markRead = useAtomCommand(notificationEnvironment.markRead);
  const notifications = query.data?.notifications ?? [];
  const unread = query.data?.unread ?? 0;

  const read = async (target: EnvironmentId, ids?: readonly string[]) => {
    const result = await markRead({
      environmentId: target,
      input: ids === undefined ? {} : { ids: [...ids] },
    });

    if (AsyncResult.isSuccess(result)) query.refresh();
  };

  const actor = (notification: Notification): WorkParticipant | null => {
    if (notification.actor === null) return null;

    if (notification.actor.type === "bot") {
      return { kind: "bot", botId: BotId.make(notification.actor.id) };
    }

    const personId = notification.actor.id;

    return (
      participants.people.find((person) => person.personId === personId) ?? {
        kind: "person",
        personId,
        displayName: t("Someone"),
      }
    );
  };

  const openNotification = (notification: Notification) => {
    if (environmentId && notification.readAt === null) void read(environmentId, [notification.id]);

    if (notification.entityType === "task") {
      void navigate({ to: "/tasks/$taskId", params: { taskId: notification.entityId } });

      return;
    }

    void navigate({ to: "/chats/$threadId", params: { threadId: notification.entityId } });
  };

  return (
    <WorkPage>
      <WorkspacePageContainer className="gap-10 pt-3 pb-16 sm:pt-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <PageTitle>{title}</PageTitle>
          <p className="text-13px text-muted-foreground">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        {!loaded ? (
          <SkeletonTableRows label={t("Loading…")} />
        ) : (
          <div className="flex flex-col gap-10">
            <CustomizeGroup
              title={t("Today")}
              count={due.length}
              empty={
                due.length === 0 ? { icon: <RiListCheck3 />, description: t("No tasks due") } : null
              }
            >
              {due.map((task) => (
                <CustomizeRow
                  key={task.id}
                  logo={<WorkStatusIcon status={task.status} />}
                  name={task.title}
                  detail={projects.find((project) => project.id === task.projectId)?.title}
                  status={
                    <Meta>
                      {task.dueDate === today ? t("Due today") : formatDay(task.dueDate ?? today)}
                    </Meta>
                  }
                  onOpen={() =>
                    void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
                  }
                />
              ))}
            </CustomizeGroup>
            <CustomizeGroup
              title={t("Chats")}
              count={chats.length}
              empty={
                chats.length === 0
                  ? { icon: <RiChat1Line />, description: t("No chats waiting") }
                  : null
              }
            >
              {chats.map(({ shell, state }) => (
                <CustomizeRow
                  key={shell.id}
                  logo={
                    shell.botId ? (
                      <ParticipantAvatar
                        participant={{ kind: "bot", botId: shell.botId }}
                        bots={participants.allBots}
                      />
                    ) : (
                      <RiChat1Line aria-hidden className="size-4" />
                    )
                  }
                  name={shell.title}
                  detail={chatStateLabel[state]}
                  status={<Meta>{formatRelativeTimeLabel(shell.updatedAt)}</Meta>}
                  onOpen={() =>
                    void navigate({ to: "/chats/$threadId", params: { threadId: shell.id } })
                  }
                />
              ))}
            </CustomizeGroup>
            <CustomizeGroup
              title={t("Routines today")}
              count={routines.length}
              empty={
                routines.length === 0
                  ? { icon: <RiTimeLine />, description: t("No routines today") }
                  : null
              }
            >
              {routines.map((routine) => {
                const bot = { kind: "bot" as const, botId: BotId.make(routine.botId) };
                const at = routineTime(routine, today);

                return (
                  <CustomizeRow
                    key={routine.id}
                    logo={<ParticipantAvatar participant={bot} bots={participants.allBots} />}
                    name={routine.job}
                    detail={participantName(bot, participants.allBots)}
                    status={at ? <Meta>{timeOfDay(at)}</Meta> : null}
                    onOpen={() =>
                      void navigate({
                        to: "/routines/$routineId",
                        params: { routineId: routine.id },
                      })
                    }
                  />
                );
              })}
            </CustomizeGroup>
            <CustomizeGroup
              title={t("Notifications")}
              count={notifications.length}
              empty={
                notifications.length === 0
                  ? { icon: <RiInbox2Line />, description: t("No notifications") }
                  : null
              }
              action={
                environmentId && unread > 0 ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost-muted"
                          aria-label={t("Mark all read")}
                          onClick={() => void read(environmentId)}
                        >
                          <RiCheckDoubleLine aria-hidden className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipPopup side="bottom">{t("Mark all read")}</TooltipPopup>
                  </Tooltip>
                ) : null
              }
            >
              {notifications.map((notification) => {
                const who = actor(notification);

                return (
                  <CustomizeRow
                    key={notification.id}
                    logo={
                      who ? (
                        <ParticipantAvatar participant={who} bots={participants.allBots} />
                      ) : (
                        <RiInbox2Line aria-hidden className="size-4" />
                      )
                    }
                    name={t(NOTIFICATION_TEXT[notification.type], {
                      name: who ? participantName(who, participants.allBots) : t("Someone"),
                      title: notification.title,
                    })}
                    detail={notification.excerpt || undefined}
                    status={
                      <span className="flex shrink-0 items-center gap-2">
                        <Meta>{formatRelativeTimeLabel(notification.createdAt)}</Meta>
                        {notification.readAt === null ? (
                          <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                        ) : null}
                      </span>
                    }
                    onOpen={() => openNotification(notification)}
                  />
                );
              })}
            </CustomizeGroup>
          </div>
        )}
      </WorkspacePageContainer>
    </WorkPage>
  );
}
