import type { UpdateTaskInput } from "@otto/client-runtime/state/tasks";
import type { OrchestrationTask, TaskId } from "@otto/contracts";
import { RiAddLine, RiCalendarLine, RiCloseLine, RiListCheck3 } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { cn, randomUUID } from "../../lib/utils";
import { taskEnvironment } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsGroup, DetailsRow } from "../DetailsAside";
import { PersonAvatar } from "../roster/PersonAvatar";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatDuration, parseDuration, projectStatus } from "./work.logic";
import { WorkDetailPage, WorkResourcesSection } from "./WorkDetail";
import { ProjectSelect } from "./WorkDialogs";
import { WorkEmpty, WorkPage, useWorkData } from "./WorkPages";
import { AssigneesMenu, OwnerSelect } from "./WorkParticipants";
import { WorkMoreActions, WorkStatusSelect } from "./WorkStatus";

type TaskFields = Omit<UpdateTaskInput, "taskId">;

/**
 * Otto: A task's own page: title, description and resources, with Properties
 * and Time as collapsible groups in the details sidebar.
 */
export function TaskPage({ taskId }: { readonly taskId: TaskId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const updateTask = useAtomCommand(taskEnvironment.update);
  const { environmentId, loaded, projects, tasks, participants, currentPersonId } = useWorkData();
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
      actions={
        <WorkMoreActions status={task.status} onStatusChange={(status) => update({ status })} />
      }
      title={task.title}
      onTitleSave={(title) => update({ title })}
      description={task.description}
      onDescriptionSave={(description) => update({ description })}
      sections={[
        {
          key: "resources",
          content: (
            <WorkResourcesSection
              self={{ type: "task", id: task.id }}
              resources={task.resources}
              onChange={(resources) => update({ resources })}
            />
          ),
        },
      ]}
      aside={
        <>
          <DetailsGroup id="task-properties" label={t("Properties")}>
            <DetailsRow label={t("Status")}>
              <WorkStatusSelect
                variant="ghost"
                value={task.status}
                onChange={(status) => update({ status })}
              />
            </DetailsRow>
            <DetailsRow label={t("Owner")}>
              <OwnerSelect
                variant="ghost"
                value={task.owner}
                onChange={(owner) => update({ owner })}
                participants={participants}
              />
            </DetailsRow>
            <DetailsRow label={t("Assignees")}>
              <AssigneesMenu
                variant="ghost"
                value={task.assignees}
                onChange={(assignees) => update({ assignees })}
                participants={participants}
              />
            </DetailsRow>
            <DetailsRow label={t("Due date")}>
              <TaskDueDate value={task.dueDate} onChange={(dueDate) => update({ dueDate })} />
            </DetailsRow>
            <DetailsRow label={t("Project")}>
              <ProjectSelect
                variant="ghost"
                value={task.projectId}
                onChange={(projectId) => update({ projectId })}
                projects={projects.filter(
                  (project) =>
                    project.id === task.projectId || projectStatus(project) !== "archived",
                )}
              />
            </DetailsRow>
          </DetailsGroup>
          <TaskTimeGroup
            task={task}
            currentPersonId={currentPersonId}
            personName={(personId) =>
              participants.people.find((person) => person.personId === personId)?.displayName ??
              t("Someone")
            }
          />
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
        : t("No due date")}
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

const entryDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A task's timesheet: the total, then every entry newest first as a quiet
 * row (avatar, name · short date, an optional muted description, and the
 * duration on the right). The header's plus opens Log time; only whoever
 * logged an entry removes it, from the duration's place on hover.
 */
function TaskTimeGroup({
  task,
  currentPersonId,
  personName,
}: {
  readonly task: OrchestrationTask;
  readonly currentPersonId: string | null;
  readonly personName: (personId: string) => string;
}) {
  const { t } = useI18n();
  const removeTime = useAtomCommand(taskEnvironment.removeTime);
  const { environmentId } = useWorkData();
  const [logging, setLogging] = useState(false);
  const total = task.timeEntries.reduce((sum, entry) => sum + entry.duration, 0);

  if (environmentId === null) return null;

  return (
    <DetailsGroup
      id="task-time"
      label={t("Time")}
      action={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-row"
                variant="ghost-muted"
                aria-label={t("Log time")}
                onClick={() => setLogging(true)}
              >
                <RiAddLine className="size-3" />
              </Button>
            }
          />
          <TooltipPopup>{t("Log time")}</TooltipPopup>
        </Tooltip>
      }
    >
      <DetailsRow label={t("Total")}>
        <span className="px-2.5 text-sm tabular-nums">{formatDuration(total)}</span>
      </DetailsRow>
      {task.timeEntries.toReversed().map((entry) => {
        const name = personName(entry.createdBy);
        const own = entry.createdBy === currentPersonId;

        return (
          <div key={entry.id} className="group/time flex min-h-9 items-center gap-2 py-1">
            <PersonAvatar name={name} className="size-5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                <span className="text-foreground">{name}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {entryDateFormatter.format(new Date(entry.createdAt))}
                </span>
              </span>
              {entry.description ? (
                <span className="truncate text-xs text-muted-foreground">{entry.description}</span>
              ) : null}
            </div>
            <div className="relative flex h-7 shrink-0 items-center">
              <span
                className={cn(
                  "px-2.5 text-sm tabular-nums",
                  own && "group-focus-within/time:invisible group-hover/time:invisible",
                )}
              >
                {formatDuration(entry.duration)}
              </span>
              {own ? (
                <span className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 group-focus-within/time:opacity-100 group-hover/time:opacity-100">
                  <Button
                    size="icon-row"
                    variant="ghost-muted"
                    aria-label={t("Remove")}
                    onClick={() =>
                      void removeTime({
                        environmentId,
                        input: { taskId: task.id, entryId: entry.id },
                      })
                    }
                  >
                    <RiCloseLine className="size-3.5" />
                  </Button>
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      <LogTimeDialog open={logging} onOpenChange={setLogging} taskId={task.id} />
    </DetailsGroup>
  );
}

/** Log time: a duration in plain words ("15m", "1h 30m", "5 minutes") and an optional description. */
function LogTimeDialog({
  open,
  onOpenChange,
  taskId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly taskId: TaskId;
}) {
  const { t } = useI18n();
  const addTime = useAtomCommand(taskEnvironment.addTime);
  const { environmentId } = useWorkData();
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const parsed = parseDuration(duration);

  const close = () => {
    onOpenChange(false);
    setDuration("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();

            if (parsed === null || environmentId === null) return;

            void addTime({
              environmentId,
              input: {
                taskId,
                entryId: randomUUID(),
                duration: parsed,
                ...(description.trim() === "" ? {} : { description: description.trim() }),
              },
            });
            close();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Log time")}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-2">
            <Input
              autoFocus
              aria-label={t("Duration")}
              placeholder={t("15m, 1h 30m, 2 hours…")}
              value={duration}
              aria-invalid={duration.trim() !== "" && parsed === null}
              onChange={(event) => setDuration(event.currentTarget.value)}
            />
            <Input
              aria-label={t("Description")}
              placeholder={t("What did you work on? (optional)")}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={parsed === null}>
              {parsed === null
                ? t("Log time")
                : t("Log {duration}", { duration: formatDuration(parsed) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
