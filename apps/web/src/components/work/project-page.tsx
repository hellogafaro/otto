import type { UpdateProjectInput } from "@otto/client-runtime/state/projects";
import { type ProjectId, matchesTaskFilter } from "@otto/contracts";
import {
  RiAddLine,
  RiBookShelfLine,
  RiBox3Line,
  RiChat1Line,
  RiFileTextLine,
  RiListCheck3,
} from "@remixicon/react";
import * as Match from "effect/Match";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { DetailsRow, DetailsTabs } from "../details-aside";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectChats, ProjectNewChat } from "./project-chats";
import { ProjectCover } from "./project-cover";
import { ProjectLibrary, ProjectUpload } from "./project-library";
import { TasksTable } from "./tasks-table";
import { type ProjectTab, projectStatus, sortTasks } from "./work.logic";
import { WorkDetailPage, WorkResourcesSection } from "./work-detail";
import { TaskDialog } from "./work-dialogs";
import { WorkEmpty, WorkPage, useWorkData } from "./work-pages";
import { OwnerSelect } from "./work-participants";
import { WorkMoreActions, WorkStatusSelect, useWorkStatusLabel } from "./work-status";

type ProjectFields = Omit<UpdateProjectInput, "projectId">;

/**
 * Otto: A project's page, the same pattern as a task's: its cover, then the Overview, Tasks,
 * Chats and Library tabs; Overview holds the title, description and resources, the others the
 * project's tasks, chats and Library folder. Status, owner and task counts sit in the details
 * sidebar.
 */
export function ProjectPage({
  projectId,
  tab,
}: {
  readonly projectId: ProjectId;
  readonly tab: ProjectTab;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const statusLabel = useWorkStatusLabel();
  const updateProject = useAtomCommand(projectEnvironment.update);
  const { environmentId, loaded, projects, tasks, participants } = useWorkData();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const project = projects.find((candidate) => candidate.id === projectId);
  const back = { label: t("Projects"), onBack: () => void navigate({ to: "/projects" }) };

  if (!loaded) return <WorkPage back={back}>{null}</WorkPage>;

  if (!project || environmentId === null) {
    return (
      <WorkPage back={back}>
        <WorkEmpty
          icon={<RiBox3Line />}
          title={t("Project not found")}
          description={t("It may have been deleted, or the link points to another workspace.")}
        />
      </WorkPage>
    );
  }

  const status = projectStatus(project);

  const projectTasks = sortTasks(
    tasks.filter((task) => matchesTaskFilter(task, { project: projectId })),
  );

  const openCount = projectTasks.filter((task) =>
    matchesTaskFilter(task, { status: ["backlog", "pending", "in_progress"] }),
  ).length;

  const completedCount = projectTasks.filter((task) => task.status === "completed").length;

  const update = (fields: ProjectFields) =>
    void updateProject({ environmentId, input: { projectId: project.id, ...fields } });

  const canAddTask = status !== "archived";

  const tasksView =
    projectTasks.length === 0 ? (
      <Empty>
        <EmptyMedia variant="icon">
          <RiListCheck3 />
        </EmptyMedia>
        <EmptyDescription>
          {t("No tasks yet. Break the project into the next few steps.")}
        </EmptyDescription>
      </Empty>
    ) : (
      <TasksTable
        tasks={projectTasks}
        projects={projects}
        bots={participants.allBots}
        showProject={false}
        onOpenTask={(task) => void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })}
      />
    );

  /** The open tab's add control, beside More in the top bar; empty tabs have no button of their own. */
  const tabAction = Match.value(tab).pipe(
    Match.when("tasks", () =>
      canAddTask ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-muted"
                aria-label={t("New task")}
                onClick={() => setNewTaskOpen(true)}
              >
                <RiAddLine aria-hidden className="size-4" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">{t("New task")}</TooltipPopup>
        </Tooltip>
      ) : null,
    ),
    Match.when("chats", () => <ProjectNewChat projectId={project.id} />),
    Match.when("library", () => <ProjectUpload projectId={project.id} />),
    Match.orElse(() => null),
  );

  return (
    <>
      <WorkDetailPage
        type="project"
        back={back}
        actions={
          <>
            {tabAction}
            <WorkMoreActions status={status} onStatusChange={(next) => update({ status: next })} />
          </>
        }
        cover={<ProjectCover seed={project.id} />}
        tabs={
          <DetailsTabs<ProjectTab>
            label={t("Project sections")}
            size="page"
            tabs={[
              { value: "overview", label: t("Overview"), icon: RiFileTextLine },
              { value: "tasks", label: t("Tasks"), icon: RiListCheck3 },
              { value: "chats", label: t("Chats"), icon: RiChat1Line },
              { value: "library", label: t("Library"), icon: RiBookShelfLine },
            ]}
            value={tab}
            onValueChange={(next) =>
              void navigate({
                to: "/projects/$projectId",
                params: { projectId },
                search: next === "overview" ? {} : { tab: next },
              })
            }
          />
        }
        {...Match.value(tab).pipe(
          Match.when("tasks", () => ({ view: tasksView })),
          Match.when("chats", () => ({ view: <ProjectChats projectId={project.id} /> })),
          Match.when("library", () => ({ view: <ProjectLibrary projectId={project.id} /> })),
          Match.orElse(() => ({})),
        )}
        title={project.title}
        onTitleSave={(title) => update({ title })}
        description={project.description ?? ""}
        onDescriptionSave={(description) => update({ description })}
        sections={[
          {
            key: "resources",
            content: (
              <WorkResourcesSection
                self={{ type: "project", id: project.id }}
                resources={project.resources ?? []}
                onChange={(resources) => update({ resources })}
              />
            ),
          },
        ]}
        aside={
          <div className="flex flex-col">
            <DetailsRow label={t("Status")}>
              <WorkStatusSelect
                variant="ghost"
                value={status}
                onChange={(next) => update({ status: next })}
              />
            </DetailsRow>
            <DetailsRow label={t("Owner")}>
              <OwnerSelect
                variant="ghost"
                value={project.owner ?? null}
                onChange={(owner) => update({ owner })}
                participants={participants}
              />
            </DetailsRow>
            <DetailsRow label={t("Open tasks")}>
              <span className="px-2.5 text-sm tabular-nums">{openCount}</span>
            </DetailsRow>
            <DetailsRow label={statusLabel("completed")}>
              <span className="px-2.5 text-sm tabular-nums">{completedCount}</span>
            </DetailsRow>
          </div>
        }
      />
      <TaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        environmentId={environmentId}
        task={null}
        defaultProjectId={project.id}
        projects={projects.filter((candidate) => projectStatus(candidate) !== "archived")}
        participants={participants}
      />
    </>
  );
}
