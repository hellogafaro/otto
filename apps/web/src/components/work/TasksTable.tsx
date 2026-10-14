import type { OrchestrationProjectShell, OrchestrationTask } from "@otto/contracts";
import { RiBox3Line, RiCalendarLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { formatRelativeTime } from "../../timestampFormat";
import type { Bot } from "../roster/types";
import { DataTable, DataTableChip, type DataTableColumn } from "../ui/data-table";
import { WORK_STATUS_ORDER } from "./work.logic";
import { ParticipantStack } from "./WorkParticipants";
import { WorkStatusIcon, useWorkStatusLabel } from "./WorkStatus";

function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split("-").map(Number);

  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function taskColumns({
  t,
  projects,
  bots,
  showProject,
}: {
  readonly t: ReturnType<typeof useI18n>["t"];
  readonly projects: readonly OrchestrationProjectShell[];
  readonly bots: readonly Bot[];
  readonly showProject: boolean;
}): DataTableColumn<OrchestrationTask>[] {
  const today = new Date().toISOString().slice(0, 10);

  return [
    { id: "title", type: "title", cell: (task) => task.title },
    {
      id: "details",
      type: "chips",
      cell: (task) => {
        const project = showProject
          ? projects.find((candidate) => candidate.id === task.projectId)
          : undefined;

        const overdue =
          task.dueDate !== null &&
          task.dueDate < today &&
          task.status !== "completed" &&
          task.status !== "cancelled";

        return (
          <>
            {project ? (
              <DataTableChip>
                <RiBox3Line aria-hidden />
                <span className="truncate">{project.title}</span>
              </DataTableChip>
            ) : null}
            {task.dueDate !== null ? (
              <DataTableChip tone={overdue ? "error" : "default"}>
                <RiCalendarLine aria-hidden />
                {formatDueDate(task.dueDate)}
              </DataTableChip>
            ) : null}
          </>
        );
      },
    },
    {
      id: "assignees",
      cell: (task) =>
        task.assignees.length > 0 ? (
          <ParticipantStack participants={task.assignees} bots={bots} />
        ) : null,
    },
    {
      id: "updated",
      type: "time",
      cell: (task) => {
        const relative = formatRelativeTime(task.updatedAt);

        return relative?.suffix ? relative.value : t("now");
      },
    },
  ];
}

/**
 * Tasks on the shared DataTable, grouped by status; a row opens its task. The group header
 * carries the status icon, so rows do not repeat it.
 */
export function TasksTable({
  tasks,
  projects,
  bots,
  showProject,
  onOpenTask,
}: {
  readonly tasks: readonly OrchestrationTask[];
  readonly projects: readonly OrchestrationProjectShell[];
  readonly bots: readonly Bot[];
  readonly showProject: boolean;
  readonly onOpenTask: (task: OrchestrationTask) => void;
}) {
  const { t } = useI18n();
  const statusLabel = useWorkStatusLabel();

  return (
    <DataTable
      rows={tasks}
      columns={taskColumns({ t, projects, bots, showProject })}
      getRowKey={(task) => task.id}
      getRowLabel={(task) => `${task.title}, ${statusLabel(task.status)}`}
      onRowClick={onOpenTask}
      groupBy={{
        groups: WORK_STATUS_ORDER.map((status) => ({
          id: status,
          label: statusLabel(status),
          icon: <WorkStatusIcon status={status} />,
        })),
        getGroupId: (task) => task.status,
      }}
    />
  );
}
