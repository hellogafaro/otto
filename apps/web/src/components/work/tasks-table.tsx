import {
  type OrchestrationProjectShell,
  type TaskListItem,
  type TaskListResult,
  WORK_STATUS_ORDER,
  workParticipantKey,
} from "@otto/contracts";
import { RiBox3Line, RiCalendarLine, RiRepeatLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { formatRelativeTime, localDateKey } from "../../timestamp-format";
import type { Bot } from "../roster/types";
import {
  DataTable,
  DataTableChip,
  type DataTableColumn,
  type DataTablePaging,
} from "../ui/data-table";
import { useTaskRepeatLabel } from "./task-repeat";
import { ParticipantStack } from "./work-participants";
import { WorkStatusIcon, useWorkStatusLabel } from "./work-status";

function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split("-").map(Number);

  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function taskColumns({
  t,
  repeatLabel,
  projects,
  bots,
  showProject,
}: {
  readonly t: ReturnType<typeof useI18n>["t"];
  readonly repeatLabel: ReturnType<typeof useTaskRepeatLabel>;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly bots: readonly Bot[];
  readonly showProject: boolean;
}): DataTableColumn<TaskListItem>[] {
  const today = localDateKey(new Date());

  return [
    {
      id: "title",
      type: "title",
      cell: (task) => task.title,
      after: (task) => {
        // The owner leads, then the assignees; someone who is both shows once.
        const people = [...(task.owner ? [task.owner] : []), ...task.assignees].filter(
          (participant, index, all) =>
            all.findIndex(
              (other) => workParticipantKey(other) === workParticipantKey(participant),
            ) === index,
        );

        return people.length > 0 ? <ParticipantStack participants={people} bots={bots} /> : null;
      },
    },
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
            {task.repeat !== null ? (
              <DataTableChip>
                <RiRepeatLine aria-hidden />
                {repeatLabel(task.repeat)}
              </DataTableChip>
            ) : null}
          </>
        );
      },
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
 * Tasks on the shared DataTable, grouped by status unless they come in another order; a row
 * opens its task. The group header carries the status icon, so rows do not repeat it. A paged
 * list passes `paging` and the full status counts, since its rows are only the pages so far.
 */
export function TasksTable({
  tasks,
  projects,
  bots,
  showProject,
  grouped = true,
  statusCounts,
  paging,
  highlightedKey = null,
  onOpenTask,
}: {
  readonly tasks: readonly TaskListItem[];
  readonly projects: readonly OrchestrationProjectShell[];
  readonly bots: readonly Bot[];
  readonly showProject: boolean;
  readonly grouped?: boolean;
  readonly statusCounts?: TaskListResult["statusCounts"];
  readonly paging?: DataTablePaging;
  readonly highlightedKey?: string | null;
  readonly onOpenTask: (task: TaskListItem) => void;
}) {
  const { t } = useI18n();
  const statusLabel = useWorkStatusLabel();
  const repeatLabel = useTaskRepeatLabel();

  return (
    <DataTable
      rows={tasks}
      columns={taskColumns({ t, repeatLabel, projects, bots, showProject })}
      getRowKey={(task) => task.id}
      getRowLabel={(task) => `${task.title}, ${statusLabel(task.status)}`}
      onRowClick={onOpenTask}
      highlightedKey={highlightedKey}
      {...(paging ? { paging } : {})}
      {...(grouped
        ? {
            groupBy: {
              groups: WORK_STATUS_ORDER.map((status) => ({
                id: status,
                label: statusLabel(status),
                icon: <WorkStatusIcon status={status} />,
              })),
              getGroupId: (task: TaskListItem) => task.status,
              ...(statusCounts
                ? {
                    getGroupCount: (status: string) =>
                      statusCounts.find((entry) => entry.status === status)?.count ?? 0,
                  }
                : {}),
            },
          }
        : {})}
    />
  );
}
