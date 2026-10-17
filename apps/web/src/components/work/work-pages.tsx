import {
  GENERAL_PROJECT_ID,
  type OrchestrationTask,
  type ProjectListFilter,
  type TaskListFilter,
  matchesProjectFilter,
  matchesTaskFilter,
} from "@otto/contracts";
import { RiAddLine, RiBox3Line, RiListCheck3 } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { environmentTasksAtom } from "../../state/tasks";
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
import { ProjectCover } from "./project-cover";
import { TasksTable } from "./tasks-table";
import { projectStatus, sortTasks } from "./work.logic";
import { NewProjectDialog, NewTaskDialog } from "./work-dialogs";
import { useWorkParticipants } from "./work-participants";
import { WorkStatusIcon, useWorkStatusLabel } from "./work-status";

const EMPTY_TASKS: readonly OrchestrationTask[] = [];

export function useWorkData() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  // SAFETY: same inactive-query sentinel as the snapshot above.
  const tasks = useAtomValue(environmentTasksAtom(environmentId ?? ("" as never)));
  const participants = useWorkParticipants(snapshot ?? null);

  return {
    environmentId,
    loaded: snapshot !== null && snapshot !== undefined,
    projects: (snapshot?.projects ?? []).map((project) =>
      project.id === GENERAL_PROJECT_ID ? { ...project, title: t("No project") } : project,
    ),
    tasks: environmentId ? tasks : EMPTY_TASKS,
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
function NoMatches({ to }: { readonly to: "/tasks" | "/projects" }) {
  const { t } = useI18n();

  return (
    <p className="text-13px text-muted-foreground">
      {t("Nothing matches these filters.")}{" "}
      <Link to={to} className="text-foreground underline-offset-2 hover:underline">
        {t("Clear filters")}
      </Link>
    </p>
  );
}

export function TasksPage({ filter }: { readonly filter: TaskListFilter }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { environmentId, loaded, projects, tasks, participants } = useWorkData();
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const activeProjects = projects.filter((project) => projectStatus(project) !== "archived");
  const canCreate = environmentId !== null && activeProjects.length > 0;
  const visible = sortTasks(tasks.filter((task) => matchesTaskFilter(task, filter)));

  return (
    <WorkPage
      actions={
        canCreate && tasks.length > 0 ? (
          <WorkHeaderAction
            label={t("New task")}
            icon={RiAddLine}
            onClick={() => setTaskDialogOpen(true)}
          />
        ) : null
      }
    >
      {!loaded ? (
        <WorkColumn title={t("Tasks")}>
          <SkeletonTableRows label={t("Loading tasks…")} />
        </WorkColumn>
      ) : tasks.length === 0 ? (
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
          {visible.length === 0 ? (
            <NoMatches to="/tasks" />
          ) : (
            <TasksTable
              tasks={visible}
              projects={projects}
              bots={participants.allBots}
              showProject={filter.project === undefined}
              onOpenTask={(task) =>
                void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
              }
            />
          )}
        </WorkColumn>
      )}
      {environmentId ? (
        <>
          <NewTaskDialog
            open={taskDialogOpen}
            onOpenChange={setTaskDialogOpen}
            environmentId={environmentId}
            defaultProjectId={filter.project ?? null}
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

export function ProjectsPage({ filter }: { readonly filter: ProjectListFilter }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const statusLabel = useWorkStatusLabel();
  const { environmentId, loaded, participants, ...work } = useWorkData();
  const [dialogOpen, setDialogOpen] = useState(false);
  const projects = work.projects.filter((project) => project.id !== GENERAL_PROJECT_ID);

  const visible = projects
    .filter((project) => matchesProjectFilter(project, filter))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return (
    <WorkPage
      actions={
        environmentId && projects.length > 0 ? (
          <WorkHeaderAction
            label={t("New project")}
            icon={RiAddLine}
            onClick={() => setDialogOpen(true)}
          />
        ) : null
      }
    >
      {!loaded ? (
        <WorkColumn title={t("Projects")}>
          <SkeletonCards label={t("Loading projects…")} />
        </WorkColumn>
      ) : projects.length === 0 ? (
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
          {visible.length === 0 ? (
            <NoMatches to="/projects" />
          ) : (
            <DataGrid
              items={visible}
              getItemKey={(project) => project.id}
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
                    <WorkStatusIcon status={projectStatus(project)} />
                    <span className="sr-only">{statusLabel(projectStatus(project))}: </span>
                    <span className="truncate">{project.title}</span>
                  </span>
                </Link>
              )}
            />
          )}
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
