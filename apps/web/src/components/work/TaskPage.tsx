import type { UpdateTaskInput } from "@otto/client-runtime/state/tasks";
import type { TaskId } from "@otto/contracts";
import { RiCalendarLine, RiListCheck3 } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";

import { useI18n } from "../../i18n";
import { taskEnvironment } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { projectStatus } from "./work.logic";
import { PropertyGroup, WorkDetailPage, WorkResourcesSection } from "./WorkDetail";
import { ProjectSelect } from "./WorkDialogs";
import { WorkEmpty, WorkPage, useWorkData } from "./WorkPages";
import { AssigneesMenu, OwnerSelect } from "./WorkParticipants";
import { WorkStatusSelect } from "./WorkStatus";

type TaskFields = Omit<UpdateTaskInput, "taskId">;

/** Otto: A task's own page: title, description and resources, with its properties in the details sidebar. */
export function TaskPage({ taskId }: { readonly taskId: TaskId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const updateTask = useAtomCommand(taskEnvironment.update);
  const { environmentId, loaded, projects, tasks, participants } = useWorkData();
  const task = tasks.find((candidate) => candidate.id === taskId);
  const back = { label: t("Tasks"), onBack: () => void navigate({ to: "/tasks" }) };

  if (!loaded) return <WorkPage back={back}>{null}</WorkPage>;

  if (!task || environmentId === null) {
    return (
      <WorkPage back={back}>
        <WorkEmpty
          icon={<RiListCheck3 />}
          title={t("Task not found")}
          description={t("It may have been deleted, or the link points to another workspace.")}
        />
      </WorkPage>
    );
  }

  const update = (fields: TaskFields) =>
    void updateTask({ environmentId, input: { taskId: task.id, ...fields } });

  return (
    <WorkDetailPage
      kind="task"
      back={back}
      title={task.title}
      onTitleSave={(title) => update({ title })}
      description={task.description}
      onDescriptionSave={(description) => update({ description })}
      sections={[
        {
          key: "resources",
          content: (
            <WorkResourcesSection
              resources={task.resources}
              onChange={(resources) => update({ resources })}
            />
          ),
        },
      ]}
      aside={
        <>
          <PropertyGroup label={t("Properties")}>
            <WorkStatusSelect
              variant="ghost"
              value={task.status}
              onChange={(status) => update({ status })}
            />
            <OwnerSelect
              variant="ghost"
              value={task.owner}
              onChange={(owner) => update({ owner })}
              participants={participants}
            />
            <AssigneesMenu
              variant="ghost"
              value={task.assignees}
              onChange={(assignees) => update({ assignees })}
              participants={participants}
            />
            <TaskDueDate value={task.dueDate} onChange={(dueDate) => update({ dueDate })} />
          </PropertyGroup>
          <PropertyGroup label={t("Project")}>
            <ProjectSelect
              variant="ghost"
              value={task.projectId}
              onChange={(projectId) => update({ projectId })}
              projects={projects.filter(
                (project) => project.id === task.projectId || projectStatus(project) !== "archived",
              )}
            />
          </PropertyGroup>
        </>
      }
    />
  );
}

const dueDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A due day as a quiet property row that opens the native date picker; clearing it removes the date. */
function TaskDueDate({
  value,
  onChange,
}: {
  readonly value: string | null;
  readonly onChange: (dueDate: string | null) => void;
}) {
  const { t } = useI18n();
  const [year, month, day] = (value ?? "").split("-").map(Number);

  return (
    <label className="relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-secondary-label hover:bg-secondary hover:text-foreground">
      <RiCalendarLine aria-hidden className="size-4 shrink-0" />
      {value && year && month && day
        ? dueDateFormatter.format(new Date(year, month - 1, day))
        : t("Due date")}
      <input
        type="date"
        aria-label={t("Due date")}
        value={value ?? ""}
        onClick={(event) => event.currentTarget.showPicker?.()}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}
