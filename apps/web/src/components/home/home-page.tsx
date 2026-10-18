import { scopedThreadKey, scopeThreadRef } from "@otto/client-runtime/environment";
import { BotId } from "@otto/contracts";
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
import { useListPages } from "../../hooks/use-list-pages";
import { routineChangesAtom, routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel, localDateKey } from "../../timestamp-format";
import { useUiStateStore } from "../../ui-state-store";
import { hasUnseenCompletion } from "../chat/chat-actions.logic";
import { CustomizeGroup, CustomizeRow } from "../customize/customize-group";
import { NotificationRow } from "../notifications/notification-row";
import { useNotifications } from "../notifications/use-notifications";
import { Button } from "../ui/button";
import { SkeletonTableRows } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer, PageTitle } from "../workspace-page-container";
import { WorkStatusIcon } from "../work/work-status";
import { ParticipantAvatar, participantName } from "../work/work-participants";
import { WorkPage, useWorkData } from "../work/work-pages";
import { HomeDither } from "./home-dither";
import { pickGreeting, routinesToday, routineTime, tasksDue } from "./home.logic";

type ChatState = "needs" | "working" | "ready";

const CHAT_STATE_ORDER: Record<ChatState, number> = { needs: 0, ready: 1, working: 2 };

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const formatDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

/** A person or bot at the 32px row-tile size, round, with 12px initials. */
function RowAvatar(props: Omit<Parameters<typeof ParticipantAvatar>[0], "className">) {
  return <ParticipantAvatar {...props} className="size-8 text-xs" />;
}

function Meta({ children }: { readonly children: string }) {
  return (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

const firstPageOnly = () => null;

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
  const routineChanges = useAtomValue(routineChangesAtom(environmentId ?? ("" as never)));
  const listRoutines = useAtomCommand(routineEnvironment.list, { reportFailure: false });
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

  // Otto: Routines asks the server for the routines that run, or ran, today: the first page.
  const routineList = useListPages({
    view: `${environmentId}:${today}`,
    revision: routineChanges,
    getNextCursor: firstPageOnly,
    fetchPage: async () => {
      if (!environmentId) return null;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

      const result = await listRoutines({
        environmentId,
        input: { runFrom: start.toISOString(), runTo: end.toISOString(), sort: "next" },
      });

      return AsyncResult.isSuccess(result) ? result.value : null;
    },
  });

  const due = currentPersonId ? tasksDue(tasks, currentPersonId, today) : [];
  const routines = routinesToday(routineList.pages[0]?.routines ?? [], today);

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

  const notificationList = useNotifications();
  const { notifications, unread } = notificationList;

  return (
    <WorkPage backdrop={<HomeDither seed={currentPersonId ?? "otto"} />}>
      <WorkspacePageContainer className="gap-10 pt-3 pb-16 sm:pt-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <PageTitle>{title}</PageTitle>
          <p className="text-13px text-muted-foreground">
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        {!loaded || (routineList.status === "loading" && routineList.pages.length === 0) ? (
          <SkeletonTableRows label={t("Loading…")} />
        ) : (
          <div className="flex flex-col gap-10">
            <CustomizeGroup
              title={t("Tasks")}
              count={due.length}
              empty={
                due.length === 0 ? { icon: <RiListCheck3 />, description: t("No tasks") } : null
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
                chats.length === 0 ? { icon: <RiChat1Line />, description: t("No chats") } : null
              }
            >
              {chats.map(({ shell, state }) => (
                <CustomizeRow
                  key={shell.id}
                  logo={<RiChat1Line aria-hidden className="size-4" />}
                  avatar={
                    shell.botId ? (
                      <RowAvatar
                        participant={{ kind: "bot", botId: shell.botId }}
                        bots={participants.allBots}
                      />
                    ) : undefined
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
              title={t("Routines")}
              count={routines.length}
              empty={
                routines.length === 0
                  ? { icon: <RiTimeLine />, description: t("No routines") }
                  : null
              }
            >
              {routines.map((routine) => {
                const bot = { kind: "bot" as const, botId: BotId.make(routine.botId) };
                const at = routineTime(routine, today);

                return (
                  <CustomizeRow
                    key={routine.id}
                    avatar={<RowAvatar participant={bot} bots={participants.allBots} />}
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
                unread > 0 ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost-muted"
                          aria-label={t("Mark all read")}
                          onClick={notificationList.markAllRead}
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
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  notifications={notificationList}
                />
              ))}
            </CustomizeGroup>
          </div>
        )}
      </WorkspacePageContainer>
    </WorkPage>
  );
}
