import {
  RiChat1Line,
  RiCheckboxCircleLine,
  RiNotification3Line,
  RiTimeLine,
} from "@remixicon/react";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { HomeSection } from "@/components/home-section";
import { HomeWallpaper } from "@/components/home-wallpaper";
import { MentionText } from "@/components/mentions";
import { Page } from "@/components/page";
import { ActorAvatar, statuses } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useChats } from "@/lib/chat-data";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import "@/components/home-page.css";

export function InboxPage() {
  const { api, workspaceId, user } = useWorkspace();
  const directory = useDirectory();
  const project = directory.projects[0];
  const projectId = project?.id;
  const notifications = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryKey: ["workspace", workspaceId, "task-notifications", user.id],
    queryFn: async ({ pageParam }) =>
      read(
        await api["task-notifications"].$get({
          param: { workspaceId },
          query: { limit: "20", after: pageParam },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 10_000,
  });
  const taskQueries = useQueries({
    queries: (["todo", "doing"] as const).flatMap((status) =>
      (["owner", "assignee"] as const).map((role) => ({
        queryKey: [
          "workspace",
          workspaceId,
          "home-tasks",
          projectId,
          status,
          role,
          user.id,
        ],
        enabled: Boolean(projectId),
        queryFn: async () =>
          read(
            await api.tasks.$get({
              param: { workspaceId },
              query: {
                projectId: projectId ?? "",
                status,
                archived: "false",
                ...(role === "owner"
                  ? { ownerId: user.id }
                  : { assigneeUserId: user.id }),
                limit: "20",
                sort: "dueAt",
                order: "asc",
              },
            }),
          ),
        refetchInterval: 10_000,
      })),
    ),
  });
  const recentChats = useChats({ archived: "false" });
  const schedules = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "home-schedules"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.schedules.$get({
          param: { workspaceId },
          query: {
            status: "enabled",
            limit: "20",
            sort: "updatedAt",
            order: "desc",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 10_000,
  });
  const tasks = [
    ...new Map(
      taskQueries
        .flatMap((result) => result.data?.items ?? [])
        .map((task) => [task.id, task]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
        Date.parse(b.updatedAt ?? b.createdAt ?? "") -
          Date.parse(a.updatedAt ?? a.createdAt ?? ""),
    )
    .slice(0, 50);
  const hours = new Date().getHours();
  const name = user.name.trim().split(/\s+/)[0];
  const part =
    hours >= 5 && hours < 12
      ? "morning"
      : hours < 18 && hours >= 12
        ? "afternoon"
        : "evening";
  const greeting = `Good ${part}${name && !name.includes("@") ? `, ${name}` : ""}`;
  const comments = notifications.error
    ? []
    : [
        ...new Map(
          (notifications.data?.pages.flatMap((page) => page.items) ?? []).map(
            (comment) => [comment.id, comment],
          ),
        ).values(),
      ];
  const chats =
    recentChats.data?.pages.flatMap((page) => page.items).slice(0, 50) ?? [];
  const routines = schedules.data?.pages.flatMap((page) => page.items) ?? [];
  const taskFailure = taskQueries.find((result) => result.error);

  return (
    <div className="home-page">
      <HomeWallpaper />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Page title={greeting} centered>
          <HomeSection
            title="Notifications"
            icon={RiNotification3Line}
            count={comments.length}
            pending={notifications.isPending}
            error={notifications.error}
            retry={() => notifications.refetch()}
            empty="Mentions and comments on tasks you own appear here."
          >
            {comments.map((comment) => (
              <li key={comment.id}>
                <Item
                  size="xs"
                  render={
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: comment.taskId }}
                    />
                  }
                >
                  <ItemMedia>
                    <ActorAvatar
                      actorId={comment.agentId ?? comment.createdBy}
                    />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{comment.title}</ItemTitle>
                    <ItemDescription>
                      {
                        directory.actorOf(comment.agentId ?? comment.createdBy)
                          .name
                      }
                      {comment.mentioned ? " mentioned you: " : " commented: "}
                      <MentionText text={comment.body} />
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </HomeSection>
          {notifications.hasNextPage && (
            <Button
              variant="outline"
              disabled={notifications.isFetchingNextPage}
              onClick={() => notifications.fetchNextPage()}
            >
              More notifications
            </Button>
          )}
          <HomeSection
            title="Tasks"
            icon={RiCheckboxCircleLine}
            count={tasks.length}
            pending={
              directory.pending ||
              Boolean(
                projectId && taskQueries.some((result) => result.isPending),
              )
            }
            error={directory.error ?? taskFailure?.error}
            retry={() => {
              void directory.projectsQuery.refetch();
              for (const query of taskQueries)
                if (projectId) void query.refetch();
            }}
            empty={
              project
                ? `Your open tasks in ${project.title} appear here.`
                : "Your open tasks appear here."
            }
          >
            {tasks.map((task) => {
              const status = statuses[task.status];
              return (
                <li key={task.id}>
                  <Item
                    size="xs"
                    render={
                      <Link to="/tasks/$taskId" params={{ taskId: task.id }} />
                    }
                  >
                    <ItemMedia>
                      <status.icon className={status.className} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{task.title}</ItemTitle>
                    </ItemContent>
                    {task.dueAt && (
                      <ItemActions>
                        <time dateTime={task.dueAt}>
                          {new Date(task.dueAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </ItemActions>
                    )}
                  </Item>
                </li>
              );
            })}
          </HomeSection>
          {tasks.length > 0 && (
            <Link to="/tasks" search={{ project: projectId }}>
              All tasks in this project
            </Link>
          )}
          <HomeSection
            title="Chats"
            icon={RiChat1Line}
            count={chats.length}
            pending={recentChats.isPending}
            error={recentChats.error}
            retry={() => recentChats.refetch()}
            empty="Your recent conversations appear here."
          >
            {chats.map((chat) => (
              <li key={chat.id}>
                <Item
                  size="xs"
                  render={
                    <Link to="/chats/$chatId" params={{ chatId: chat.id }} />
                  }
                >
                  <ItemMedia>
                    <RiChat1Line />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{chat.title}</ItemTitle>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </HomeSection>
          <HomeSection
            title="Routines"
            icon={RiTimeLine}
            count={routines.length}
            pending={schedules.isPending}
            error={schedules.error}
            retry={() => schedules.refetch()}
            empty="Your enabled schedules appear here."
          >
            {routines.map((routine) => (
              <li key={routine.id}>
                <Item
                  size="xs"
                  render={
                    <Link
                      to="/schedules/$scheduleId"
                      params={{ scheduleId: routine.id }}
                    />
                  }
                >
                  <ItemMedia>
                    <RiTimeLine />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{routine.title}</ItemTitle>
                    <ItemDescription>
                      {routine.cron
                        ? `${routine.cron} · ${routine.timezone}`
                        : "Manual trigger"}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </HomeSection>
          {schedules.hasNextPage && (
            <Button
              variant="outline"
              disabled={schedules.isFetchingNextPage}
              onClick={() => schedules.fetchNextPage()}
            >
              More routines
            </Button>
          )}
        </Page>
      </div>
    </div>
  );
}
