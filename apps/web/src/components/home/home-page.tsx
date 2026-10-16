import { scopedThreadKey, scopeThreadRef } from "@otto/client-runtime/environment";
import type { EnvironmentThreadShell } from "@otto/client-runtime/state/shell";
import {
  BotId,
  type EnvironmentId,
  type Notification,
  type NotificationType,
  type OrchestrationTask,
  type Routine,
  type WorkParticipant,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { RiCheckDoubleLine } from "@remixicon/react";
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
import { StatusIcon } from "../status-icon";
import { DataTable, DataTableChip, type DataTableColumn } from "../ui/data-table";
import type { Bot } from "../roster/types";
import { SkeletonTableRows } from "../ui/skeleton";
import { WorkspacePageContainer, PageTitle } from "../workspace-page-container";
import { TasksTable } from "../work/tasks-table";
import { ParticipantAvatar, participantName } from "../work/work-participants";
import { WorkHeaderAction, WorkPage, useWorkData } from "../work/work-pages";
import { pickGreeting, routinesToday, routineTime, tasksDue } from "./home.logic";

type ChatState = "needs" | "working" | "ready";

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

type ChatRow = { readonly shell: EnvironmentThreadShell; readonly state: ChatState };

function chatColumns(bots: readonly Bot[]): DataTableColumn<ChatRow>[] {
  return [
    {
      id: "title",
      type: "title",
      cell: ({ shell }) => shell.title,
      after: ({ shell }) =>
        shell.botId ? (
          <ParticipantAvatar participant={{ kind: "bot", botId: shell.botId }} bots={bots} />
        ) : null,
    },
    {
      id: "updated",
      type: "time",
      cell: ({ shell }) => formatRelativeTimeLabel(shell.updatedAt),
    },
  ];
}

function routineColumns(bots: readonly Bot[], today: string): DataTableColumn<Routine>[] {
  return [
    {
      id: "title",
      type: "title",
      cell: (routine) => routine.job,
      after: (routine) => (
        <ParticipantAvatar
          participant={{ kind: "bot", botId: BotId.make(routine.botId) }}
          bots={bots}
        />
      ),
    },
    {
      id: "time",
      type: "chips",
      cell: (routine) => {
        const at = routineTime(routine, today);

        return at ? <DataTableChip>{timeOfDay(at)}</DataTableChip> : null;
      },
    },
  ];
}

function notificationColumns({
  bots,
  text,
  actor,
}: {
  readonly bots: readonly Bot[];
  readonly text: (notification: Notification) => string;
  readonly actor: (notification: Notification) => WorkParticipant | null;
}): DataTableColumn<Notification>[] {
  return [
    {
      id: "unread",
      type: "icon",
      cell: (notification) =>
        notification.readAt === null ? <span className="size-1.5 rounded-full bg-primary" /> : null,
    },
    {
      id: "title",
      type: "title",
      cell: text,
      after: (notification) => {
        const who = actor(notification);

        return who ? <ParticipantAvatar participant={who} bots={bots} /> : null;
      },
    },
    {
      id: "created",
      type: "time",
      cell: (notification) => formatRelativeTimeLabel(notification.createdAt),
    },
  ];
}

/**
 * Otto: Home, where a person lands: a greeting, then what needs them today. Their tasks due today
 * or overdue, the chats that need them, are working or have a reply they haven't seen, today's
 * routines and their notifications, each on the shared table's bands. Empty bands step aside.
 */
export function HomePage() {
  const i18n = useI18n();
  const { t } = i18n;
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
    .toSorted((left, right) => right.shell.updatedAt.localeCompare(left.shell.updatedAt));

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

  const notificationText = (notification: Notification) => {
    const who = actor(notification);

    return t(NOTIFICATION_TEXT[notification.type], {
      name: who ? participantName(who, participants.allBots) : t("Someone"),
      title: notification.title,
    });
  };

  const openNotification = (notification: Notification) => {
    if (environmentId && notification.readAt === null) void read(environmentId, [notification.id]);

    if (notification.entityType === "task") {
      void navigate({ to: "/tasks/$taskId", params: { taskId: notification.entityId } });

      return;
    }

    void navigate({ to: "/chats/$threadId", params: { threadId: notification.entityId } });
  };

  const openTask = (task: OrchestrationTask) =>
    void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });

  const nothing =
    due.length === 0 && chats.length === 0 && routines.length === 0 && notifications.length === 0;

  return (
    <WorkPage
      actions={
        environmentId && unread > 0 ? (
          <WorkHeaderAction
            label={t("Mark all read")}
            icon={RiCheckDoubleLine}
            onClick={() => void read(environmentId)}
          />
        ) : null
      }
    >
      <WorkspacePageContainer className="gap-10 pt-3 pb-16 sm:pt-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <PageTitle>{title}</PageTitle>
          <p className="text-13px text-muted-foreground">
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        {!loaded ? (
          <SkeletonTableRows label={t("Loading…")} />
        ) : nothing ? (
          <p className="text-center text-13px text-muted-foreground">
            {t("Nothing needs you right now.")}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {due.length > 0 ? (
              <TasksTable
                tasks={due}
                projects={projects}
                bots={participants.allBots}
                showProject
                onOpenTask={openTask}
                groupBy={{
                  groups: [
                    {
                      id: "overdue",
                      label: t("Overdue"),
                      icon: <StatusIcon status="error" />,
                    },
                    { id: "today", label: t("Due today"), icon: <StatusIcon status="pending" /> },
                  ],
                  getGroupId: (task) => (task.dueDate === today ? "today" : "overdue"),
                }}
              />
            ) : null}
            {chats.length > 0 ? (
              <DataTable
                rows={chats}
                columns={chatColumns(participants.allBots)}
                getRowKey={({ shell }) => shell.id}
                getRowLabel={({ shell }) => shell.title}
                onRowClick={({ shell }) =>
                  void navigate({ to: "/chats/$threadId", params: { threadId: shell.id } })
                }
                groupBy={{
                  groups: [
                    {
                      id: "needs",
                      label: t("Chats waiting on you"),
                      icon: <StatusIcon status="waiting" />,
                    },
                    {
                      id: "ready",
                      label: t("New replies"),
                      icon: <StatusIcon status="completed" />,
                    },
                    {
                      id: "working",
                      label: t("Bots working"),
                      icon: <StatusIcon status="in_progress" />,
                    },
                  ],
                  getGroupId: ({ state }) => state,
                }}
              />
            ) : null}
            {routines.length > 0 ? (
              <DataTable
                rows={routines}
                columns={routineColumns(participants.allBots, today)}
                getRowKey={(routine) => routine.id}
                getRowLabel={(routine) => routine.job}
                onRowClick={(routine) =>
                  void navigate({ to: "/routines/$routineId", params: { routineId: routine.id } })
                }
                groupBy={{
                  groups: [
                    {
                      id: "today",
                      label: t("Routines today"),
                      icon: <StatusIcon status="pending" />,
                    },
                  ],
                  getGroupId: () => "today",
                }}
              />
            ) : null}
            {notifications.length > 0 ? (
              <DataTable
                rows={notifications}
                columns={notificationColumns({
                  bots: participants.allBots,
                  text: notificationText,
                  actor,
                })}
                getRowKey={(notification) => notification.id}
                getRowLabel={notificationText}
                onRowClick={openNotification}
                groupBy={{
                  groups: [{ id: "all", label: t("Notifications") }],
                  getGroupId: () => "all",
                }}
              />
            ) : null}
          </div>
        )}
      </WorkspacePageContainer>
    </WorkPage>
  );
}
