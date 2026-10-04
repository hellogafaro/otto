import {
  RiAddLine,
  RiBarChart2Line,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiSearchLine,
  RiUserFollowLine,
  RiUserLine,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { cn } from "@workspace/ui/lib/utils";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  NoResults,
  omit,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { ListGroup } from "@/components/list-group";
import { mention } from "@/components/mentions";
import { Page } from "@/components/page";
import {
  assigneeLooks,
  ownerLooks,
  People,
  priorities,
  projectLooks,
  shortDate,
  statuses,
  statusOrder,
} from "@/components/task-meta";
import {
  agents,
  tasks as allTasks,
  currentUserId,
  projects,
  type Task,
  type TaskPriority,
  type TaskStatus,
  users,
} from "@/mock/tasks";

// Filters live in the URL; a missing key means any. "me" is the current
// user; assignee also takes "none" (unassigned).
export type TasksSearch = {
  owner?: string;
  assignee?: string;
  project?: string;
  priority?: TaskPriority;
};

const people = { ...users, ...agents };

export function validateTasksSearch(
  search: Record<string, unknown>,
): TasksSearch {
  const pick = (value: unknown, valid: (value: string) => boolean) =>
    typeof value === "string" && valid(value) ? value : undefined;
  return {
    owner: pick(search.owner, (v) => v === "me" || v in users),
    assignee: pick(
      search.assignee,
      (v) => v === "me" || v === "none" || v in people,
    ),
    project: pick(search.project, (v) => v in projects),
    priority: pick(search.priority, (v) => v in priorities) as
      | TaskPriority
      | undefined,
  };
}

const me = (id: string) => (id === "me" ? currentUserId : id);

function matches(task: Task, search: TasksSearch) {
  const assigneeId = task.assigneeAgentId ?? task.assigneeUserId ?? "none";
  return (
    (!search.owner || task.ownerId === me(search.owner)) &&
    (!search.assignee || assigneeId === me(search.assignee)) &&
    (!search.project || task.projectId === search.project) &&
    (!search.priority || task.priority === search.priority)
  );
}

export function TasksPage({ search }: { search: TasksSearch }) {
  const navigate = useNavigate({ from: "/tasks" });
  const openPalette = useCommandPalette();
  const visible = allTasks.filter((task) => matches(task, search));
  const change = (key: keyof TasksSearch, value: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, [key]: value }) });
  const clear = () => navigate({ search: {} });

  // The empty state is only for no tasks at all; filters with no matches keep
  // the page and show a quieter "no results" in the list instead.
  if (allTasks.length === 0) {
    return (
      <EmptyPage
        icon={RiCheckboxCircleLine}
        title="No tasks"
        description="Tasks from you and your agents show up here, grouped by status."
        ask={{
          about: "your tasks",
          action: "New task",
          start: "Add a task to ",
        }}
      />
    );
  }

  return (
    <Page
      title="Tasks"
      width="wide"
      actions={
        <>
          <FilterMenu filters={filterMenus} values={search} onChange={change} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("tasks")}
          />
          <IconAction label="New task" icon={RiAddLine} />
        </>
      }
    >
      <FilterBar
        filters={filterMenus}
        values={search}
        onChange={change}
        onClear={clear}
      />
      {visible.length === 0 ? (
        <NoResults what="tasks" onClear={clear} />
      ) : (
        <TaskGroups tasks={visible} />
      )}
    </Page>
  );
}

// One submenu per property, each with "Any" first.
const filterMenus: FilterDef<keyof TasksSearch>[] = [
  {
    key: "owner",
    label: "Owner",
    icon: RiUserLine,
    people: true,
    options: {
      me: { ...ownerLooks[currentUserId], label: "Me" },
      ...omit(ownerLooks, currentUserId),
    },
  },
  {
    key: "assignee",
    label: "Assignee",
    icon: RiUserFollowLine,
    people: true,
    options: {
      me: { ...assigneeLooks[currentUserId], label: "Me" },
      ...omit(assigneeLooks, currentUserId),
    },
  },
  { key: "project", label: "Project", icon: RiBox3Line, options: projectLooks },
  {
    key: "priority",
    label: "Priority",
    icon: RiBarChart2Line,
    options: priorities,
  },
];

// Tasks grouped by status, in status order. Inside a project the rows leave
// out the project badge.
export function TaskGroups({
  tasks,
  showProject = true,
}: {
  tasks: Task[];
  showProject?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {statusOrder.map((status) => (
        <StatusGroup
          key={status}
          status={status}
          tasks={tasks.filter((task) => task.status === status)}
          showProject={showProject}
        />
      ))}
    </div>
  );
}

// One status's tasks, as a list group.
function StatusGroup({
  status,
  tasks,
  showProject,
}: {
  status: TaskStatus;
  tasks: Task[];
  showProject: boolean;
}) {
  return (
    <ListGroup
      look={statuses[status]}
      count={tasks.length}
      defaultOpen={status !== "done"}
    >
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} showProject={showProject} />
      ))}
    </ListGroup>
  );
}

// Everyone involved, owner first, then the assignee (one today; the group
// already fits several).
function peopleOf(task: Task) {
  const assigneeId = task.assigneeAgentId ?? task.assigneeUserId;
  return [task.ownerId, assigneeId].filter(
    (id, index, all): id is string => !!id && all.indexOf(id) === index,
  );
}

// A task's row; right-click opens the shared item menu (Delete is not wired
// yet).
export function TaskRow({
  task,
  showProject,
  grouped = true,
}: {
  task: Task;
  showProject: boolean;
  /** Under a list group's header (the chevron column); not on Home. */
  grouped?: boolean;
}) {
  const { icon: Icon, className, label } = statuses[task.status];
  const people = peopleOf(task);
  const navigate = useNavigate();
  const ask = useAskAgent();

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <Item
          size="xs"
          render={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
        >
          {/* Chevron column, so the status icon sits under the header's. */}
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
                {projects[task.projectId as keyof typeof projects].title}
              </Badge>
            )}
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {shortDate.format(new Date(task.updatedAt))}
            </span>
          </ItemActions>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ItemMenuItems
          type="task"
          name={task.title}
          onOpen={() =>
            navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
          }
          onAsk={() =>
            ask(`${mention({ type: "task", id: task.id, label: task.title })} `)
          }
          link={`/tasks/${task.id}`}
          onDelete={() => {}}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
