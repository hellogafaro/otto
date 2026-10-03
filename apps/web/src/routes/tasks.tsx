import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowDownSLine,
  RiBarChart2Line,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiFilter3Line,
  RiSearchLine,
  RiUserFollowLine,
  RiUserLine,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AvatarGroup } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@workspace/ui/components/button-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import {
  ActorAvatar,
  actorOf,
  assigneeLooks,
  type Look,
  ownerLooks,
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
  const filtered = Object.values(search).some(Boolean);

  // The empty state is only for no tasks at all; filters with no matches keep
  // the page and show a quieter "no results" in the list instead.
  if (allTasks.length === 0) {
    return (
      <EmptyPage
        icon={RiCheckboxCircleLine}
        title="No tasks"
        description="Tasks from you and your agents show up here, grouped by status."
      >
        <Button size="sm">
          <RiAddLine data-icon="inline-start" />
          New task
        </Button>
      </EmptyPage>
    );
  }

  return (
    <Page
      title="Tasks"
      width="wide"
      actions={
        <>
          <FilterMenu search={search} pressed={filtered} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("tasks")}
          />
          <IconAction label="New task" icon={RiAddLine} />
        </>
      }
    >
      {filtered && <FilterBar search={search} />}
      {visible.length === 0 ? (
        // No results: the empty state's shape, with a non-primary way back.
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RiFilter3Line />
            </EmptyMedia>
            <EmptyTitle>No results</EmptyTitle>
            <EmptyDescription>No tasks match these filters.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ search: {} })}
            >
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {statusOrder.map((status) => (
            <StatusGroup
              key={status}
              status={status}
              tasks={visible.filter((task) => task.status === status)}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

// One submenu per property, each with "Any" first.
const filterMenus: {
  key: keyof TasksSearch;
  label: string;
  icon: RemixiconComponentType;
  options: Record<string, Look>;
}[] = [
  {
    key: "owner",
    label: "Owner",
    icon: RiUserLine,
    options: {
      me: { ...ownerLooks[currentUserId], label: "Me" },
      ...omit(ownerLooks, currentUserId),
    },
  },
  {
    key: "assignee",
    label: "Assignee",
    icon: RiUserFollowLine,
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

function omit<T>(record: Record<string, T>, key: string) {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

// The filter menu, opened from the header's Filter button.
function FilterMenu({
  search,
  pressed,
}: {
  search: TasksSearch;
  pressed?: boolean;
}) {
  const navigate = useNavigate({ from: "/tasks" });

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Filter"
                  aria-pressed={pressed}
                />
              }
            />
          }
        >
          <RiFilter3Line />
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          {filterMenus.map(({ key, label, icon: KeyIcon, options }) => (
            <DropdownMenuSub key={key}>
              <DropdownMenuSubTrigger>
                <KeyIcon />
                {label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuRadioGroup
                  value={search[key] ?? "any"}
                  onValueChange={(value) =>
                    navigate({
                      search: (prev) => ({
                        ...prev,
                        [key]: value === "any" ? undefined : value,
                      }),
                    })
                  }
                >
                  {/* "Any" shows the filter's icon, muted; in people menus it
                      takes the avatars' 20px slot so labels line up. */}
                  <DropdownMenuRadioItem value="any">
                    {key === "owner" || key === "assignee" ? (
                      <span className="flex size-5 items-center justify-center">
                        <KeyIcon className="text-muted-foreground" />
                      </span>
                    ) : (
                      <KeyIcon className="text-muted-foreground" />
                    )}
                    Any
                  </DropdownMenuRadioItem>
                  {Object.entries(options).map(([value, look]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <look.icon className={look.className} />
                      {look.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Active filters, read-only: one 28px group each (what it filters, then ×),
// and Clear on the right. Changing filters happens in the Filter menu.
function FilterBar({ search }: { search: TasksSearch }) {
  const navigate = useNavigate({ from: "/tasks" });
  const remove = (key: keyof TasksSearch) =>
    navigate({ search: (prev) => ({ ...prev, [key]: undefined }) });

  return (
    <div className="-mt-2 flex flex-wrap items-center gap-2">
      {filterMenus
        .filter(({ key }) => search[key])
        .map(({ key, label, icon: KeyIcon, options }) => {
          const look = options[search[key] as string];
          return (
            <ButtonGroup key={key}>
              <ButtonGroupText>
                <KeyIcon className="text-muted-foreground" />
                <span className="text-muted-foreground">{label}</span>
                <look.icon className={look.className} />
                {look.label}
              </ButtonGroupText>
              <Button
                variant="outline"
                size="icon-compact"
                aria-label={`Remove ${label.toLowerCase()} filter`}
                onClick={() => remove(key)}
              >
                <RiCloseLine />
              </Button>
            </ButtonGroup>
          );
        })}
      <Button
        variant="outline"
        size="compact"
        className="ml-auto"
        onClick={() => navigate({ search: {} })}
      >
        Clear
      </Button>
    </div>
  );
}

// Header and rows share one column grid: both have a 1px border and 8px
// padding, the header chevron and the row spacer are 14px wide, and both use
// an 8px gap, so status icons and titles line up without custom offsets.
function StatusGroup({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const { label, icon: Icon, className } = statuses[status];
  if (tasks.length === 0) return null;

  return (
    <Collapsible defaultOpen={status !== "done"}>
      {/* The whole header row toggles the group. */}
      <CollapsibleTrigger
        render={
          <Button
            variant="secondary"
            className="group/trigger w-full justify-start"
          />
        }
      >
        <RiArrowDownSLine className="-rotate-90 text-muted-foreground transition-transform group-data-panel-open/trigger:rotate-0" />
        <Icon className={className} />
        {label}
        <span className="text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col pt-1">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
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

function TaskRow({ task }: { task: Task }) {
  const { icon: Icon, className, label } = statuses[task.status];
  const people = peopleOf(task);

  return (
    <li>
      <Item
        size="xs"
        render={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
      >
        {/* Chevron column, so the status icon sits under the header's. */}
        <span className="size-3.5 shrink-0" aria-hidden />
        <ItemMedia variant="icon">
          <Icon aria-label={label} className={className} />
        </ItemMedia>
        <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-2">
          <ItemTitle
            className={cn(task.status === "done" && "text-muted-foreground")}
          >
            {task.title}
          </ItemTitle>
          <Tooltip>
            <TooltipTrigger
              render={<AvatarGroup />}
              aria-label={people.map((id) => actorOf(id).name).join(", ")}
            >
              {people.map((id) => (
                <ActorAvatar key={id} actorId={id} />
              ))}
            </TooltipTrigger>
            <TooltipContent>
              {people.map((id) => actorOf(id).name).join(", ")}
            </TooltipContent>
          </Tooltip>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline" className="hidden sm:inline-flex">
            <RiBox3Line data-icon="inline-start" />
            {projects[task.projectId as keyof typeof projects].title}
          </Badge>
          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
            {shortDate.format(new Date(task.updatedAt))}
          </span>
        </ItemActions>
      </Item>
    </li>
  );
}
