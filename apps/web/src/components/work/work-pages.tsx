import {
  BotId,
  GENERAL_PROJECT_ID,
  PROJECT_LIST_SORTS,
  type ProjectListResult,
  type ProjectListSort,
  ProjectListView,
  TASK_LIST_SORTS,
  type TaskListSort,
  type TaskListView,
  WORK_STATUS_ORDER,
  type WorkParticipant,
  type WorkStatus,
  workParticipantKey,
} from "@otto/contracts";
import {
  RiAddLine,
  RiBox3Line,
  RiCalendarLine,
  RiListCheck3,
  RiProgress4Line,
  RiUserLine,
  RiUserStarLine,
} from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { useCreateRequest } from "../../create-request-store";
import { isElectron } from "../../env";
import { useListPages } from "../../hooks/use-list-pages";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { projectEnvironment } from "../../state/projects";
import { useTaskPages } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { localDateKey } from "../../timestamp-format";
import {
  type ListFilter,
  ListFilterBar,
  ListFilterMenu,
  type ListFilterOption,
  ListSortMenu,
} from "../list-toolbar";
import { Button } from "../ui/button";
import { DataGrid } from "../ui/data-grid";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { SkeletonCards, SkeletonTableRows } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer, PageTitle } from "../workspace-page-container";
import { WorkspaceBackButton, WorkspacePageHeader } from "../workspace-page-header";
import type { encodeLibrarySearch } from "../library/library.logic";
import { ProjectCover } from "./project-cover";
import { TasksTable } from "./tasks-table";
import {
  DUE_PRESETS,
  type DuePreset,
  duePresetOf,
  duePresetRange,
  encodeProjectSearch,
  encodeTaskSearch,
  projectStatus,
} from "./work.logic";
import { NewProjectDialog, NewTaskDialog } from "./work-dialogs";
import {
  ParticipantAvatar,
  type WorkParticipants,
  participantName,
  useWorkParticipants,
} from "./work-participants";
import { WorkStatusIcon, useWorkStatusLabel } from "./work-status";

export function useWorkData() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const participants = useWorkParticipants(snapshot ?? null);
  const snapshotProjects = snapshot?.projects;

  const projects = useMemo(
    () =>
      (snapshotProjects ?? []).map((project) =>
        project.id === GENERAL_PROJECT_ID ? { ...project, title: t("No project") } : project,
      ),
    [snapshotProjects, t],
  );

  return {
    environmentId,
    loaded: snapshot !== null && snapshot !== undefined,
    projects,
    groups: snapshot?.groups ?? [],
    currentPersonId: snapshot?.currentPersonId ?? null,
    participants,
  };
}

/**
 * A work page: the top bar holds only a sub page's back button and quiet icon
 * actions, and the content scrolls under it like Settings.
 */
export function WorkPage({
  back,
  leading,
  actions,
  detailsPanelOpen,
  backdrop,
  children,
}: {
  /** A sub page's way back, named after the page it returns to. */
  readonly back?: { readonly label: string; readonly onBack: () => void };
  /** Top-left content when the page has no back button, such as a folder path. */
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  /** Set when the page has a details sidebar, so its toggle never covers the actions. */
  readonly detailsPanelOpen?: boolean;
  /** Otto: Art behind the whole panel, top bar included, that stays put while the page scrolls. */
  readonly backdrop?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col text-foreground">
        {backdrop}
        <WorkspacePageHeader
          electron={isElectron}
          {...(detailsPanelOpen === undefined ? {} : { detailsPanelOpen })}
        >
          <div className="flex min-w-0 flex-1 items-center">
            {back ? <WorkspaceBackButton label={back.label} onBack={back.onBack} /> : leading}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </WorkspacePageHeader>
        <div className="topbar-scroll-fade scrollbar-gutter-both flex min-h-0 flex-1 flex-col overflow-y-auto topbar-scroll-fade-compact">
          {children}
        </div>
      </div>
    </SidebarInset>
  );
}

/** The content column, opening with the page's 22px title. */
export function WorkColumn({
  title,
  children,
}: {
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <WorkspacePageContainer className="gap-10 pt-3 pb-16 sm:pt-4">
      {title ? <PageTitle>{title}</PageTitle> : null}
      {children}
    </WorkspacePageContainer>
  );
}

/** A quiet 28px icon action in the top bar, named by its tooltip. */
export function WorkHeaderAction({
  label,
  icon: Icon,
  onClick,
}: {
  readonly label: string;
  readonly icon: typeof RiAddLine;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="icon-sm" variant="ghost-muted" aria-label={label} onClick={onClick}>
            <Icon aria-hidden className="size-4" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function WorkEmpty({
  icon,
  title,
  description,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </EmptyHeader>
    </Empty>
  );
}

/** A filter matches nothing once something is set; the page then offers to clear it. */
export function NoMatches({
  to,
  search,
}: {
  readonly to: "/tasks" | "/projects" | "/routines" | "/library";
  /** Where clearing lands on that page, such as the Library folder being browsed. */
  readonly search?: ReturnType<typeof encodeLibrarySearch>;
}) {
  const { t } = useI18n();

  return (
    <p className="text-13px text-muted-foreground">
      {t("Nothing matches these filters.")}{" "}
      <Link
        to={to}
        {...(search === undefined ? {} : { search })}
        className="text-foreground underline-offset-2 hover:underline"
      >
        {t("Clear filters")}
      </Link>
    </p>
  );
}

/** Each sort's natural order, the one a fresh list uses. */
const TASK_SORT_ORDER: Record<TaskListSort, "asc" | "desc"> = {
  status: "asc",
  due: "asc",
  updated: "desc",
  created: "desc",
  title: "asc",
};

/** The view with one field set, or left out when it is empty. */
export function withField<View extends object, K extends keyof View>(
  view: View,
  key: K,
  value: View[K] | undefined,
): View {
  const { [key]: _, ...rest } = view;

  // SAFETY: every field of a list view is optional, so leaving one out keeps it a view.
  return (value === undefined ? rest : { ...rest, [key]: value }) as View;
}

/** Every person and bot as a filter choice, each with its avatar. */
function participantOptions(participants: WorkParticipants): ListFilterOption[] {
  return [
    ...participants.people,
    ...participants.bots.map(
      (bot): WorkParticipant => ({ kind: "bot", botId: BotId.make(bot.id) }),
    ),
  ].map((participant) => ({
    value: workParticipantKey(participant),
    label: participantName(participant, participants.allBots),
    icon: (
      <ParticipantAvatar participant={participant} bots={participants.allBots} className="size-4" />
    ),
  }));
}

/** The Status filter: any of the statuses, kept in Linear's order. */
function useStatusFilter(
  selected: readonly WorkStatus[] | undefined,
  onChange: (statuses: readonly WorkStatus[] | undefined) => void,
): ListFilter {
  const { t } = useI18n();
  const statusLabel = useWorkStatusLabel();

  return {
    id: "status",
    label: t("Status"),
    icon: <RiProgress4Line aria-hidden />,
    multiple: true,
    options: WORK_STATUS_ORDER.map((status) => ({
      value: status,
      label: statusLabel(status),
      icon: <WorkStatusIcon status={status} />,
    })),
    selected: selected ?? [],
    ...((selected?.length ?? 0) > 1
      ? { selectedLabel: t("{count} statuses", { count: selected?.length ?? 0 }) }
      : {}),
    onChange: (next) =>
      onChange(
        next.length > 0 ? WORK_STATUS_ORDER.filter((status) => next.includes(status)) : undefined,
      ),
  };
}

const shortDay = (day: string) => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);

  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

/**
 * Otto: Tasks is a bounded server list: the toolbar's filters and sort live in the URL, the
 * server filters and orders in SQL and answers 100 tasks a page, and the table loads the next
 * page as the reader nears the end. Any task change reloads the pages shown.
 */
export function TasksPage({ view }: { readonly view: TaskListView }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { environmentId, loaded, projects, participants } = useWorkData();
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const activeProjects = projects.filter((project) => projectStatus(project) !== "archived");
  const canCreate = environmentId !== null && activeProjects.length > 0;
  const sort = view.sort ?? "status";
  const today = localDateKey(new Date());

  const list = useTaskPages(environmentId, view);
  const rows = list.pages.flatMap((page) => page.tasks);
  const filtered = Object.keys(view).some((key) => key !== "sort" && key !== "order");

  const setView = (next: TaskListView) =>
    void navigate({ to: "/tasks", search: encodeTaskSearch(next), replace: true });

  const peopleOptions = participantOptions(participants);

  const statusFilter = useStatusFilter(view.status, (status) =>
    setView(withField(view, "status", status)),
  );

  const duePreset = duePresetOf(view, today);

  const dueLabels: Record<DuePreset, string> = {
    overdue: t("Overdue"),
    today: t("Due today"),
    week: t("Due this week"),
  };

  const filters: ListFilter[] = [
    statusFilter,
    {
      id: "owner",
      label: t("Owner"),
      icon: <RiUserStarLine aria-hidden />,
      multiple: false,
      options: peopleOptions,
      selected: view.owner ? [view.owner] : [],
      onChange: ([owner]) => setView(withField(view, "owner", owner)),
    },
    {
      id: "assignee",
      label: t("Assignee"),
      icon: <RiUserLine aria-hidden />,
      multiple: false,
      options: peopleOptions,
      selected: view.assignee ? [view.assignee] : [],
      onChange: ([assignee]) => setView(withField(view, "assignee", assignee)),
    },
    {
      id: "project",
      label: t("Project"),
      icon: <RiBox3Line aria-hidden />,
      multiple: false,
      options: projects.map((project) => ({ value: project.id, label: project.title })),
      selected: view.project ? [view.project] : [],
      onChange: ([project]) =>
        setView(
          withField(view, "project", projects.find((candidate) => candidate.id === project)?.id),
        ),
    },
    {
      id: "due",
      label: t("Due date"),
      icon: <RiCalendarLine aria-hidden />,
      multiple: false,
      options: DUE_PRESETS.map((preset) => ({ value: preset, label: dueLabels[preset] })),
      selected:
        duePreset !== undefined
          ? [duePreset]
          : view.dueFrom !== undefined || view.dueTo !== undefined
            ? ["range"]
            : [],
      ...(duePreset === undefined && (view.dueFrom !== undefined || view.dueTo !== undefined)
        ? {
            selectedLabel: [view.dueFrom, view.dueTo]
              .map((day) => (day === undefined ? "…" : shortDay(day)))
              .join(" – "),
          }
        : {}),
      onChange: ([preset]) => {
        const range = DUE_PRESETS.find((candidate) => candidate === preset);
        const rest = withField(withField(view, "dueFrom", undefined), "dueTo", undefined);

        setView(range === undefined ? rest : { ...rest, ...duePresetRange(range, today) });
      },
    },
  ];

  const sortLabels: Record<TaskListSort, string> = {
    status: t("Status"),
    due: t("Due date"),
    updated: t("Last updated"),
    created: t("Created"),
    title: t("Title"),
  };

  // Otto: Tasks need a project, so with none yet New starts the first project instead.
  const openNewTask = useCallback(
    () => (canCreate ? setTaskDialogOpen(true) : setProjectDialogOpen(true)),
    [canCreate],
  );

  useCreateRequest("task", loaded && environmentId !== null, openNewTask);

  const pageActions = useMemo(
    (): PageAction[] =>
      environmentId
        ? [
            {
              id: "new-task",
              title: t("New task"),
              icon: RiAddLine,
              searchTerms: ["new task", "create", "add", "todo"],
              shortcutCommand: "item.new",
              run: openNewTask,
            },
          ]
        : [],
    [environmentId, openNewTask, t],
  );

  usePageActions(t("Tasks"), pageActions);

  return (
    <WorkPage
      actions={
        rows.length > 0 || filtered ? (
          <>
            <ListFilterMenu filters={filters} />
            <ListSortMenu
              sort={{
                options: TASK_LIST_SORTS.map((value) => ({ value, label: sortLabels[value] })),
                value: sort,
                order: view.order ?? TASK_SORT_ORDER[sort],
                onChange: (nextSort, order) =>
                  setView(
                    withField(
                      withField(view, "sort", nextSort === "status" ? undefined : nextSort),
                      "order",
                      order === TASK_SORT_ORDER[nextSort] ? undefined : order,
                    ),
                  ),
              }}
            />
            {canCreate ? (
              <WorkHeaderAction
                label={t("New task")}
                icon={RiAddLine}
                onClick={() => setTaskDialogOpen(true)}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {!loaded || (list.status === "loading" && rows.length === 0) ? (
        <WorkColumn title={t("Tasks")}>
          <SkeletonTableRows label={t("Loading tasks…")} />
        </WorkColumn>
      ) : !filtered && list.status !== "error" && rows.length === 0 ? (
        <WorkEmpty
          icon={<RiListCheck3 />}
          title={t("Keep every job in one place")}
          description={t(
            "See what people and bots are working on, who owns each task, and when it is due.",
          )}
          action={
            canCreate ? (
              <Button onClick={() => setTaskDialogOpen(true)}>
                <RiAddLine />
                {t("New task")}
              </Button>
            ) : environmentId ? (
              <Button onClick={() => setProjectDialogOpen(true)}>
                <RiAddLine />
                {t("New project")}
              </Button>
            ) : null
          }
        />
      ) : (
        <WorkColumn title={t("Tasks")}>
          <div className="flex flex-col gap-3">
            <ListFilterBar
              filters={filters}
              onClear={() =>
                setView({
                  ...(view.sort === undefined ? {} : { sort: view.sort }),
                  ...(view.order === undefined ? {} : { order: view.order }),
                })
              }
            />
            {list.status === "error" && rows.length === 0 ? (
              <p className="text-13px text-muted-foreground">{t("Tasks couldn't be loaded.")}</p>
            ) : rows.length === 0 ? (
              <NoMatches to="/tasks" />
            ) : (
              <TasksTable
                tasks={rows}
                projects={projects}
                bots={participants.allBots}
                showProject={view.project === undefined}
                grouped={sort === "status"}
                statusCounts={list.pages.at(-1)?.statusCounts ?? []}
                paging={{
                  hasMore: list.hasMore,
                  loading: list.status !== "ready",
                  onLoadMore: list.loadMore,
                }}
                onOpenTask={(task) =>
                  void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
                }
              />
            )}
          </div>
        </WorkColumn>
      )}
      {environmentId ? (
        <>
          <NewTaskDialog
            open={taskDialogOpen}
            onOpenChange={setTaskDialogOpen}
            environmentId={environmentId}
            defaultProjectId={view.project ?? null}
            projects={activeProjects}
            participants={participants}
          />
          <NewProjectDialog
            open={projectDialogOpen}
            onOpenChange={setProjectDialogOpen}
            environmentId={environmentId}
            participants={participants}
            onCreated={(projectId) =>
              void navigate({ to: "/projects/$projectId", params: { projectId } })
            }
          />
        </>
      ) : null}
    </WorkPage>
  );
}

/** Each project sort's natural order, the one a fresh list uses. */
const PROJECT_SORT_ORDER: Record<ProjectListSort, "asc" | "desc"> = {
  updated: "desc",
  created: "desc",
  title: "asc",
};

const encodeProjectView = Schema.encodeSync(Schema.fromJsonString(ProjectListView));

const nextProjectCursor = (page: ProjectListResult) => page.nextCursor;

/**
 * Otto: Projects is a bounded server list like Tasks: filters and sort live in the URL, the
 * server answers 100 projects a page, and the card grid loads the next page as the reader nears
 * the end. Any project change reloads the pages shown.
 */
export function ProjectsPage({ view }: { readonly view: ProjectListView }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const statusLabel = useWorkStatusLabel();
  const { environmentId, loaded, participants, projects } = useWorkData();
  const listProjects = useAtomCommand(projectEnvironment.list, { reportFailure: false });
  const [dialogOpen, setDialogOpen] = useState(false);
  const sort = view.sort ?? "updated";

  const list = useListPages({
    view: `${environmentId}:${encodeProjectView(view)}`,
    revision: projects,
    getNextCursor: nextProjectCursor,
    fetchPage: async (cursor) => {
      if (!environmentId) return null;

      const result = await listProjects({
        environmentId,
        input: cursor === undefined ? view : { ...view, cursor },
      });

      return AsyncResult.isSuccess(result) ? result.value : null;
    },
  });

  const rows = list.pages.flatMap((page) => page.projects);
  const filtered = Object.keys(view).some((key) => key !== "sort" && key !== "order");

  const setView = (next: ProjectListView) =>
    void navigate({ to: "/projects", search: encodeProjectSearch(next), replace: true });

  const statusFilter = useStatusFilter(view.status, (status) =>
    setView(withField(view, "status", status)),
  );

  const filters: ListFilter[] = [
    statusFilter,
    {
      id: "owner",
      label: t("Owner"),
      icon: <RiUserStarLine aria-hidden />,
      multiple: false,
      options: participantOptions(participants),
      selected: view.owner ? [view.owner] : [],
      onChange: ([owner]) => setView(withField(view, "owner", owner)),
    },
  ];

  const sortLabels: Record<ProjectListSort, string> = {
    updated: t("Last updated"),
    created: t("Created"),
    title: t("Title"),
  };

  const openNewProject = useCallback(() => setDialogOpen(true), []);

  useCreateRequest("project", loaded && environmentId !== null, openNewProject);

  const pageActions = useMemo(
    (): PageAction[] =>
      environmentId
        ? [
            {
              id: "new-project",
              title: t("New project"),
              icon: RiAddLine,
              searchTerms: ["new project", "create", "add"],
              shortcutCommand: "item.new",
              run: openNewProject,
            },
          ]
        : [],
    [environmentId, openNewProject, t],
  );

  usePageActions(t("Projects"), pageActions);

  return (
    <WorkPage
      actions={
        rows.length > 0 || filtered ? (
          <>
            <ListFilterMenu filters={filters} />
            <ListSortMenu
              sort={{
                options: PROJECT_LIST_SORTS.map((value) => ({ value, label: sortLabels[value] })),
                value: sort,
                order: view.order ?? PROJECT_SORT_ORDER[sort],
                onChange: (nextSort, order) =>
                  setView(
                    withField(
                      withField(view, "sort", nextSort === "updated" ? undefined : nextSort),
                      "order",
                      order === PROJECT_SORT_ORDER[nextSort] ? undefined : order,
                    ),
                  ),
              }}
            />
            {environmentId ? (
              <WorkHeaderAction
                label={t("New project")}
                icon={RiAddLine}
                onClick={() => setDialogOpen(true)}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {!loaded || (list.status === "loading" && rows.length === 0) ? (
        <WorkColumn title={t("Projects")}>
          <SkeletonCards label={t("Loading projects…")} />
        </WorkColumn>
      ) : !filtered && list.status !== "error" && rows.length === 0 ? (
        <WorkEmpty
          icon={<RiBox3Line />}
          title={t("Plan work around an outcome")}
          description={t(
            "Group related tasks under a project with an owner, links, and a status everyone can see.",
          )}
          action={
            environmentId ? (
              <Button onClick={() => setDialogOpen(true)}>
                <RiAddLine />
                {t("New project")}
              </Button>
            ) : null
          }
        />
      ) : (
        <WorkColumn title={t("Projects")}>
          <div className="flex flex-col gap-3">
            <ListFilterBar
              filters={filters}
              onClear={() =>
                setView({
                  ...(view.sort === undefined ? {} : { sort: view.sort }),
                  ...(view.order === undefined ? {} : { order: view.order }),
                })
              }
            />
            {list.status === "error" && rows.length === 0 ? (
              <p className="text-13px text-muted-foreground">{t("Projects couldn't be loaded.")}</p>
            ) : rows.length === 0 ? (
              <NoMatches to="/projects" />
            ) : (
              <DataGrid
                items={rows}
                getItemKey={(project) => project.id}
                paging={{
                  hasMore: list.hasMore,
                  loading: list.status !== "ready",
                  onLoadMore: list.loadMore,
                }}
                renderItem={(project) => (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="group flex flex-col gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="overflow-hidden rounded-lg border border-border transition-shadow group-hover:shadow-md">
                      {environmentId ? (
                        <ProjectCover environmentId={environmentId} project={project} />
                      ) : null}
                    </div>
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                      <WorkStatusIcon status={project.status} />
                      <span className="sr-only">{statusLabel(project.status)}: </span>
                      <span className="truncate">{project.title}</span>
                    </span>
                  </Link>
                )}
              />
            )}
          </div>
        </WorkColumn>
      )}
      {environmentId ? (
        <NewProjectDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          environmentId={environmentId}
          participants={participants}
          onCreated={(projectId) =>
            void navigate({ to: "/projects/$projectId", params: { projectId } })
          }
        />
      ) : null}
    </WorkPage>
  );
}
