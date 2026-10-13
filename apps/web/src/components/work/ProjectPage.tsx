import type { UpdateProjectInput } from "@otto/client-runtime/state/projects";
import { type ProjectId, matchesTaskFilter } from "@otto/contracts";
import { RiBox3Line } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { DetailsGroup, DetailsRow } from "../DetailsAside";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectCover } from "./ProjectCover";
import { TasksTable } from "./TasksTable";
import { projectStatus, sortTasks } from "./work.logic";
import { WorkDetailPage, WorkResourcesSection, WorkSectionHeader } from "./WorkDetail";
import { TaskDialog } from "./WorkDialogs";
import { WorkEmpty, WorkPage, useWorkData } from "./WorkPages";
import { OwnerSelect } from "./WorkParticipants";
import { WorkStatusSelect, useWorkStatusLabel } from "./WorkStatus";

type ProjectFields = Omit<UpdateProjectInput, "projectId">;

/**
 * Otto: A project's page, the same pattern as a task's: its cover above the
 * title, then description, resources and its tasks in the main column; status,
 * owner and task counts in the details sidebar's Properties group.
 */
export function ProjectPage({ projectId }: { readonly projectId: ProjectId }) {
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

  return (
    <>
      <WorkDetailPage
        kind="project"
        back={back}
        cover={<ProjectCover seed={project.id} />}
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
          {
            key: "tasks",
            content: (
              <section className="flex flex-col gap-0.5">
                <WorkSectionHeader
                  label={t("Tasks")}
                  {...(status === "archived"
                    ? {}
                    : { add: { label: t("New task"), onClick: () => setNewTaskOpen(true) } })}
                />
                {projectTasks.length === 0 ? (
                  <p className="ps-4 text-13px text-muted-foreground">
                    {t("No tasks yet. Break the project into the next few steps.")}
                  </p>
                ) : (
                  <TasksTable
                    tasks={projectTasks}
                    projects={projects}
                    bots={participants.allBots}
                    showProject={false}
                    onOpenTask={(task) =>
                      void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } })
                    }
                  />
                )}
              </section>
            ),
          },
        ]}
        aside={
          <DetailsGroup id="project-properties" label={t("Properties")}>
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
          </DetailsGroup>
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
