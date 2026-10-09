import { RiChat1Line, RiInboxLine, RiTimeLine } from "@remixicon/react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { type ReactNode, useState } from "react";
import { EmptyPage } from "@/components/empty-page";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { ActorAvatar, Count, statuses } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

// Home composes saved attention and bounded, explicitly Project-scoped Task previews.
export function InboxPage() {
  const { api, workspaceId, user } = useWorkspace();
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
      // Exhausted groups keep their final request cursor; they never restart while another group continues.
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
          "inbox-tasks",
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
                ...(role === "owner"
                  ? { ownerId: user.id }
                  : { assigneeUserId: user.id }),
                limit: "5",
                sort: "updatedAt",
                order: "desc",
              },
            }),
          ),
      })),
    ),
  });
  const tasks = [
    ...new Map(
      taskQueries
        .flatMap((result) => result.data?.items ?? [])
        .map((task) => [task.id, task]),
    ).values(),
  ];
  const hours = new Date().getHours();
  const greeting = `Good ${hours < 12 ? "morning" : hours < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`;
  if (attention.isPending || directory.pending) return <QueryState pending />;
  if (attention.error || directory.error)
    return (
      <QueryState
        error={attention.error ?? directory.error}
        retry={() => {
          void attention.refetch();
          void directory.membersQuery.refetch();
          void directory.agentsQuery.refetch();
          void directory.projectsQuery.refetch();
        }}
      />
    );
  // Iterate the bounded projections without spreading the recursive Run response into generic inference.
  const chatMap = new Map<
    string,
    {
      chatId: string;
      title: string;
      unread: { body: string }[];
    }
  >();
  for (const page of attention.data.pages)
    for (const item of page.items) chatMap.set(item.chatId, item);
  const chats = Array.from(chatMap.values());
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
  for (const page of attention.data.pages) {
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
  const runs = Array.from(runMap.values());
  const questions = Array.from(questionMap.values());
  const approvals = Array.from(approvalMap.values());
  const taskFailure = taskQueries.find((result) => result.error);
  if (
    !directory.projects.length &&
    !chats.length &&
    !runs.length &&
    !questions.length &&
    !approvals.length &&
    !attention.hasNextPage
  )
    return (
      <EmptyPage
        icon={RiInboxLine}
        title="Nothing needs you"
        description="Tasks, chats, questions and approvals waiting on you show up here."
      />
    );
  return (
    <Page title={greeting} centered>
      {directory.projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Your tasks in</span>
          <NativeSelect
            aria-label="Inbox project"
            value={projectId ?? ""}
            onChange={(event) => setSelectedProject(event.target.value)}
          >
            {directory.projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {directory.projectsQuery.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => directory.projectsQuery.fetchNextPage()}
            >
              More projects
            </Button>
          )}
        </div>
      )}
      <QueryState
        pending={taskQueries.some((result) => result.isFetching)}
        error={taskFailure?.error}
        retry={() => taskFailure?.refetch()}
      />
      <Section title="Tasks" count={tasks.length}>
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
                <ItemActions>
                  <ActorAvatar actorId={task.ownerId} />
                </ItemActions>
              </Item>
            </li>
          );
        })}
      </Section>
      {projectId && (
        <Link to="/tasks" search={{ project: projectId }}>
          All tasks in this project
        </Link>
      )}
      <Section title="Unread chats" count={chats.length}>
        {chats.map((chat) => (
          <li key={chat.chatId}>
            <Item
              size="xs"
              render={
                <Link to="/chats/$chatId" params={{ chatId: chat.chatId }} />
              }
            >
              <ItemMedia>
                <RiChat1Line />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{chat.title}</ItemTitle>
                <p>{chat.unread.at(-1)?.body}</p>
              </ItemContent>
              <ItemActions>{chat.unread.length}</ItemActions>
            </Item>
          </li>
        ))}
      </Section>

      <Section title="Runs" count={runs.length}>
        {runs.map((run) => (
          <li key={run.id}>
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
                <p>{run.outcome}</p>
              </ItemContent>
              <ItemActions>{run.state}</ItemActions>
            </Item>
          </li>
        ))}
      </Section>
      <Section title="Questions" count={questions.length}>
        {questions.map((question) => (
          <QuestionLink
            key={question.id}
            runId={question.runId}
            body={question.body}
          />
        ))}
      </Section>
      <Section title="Approvals" count={approvals.length}>
        {approvals.map((operation) => (
          <li key={operation.id}>
            <Item size="xs" render={<a href="/settings/connections" />}>
              <ItemMedia>
                <RiTimeLine />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{operation.action}</ItemTitle>
                <p>{operation.target}</p>
              </ItemContent>
              <ItemActions>Awaiting approval</ItemActions>
            </Item>
          </li>
        ))}
      </Section>
      {attention.hasNextPage && (
        <Button
          variant="outline"
          disabled={attention.isFetchingNextPage}
          onClick={() => attention.fetchNextPage()}
        >
          More attention items
        </Button>
      )}
    </Page>
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
      {run.data ? (
        <Item
          size="xs"
          render={
            <Link to="/chats/$chatId" params={{ chatId: run.data.chatId }} />
          }
        >
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

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-base font-medium">
        {title}
        <Count>{count}</Count>
      </h2>
      <ul className="-mx-[9px] flex flex-col">{children}</ul>
    </section>
  );
}
