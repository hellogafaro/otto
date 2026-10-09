import {
  RiChat1Line,
  RiCheckboxCircleLine,
  RiNotification3Line,
  RiQuestionLine,
  RiTimeLine,
} from "@remixicon/react";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { useState } from "react";
import { HomeSection } from "@/components/home-section";
import { HomeWallpaper } from "@/components/home-wallpaper";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { ActorAvatar, statuses } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useChats } from "@/lib/chat-data";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import "@/components/home-page.css";

export function InboxPage() {
  const { api, workspaceId, user } = useWorkspace();
  const cache = useQueryClient();
  const directory = useDirectory();
  const [selectedProject, setSelectedProject] = useState("");
  const projectId = selectedProject || directory.projects[0]?.id;
  const attention = useInfiniteQuery({
    initialPageParam: {
      after: undefined as string | undefined,
      runAfter: undefined as string | undefined,
      questionAfter: undefined as string | undefined,
      operationAfter: undefined as string | undefined,
    },
    queryKey: ["workspace", workspaceId, "attention"],
    queryFn: async ({ pageParam }) =>
      read(
        await api.attention.$get({
          param: { workspaceId },
          query: { limit: "20", ...pageParam },
        }),
      ),
    getNextPageParam: (last, _pages, previous) => {
      if (
        !last.next &&
        typeof last.runs.next !== "string" &&
        !last.questions.next &&
        !last.approvals.next
      )
        return undefined;
      return {
        after: last.next ?? previous.after,
        runAfter:
          typeof last.runs.next === "string"
            ? last.runs.next
            : previous.runAfter,
        questionAfter: last.questions.next ?? previous.questionAfter,
        operationAfter: last.approvals.next ?? previous.operationAfter,
      };
    },
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
  const chatMap = new Map<
    string,
    { chatId: string; title: string; unread: { body: string }[] }
  >();
  const runMap = new Map<
    string,
    {
      id: string;
      chatId: string;
      agentId: string;
      outcome: string | null;
      state: string;
    }
  >();
  const questionMap = new Map<
    string,
    { id: string; runId: string; body: string }
  >();
  const approvalMap = new Map<
    string,
    { id: string; action: string; target: string }
  >();
  for (const page of attention.error ? [] : (attention.data?.pages ?? [])) {
    for (const item of page.items) chatMap.set(item.chatId, item);
    for (const item of page.runs.items)
      runMap.set(item.id, {
        id: item.id,
        chatId: item.chatId,
        agentId: item.agentId,
        outcome: item.outcome,
        state: item.state,
      });
    for (const item of page.questions.items)
      questionMap.set(item.id, {
        id: item.id,
        runId: item.runId,
        body: item.body,
      });
    for (const item of page.approvals.items)
      approvalMap.set(item.id, {
        id: item.id,
        action: item.action,
        target: item.target,
      });
  }
  const unreadChats = [...chatMap.values()];
  const runs = [...runMap.values()];
  const questions = [...questionMap.values()];
  const approvals = [...approvalMap.values()];
  const chats = [
    ...new Map([
      ...unreadChats.map(
        (chat) =>
          [chat.chatId, { id: chat.chatId, title: chat.title }] as const,
      ),
      ...(recentChats.data?.pages.flatMap((page) => page.items) ?? []).map(
        (chat) => [chat.id, chat] as const,
      ),
    ]).values(),
  ].slice(0, 50);
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
            count={
              unreadChats.length +
              runs.length +
              questions.length +
              approvals.length
            }
            pending={attention.isPending}
            error={attention.error}
            retry={() => attention.refetch()}
            empty="Unread chats, run updates, questions and approvals appear here."
            emptyAction={
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/chats" />}
              >
                Open chats
              </Button>
            }
          >
            {unreadChats.map((chat) => (
              <li key={`chat:${chat.chatId}`}>
                <Item
                  size="xs"
                  render={
                    <Link
                      to="/chats/$chatId"
                      params={{ chatId: chat.chatId }}
                    />
                  }
                >
                  <ItemMedia>
                    <RiChat1Line />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{chat.title}</ItemTitle>
                    <ItemDescription>
                      {chat.unread.at(-1)?.body}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <span
                      role="img"
                      aria-label={`${chat.unread.length} unread messages`}
                      className="size-1.5 rounded-full bg-primary"
                    />
                  </ItemActions>
                </Item>
              </li>
            ))}
            {runs.map((run) => (
              <li key={`run:${run.id}`}>
                <Item
                  size="xs"
                  render={
                    <Link to="/chats/$chatId" params={{ chatId: run.chatId }} />
                  }
                >
                  <ItemMedia>
                    <ActorAvatar actorId={run.agentId} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{directory.actorOf(run.agentId).name}</ItemTitle>
                    <ItemDescription>{run.outcome}</ItemDescription>
                  </ItemContent>
                  <ItemActions>{run.state}</ItemActions>
                </Item>
              </li>
            ))}
            {questions.map((question) => (
              <QuestionLink
                key={`question:${question.id}`}
                runId={question.runId}
                body={question.body}
              />
            ))}
            {approvals.map((operation) => (
              <li key={`approval:${operation.id}`}>
                <Item
                  size="xs"
                  render={
                    <Link
                      to="/settings/$section"
                      params={{ section: "connections" }}
                    />
                  }
                >
                  <ItemMedia>
                    <RiTimeLine />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{operation.action}</ItemTitle>
                    <ItemDescription>{operation.target}</ItemDescription>
                  </ItemContent>
                  <ItemActions>Awaiting approval</ItemActions>
                </Item>
              </li>
            ))}
          </HomeSection>
          {attention.hasNextPage && (
            <Button
              variant="outline"
              disabled={attention.isFetchingNextPage}
              onClick={() => attention.fetchNextPage()}
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
            empty="Your open tasks in the selected project appear here."
            emptyAction={
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/tasks" search={{ project: projectId }} />}
              >
                Open tasks
              </Button>
            }
            action={
              !directory.error &&
              directory.projects.length > 0 && (
                <NativeSelect
                  aria-label="Home task project"
                  value={projectId ?? ""}
                  onChange={(event) => {
                    const selected = event.target.value;
                    cache.removeQueries({
                      queryKey: [
                        "workspace",
                        workspaceId,
                        "home-tasks",
                        selected,
                      ],
                    });
                    setSelectedProject(selected);
                  }}
                >
                  {directory.projects.map((project) => (
                    <NativeSelectOption key={project.id} value={project.id}>
                      {project.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )
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
          {directory.projectsQuery.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              disabled={directory.projectsQuery.isFetchingNextPage}
              onClick={() => directory.projectsQuery.fetchNextPage()}
            >
              More projects
            </Button>
          )}
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
            emptyAction={
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/chats" />}
              >
                Open chats
              </Button>
            }
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
                  {chatMap.has(chat.id) && (
                    <ItemActions>
                      <span
                        role="img"
                        aria-label="Unread messages"
                        className="size-1.5 rounded-full bg-primary"
                      />
                    </ItemActions>
                  )}
                </Item>
              </li>
            ))}
          </HomeSection>
          {chats.length > 0 && <Link to="/chats">All chats</Link>}
          <HomeSection
            title="Routines"
            icon={RiTimeLine}
            count={routines.length}
            pending={schedules.isPending}
            error={schedules.error}
            retry={() => schedules.refetch()}
            empty="Your enabled schedules appear here."
            emptyAction={
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/schedules" />}
              >
                Open schedules
              </Button>
            }
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

function QuestionLink({ runId, body }: { runId: string; body: string }) {
  const { api, workspaceId } = useWorkspace();
  const run = useQuery({
    queryKey: ["workspace", workspaceId, "run", runId],
    queryFn: async () =>
      read(await api.runs[":id"].$get({ param: { workspaceId, id: runId } })),
  });
  return (
    <li>
      {run.data && !run.error ? (
        <Item
          size="xs"
          render={
            <Link to="/chats/$chatId" params={{ chatId: run.data.chatId }} />
          }
        >
          <ItemMedia>
            <RiQuestionLine />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{body}</ItemTitle>
          </ItemContent>
        </Item>
      ) : (
        <QueryState
          pending={run.isPending}
          error={run.error}
          retry={() => run.refetch()}
        />
      )}
    </li>
  );
}
