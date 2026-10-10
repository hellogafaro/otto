import {
  RiAddLine,
  RiArchiveLine,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiSearchLine,
  RiUserFollowLine,
  RiUserLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { toast } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  NoResults,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { IconAction } from "@/components/icon-action";
import { ListGroup } from "@/components/list-group";
import { mention } from "@/components/mentions";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { People, shortDate, statuses } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import {
  type Task,
  type TasksSearch,
  taskStatusOrder,
  useTaskProject,
} from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

export { type TasksSearch, validateTasksSearch } from "@/lib/task-data";

export function TasksPage({ search }: { search: TasksSearch }) {
  const navigate = useNavigate({ from: "/tasks" });
  const { api, workspaceId, user, workspace } = useWorkspace();
  const directory = useDirectory();
  // Tasks are listed within a Project; with none chosen, the first one.
  const projectId = search.project ?? directory.projects[0]?.id;
  const project = useTaskProject(projectId);
  const ask = useAskAgent();
  const openPalette = useCommandPalette();
  const change = (key: keyof TasksSearch, value: string | undefined) =>
    navigate({
      search: (prev) => ({ ...prev, [key]: value, after: undefined }),
    });
  const clear = () => navigate({ search: { project: search.project } });
  const assignee =
    search.assignee === "me" ? `user:${user.id}` : search.assignee;
  const query = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "tasks",
      { ...search, project: projectId },
    ],
    queryFn: async ({ signal }) =>
      read(
        await api.tasks.$get(
          {
            param: { workspaceId },
            query: {
              projectId: projectId ?? "",
              ownerId: search.owner === "me" ? user.id : search.owner,
              assigneeUserId: assignee?.startsWith("user:")
                ? assignee.slice(5)
                : undefined,
              assigneeAgentId: assignee?.startsWith("agent:")
                ? assignee.slice(6)
                : undefined,
              query: search.query,
              status: search.status,
              archived: search.archived,
              sort: search.sort ?? "updatedAt",
              order: search.order ?? "desc",
              after: search.after,
              limit: search.limit ?? "100",
            },
          },
          { init: { signal } },
        ),
      ),
    enabled: Boolean(projectId),
    retry: false,
  });
  const owners = Object.fromEntries(
    project.members.map((person) => [
      person.userId,
      { label: person.name, icon: RiUserLine },
    ]),
  );
  if (search.owner && search.owner !== "me" && !owners[search.owner])
    owners[search.owner] = {
      label: directory.actorOf(search.owner).name,
      icon: RiUserLine,
    };
  const assignees = Object.fromEntries([
    ...project.members.map(
      (person) =>
        [
          `user:${person.userId}`,
          { label: person.name, icon: RiUserLine },
        ] as const,
    ),
    ...directory.agents.map(
      (agent) =>
        [
          `agent:${agent.id}`,
          { label: agent.title, icon: RiUserLine },
        ] as const,
    ),
  ]);
  if (
    search.assignee &&
    search.assignee !== "me" &&
    !assignees[search.assignee]
  )
    assignees[search.assignee] = {
      label: directory.actorOf(
        search.assignee.slice(search.assignee.indexOf(":") + 1),
      ).name,
      icon: RiUserLine,
    };
  const filters: FilterDef<keyof TasksSearch>[] = [
    {
      key: "owner",
      label: "Owner",
      icon: RiUserLine,
      people: true,
      options: { me: { label: "Me", icon: RiUserLine }, ...owners },
    },
    {
      key: "assignee",
      label: "Assignee",
      icon: RiUserFollowLine,
      people: true,
      options: { me: { label: "Me", icon: RiUserLine }, ...assignees },
    },
    {
      key: "status",
      label: "Status",
      icon: RiCheckboxCircleLine,
      options: Object.fromEntries(
        taskStatusOrder.map((status) => [status, statuses[status]]),
      ),
    },
  ];
  const projectOptions = Object.fromEntries(
    directory.projects.map((item) => [item.id, item.title]),
  );
  if (search.project && !projectOptions[search.project])
    projectOptions[search.project] = "Selected project";
  filters.unshift({
    key: "project",
    label: "Project",
    icon: RiBox3Line,
    options: Object.fromEntries(
      Object.entries(projectOptions).map(([id, title]) => [
        id,
        { label: title, icon: RiBox3Line },
      ]),
    ),
  });
  filters.push({
    key: "archived",
    label: "Archive",
    icon: RiArchiveLine,
    options: {
      true: { label: "Archived", icon: RiArchiveLine },
      false: { label: "Active", icon: RiArchiveLine },
    },
  });
  const filtered = Boolean(
    search.owner ||
      search.assignee ||
      search.status ||
      search.query ||
      search.archived === "true" ||
      search.after,
  );
  const canCreate = projectId ? project.canWrite : workspace.role !== "viewer";
  const createStart = projectId
    ? `I want to create a task for ${mention({ type: "project", id: projectId, label: projectOptions[projectId] ?? "Project" })} `
    : "I want to create a task for ";
  if (
    !filtered &&
    !directory.pending &&
    !directory.error &&
    !query.error &&
    !project.query.error &&
    (!projectId || query.data?.items.length === 0)
  ) {
    return (
      <EmptyPage
        icon={RiCheckboxCircleLine}
        title="No tasks"
        description="Tasks from you and your agents show up here, grouped by status."
        ask={
          canCreate
            ? { about: "your tasks", action: "New task", start: createStart }
            : undefined
        }
      />
    );
  }
  return (
    <Page
      title="Tasks"
      width="wide"
      actions={
        <>
          <FilterMenu filters={filters} values={search} onChange={change} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("tasks")}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New task"
            disabled={!canCreate}
            onClick={() => ask(createStart)}
          >
            <RiAddLine />
          </Button>
        </>
      }
    >
      <QueryState
        pending={directory.pending}
        error={directory.error}
        retry={() => {
          void directory.projectsQuery.refetch();
          void directory.membersQuery.refetch();
          void directory.agentsQuery.refetch();
        }}
      />
      <FilterBar
        filters={filters}
        values={search}
        onChange={change}
        onClear={clear}
      />
      {!projectId ? null : (
        <>
          <QueryState
            pending={query.isPending}
            error={query.error ?? project.query.error}
            retry={() => {
              void query.refetch();
              void project.query.refetch();
            }}
          />
          {query.data &&
            !query.error &&
            (query.data.items.length ? (
              <TaskGroups tasks={query.data.items} />
            ) : (
              <NoResults what="tasks" onClear={clear} />
            ))}
          <div className="flex gap-2">
            {search.after && (
              <Button
                variant="outline"
                onClick={() => change("after", undefined)}
              >
                First page
              </Button>
            )}
            {query.data?.next && (
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() =>
                  navigate({
                    search: (prev) => ({
                      ...prev,
                      after: query.data?.next ?? undefined,
                    }),
                  })
                }
              >
                Next page
              </Button>
            )}
          </div>
          {project.query.hasNextPage && (
            <Button
              variant="outline"
              disabled={project.query.isFetchingNextPage}
              onClick={() => project.query.fetchNextPage()}
            >
              Load more project members
            </Button>
          )}
        </>
      )}
    </Page>
  );
}

export function TaskGroups({
  tasks,
  showProject = true,
}: {
  tasks: Task[];
  showProject?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {taskStatusOrder.map((status) => {
        const items = tasks.filter((task) => task.status === status);
        return (
          <ListGroup
            key={status}
            look={statuses[status]}
            count={items.length}
            showEmpty
            defaultOpen={status !== "done"}
          >
            {items.map((task) => (
              <TaskRow key={task.id} task={task} showProject={showProject} />
            ))}
          </ListGroup>
        );
      })}
    </div>
  );
}

export function TaskRow({
  task,
  showProject,
  grouped = true,
}: {
  task: Task;
  showProject: boolean;
  grouped?: boolean;
}) {
  const directory = useDirectory();
  const navigate = useNavigate();
  const ask = useAskAgent();
  const { icon: Icon, className, label } = statuses[task.status];
  const people = [
    ...new Set([
      task.ownerId,
      ...task.assigneeUserIds,
      ...task.assigneeAgentIds,
    ]),
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <Item
          size="xs"
          render={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
        >
          {grouped && <span className="size-3.5 shrink-0" aria-hidden />}
          <ItemMedia variant="icon">
            <Icon aria-label={label} className={className} />
          </ItemMedia>
          <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-2">
            <ItemTitle
              className={cn(task.status === "done" && "text-muted-foreground")}
            >
              {task.title}
            </ItemTitle>
            <People ids={people} />
          </ItemContent>
          <ItemActions>
            {showProject && (
              <Badge variant="outline" className="hidden sm:inline-flex">
                <RiBox3Line data-icon="inline-start" />
                {directory.projects.find(
                  (project) => project.id === task.projectId,
                )?.title ?? "Project"}
              </Badge>
            )}
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {task.updatedAt ? shortDate.format(new Date(task.updatedAt)) : ""}
            </span>
          </ItemActions>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuGroup>
          <ContextMenuItem
            onClick={() =>
              navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
            }
          >
            Open
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              ask(
                `${mention({ type: "task", id: task.id, label: task.title })} `,
              )
            }
          >
            Ask about it
          </ContextMenuItem>
          <ContextMenuItem
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/tasks/${task.id}`,
                );
                toast.success("Link copied");
              } catch {
                toast.error("Unable to copy link");
              }
            }}
          >
            Copy link
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
