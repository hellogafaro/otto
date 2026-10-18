import type { UpdateTaskInput } from "@otto/client-runtime/state/tasks";
import {
  type EnvironmentId,
  type KeybindingCommand,
  type OrchestrationTask,
  type TaskId,
  workParticipantKey,
} from "@otto/contracts";
import {
  type RemixiconComponentType,
  RiAddLine,
  RiBox3Line,
  RiCalendarLine,
  RiCloseLine,
  RiListCheck3,
  RiProgress4Line,
  RiRepeatLine,
  RiTimeLine,
  RiUserAddLine,
  RiUserLine,
  RiUserStarLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { cn, randomUUID } from "../../lib/utils";
import type { PageAction } from "../../page-actions-registry";
import { taskEnvironment, useTask } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsGroup, DetailsRow } from "../details-aside";
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
import { useLibraryData } from "../library/use-library";
import { ActivitySection } from "./activity-section";
import { formatDuration, parseDuration, projectStatus } from "./work.logic";
import { TaskDueDate } from "./task-due-date";
import { TaskRepeatSelect } from "./task-repeat";
import { WorkDetailPage, WorkResourcesSection, useWorkPickers } from "./work-detail";
import { ProjectSelect } from "./work-dialogs";
import { WorkEmpty, WorkPage, useWorkData } from "./work-pages";
import { AssigneesMenu, OwnerSelect, ParticipantAvatar } from "./work-participants";
import { WorkMoreActions, WorkStatusSelect } from "./work-status";

type TaskFields = Omit<UpdateTaskInput, "taskId">;

/**
 * Otto: A task's own page: title, description, resources and activity, with Properties
 * and Time as collapsible groups in the details sidebar.
 */
export function TaskPage({ taskId }: { readonly taskId: TaskId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { environmentId, loaded } = useWorkData();
  const { task, missing } = useTask(environmentId, taskId);
  const back = { label: t("Tasks"), onBack: () => void navigate({ to: "/tasks" }) };

  if (!loaded || (!task && !missing && environmentId !== null)) {
    return <WorkPage back={back}>{null}</WorkPage>;
  }

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

  return <TaskDetail environmentId={environmentId} task={task} back={back} />;
}

type TaskPicker = "status" | "owner" | "assignees" | "dueDate" | "repeat" | "project";

/**
 * The found task's page. Its property keys open the pickers in the details sidebar, I assigns
 * you and T logs time.
 */
function TaskDetail({
  environmentId,
  task,
  back,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: OrchestrationTask;
  readonly back: { readonly label: string; readonly onBack: () => void };
}) {
  const { t } = useI18n();
  const updateTask = useAtomCommand(taskEnvironment.update);
  const { projects, participants, currentPersonId } = useWorkData();
  const { files } = useLibraryData();
  const { open: openPicker, props: picker } = useWorkPickers<TaskPicker>("task", "task-properties");

  const [loggingTime, setLoggingTime] = useState(false);

  const update = useCallback(
    (fields: TaskFields) =>
      void updateTask({ environmentId, input: { taskId: task.id, ...fields } }),
    [environmentId, task.id, updateTask],
  );

  const me = participants.people.find((person) => person.personId === currentPersonId);

  const properties = useMemo((): PageAction[] => {
    const opens = (
      id: TaskPicker,
      title: string,
      icon: RemixiconComponentType,
      shortcutCommand: KeybindingCommand,
    ): PageAction => ({
      id,
      title,
      icon,
      searchTerms: [title.toLowerCase()],
      shortcutCommand,
      run: () => openPicker(id),
    });

    const assigned = me
      ? task.assignees.some((assignee) => workParticipantKey(assignee) === workParticipantKey(me))
      : true;

    return [
      opens("status", t("Status"), RiProgress4Line, "property.status"),
      opens("assignees", t("Assignees"), RiUserLine, "property.assignees"),
      ...(me && !assigned
        ? [
            {
              id: "assign-to-me",
              title: t("Assign to me"),
              icon: RiUserAddLine,
              searchTerms: ["assign to me", "take"],
              shortcutCommand: "property.assignToMe",
              run: () => update({ assignees: [...task.assignees, me] }),
            } satisfies PageAction,
          ]
        : []),
      opens("owner", t("Owner"), RiUserStarLine, "property.owner"),
      opens("dueDate", t("Due date"), RiCalendarLine, "property.dueDate"),
      opens("project", t("Project"), RiBox3Line, "property.project"),
      opens("repeat", t("Repeat"), RiRepeatLine, "property.repeat"),
      {
        id: "log-time",
        title: t("Log time"),
        icon: RiTimeLine,
        searchTerms: ["log time", "time", "hours", "timesheet"],
        shortcutCommand: "property.logTime",
        run: () => setLoggingTime(true),
      },
    ];
  }, [me, openPicker, t, task.assignees, update]);

  return (
    <WorkDetailPage
      type="task"
      back={back}
      actions={
        <WorkMoreActions
          label={t("This task")}
          path={`/tasks/${task.id}`}
          id={task.id}
          status={task.status}
          onStatusChange={(status) => update({ status })}
          properties={properties}
        />
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
        {
          key: "activity",
          content: (
            <ActivitySection
              environmentId={environmentId}
              entity={{ entityType: "task", entityId: task.id }}
              projectId={task.projectId ?? null}
              refreshKey={`${task.updatedAt}:${task.timeEntries.length}`}
              participants={participants}
              projects={projects}
              files={files}
              currentPersonId={currentPersonId}
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
                picker={picker("status")}
              />
            </DetailsRow>
            <DetailsRow label={t("Owner")}>
              <OwnerSelect
                variant="ghost"
                value={task.owner}
                onChange={(owner) => update({ owner })}
                participants={participants}
                picker={picker("owner")}
              />
            </DetailsRow>
            <DetailsRow label={t("Assignees")}>
              <AssigneesMenu
                variant="ghost"
                value={task.assignees}
                onChange={(assignees) => update({ assignees })}
                participants={participants}
                picker={picker("assignees")}
              />
            </DetailsRow>
            <DetailsRow label={t("Due date")}>
              <TaskDueDate
                variant="ghost"
                value={task.dueDate}
                onChange={(dueDate) => update({ dueDate })}
                picker={picker("dueDate")}
              />
            </DetailsRow>
            <DetailsRow label={t("Repeat")}>
              <TaskRepeatSelect
                value={task.repeat}
                onChange={(repeat) => update({ repeat })}
                picker={picker("repeat")}
              />
            </DetailsRow>
            <DetailsRow label={t("Project")}>
              <ProjectSelect
                variant="ghost"
                value={task.projectId}
                onChange={(projectId) => update({ projectId })}
                picker={picker("project")}
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
            onLogTime={() => setLoggingTime(true)}
          />
          <LogTimeDialog open={loggingTime} onOpenChange={setLoggingTime} taskId={task.id} />
        </>
      }
    />
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
  onLogTime,
}: {
  readonly task: OrchestrationTask;
  readonly currentPersonId: string | null;
  readonly personName: (personId: string) => string;
  readonly onLogTime: () => void;
}) {
  const { t } = useI18n();
  const removeTime = useAtomCommand(taskEnvironment.removeTime);
  const { environmentId } = useWorkData();
  const total = task.timeEntries.reduce((sum, entry) => sum + entry.duration, 0);

  if (environmentId === null) return null;

  return (
    <DetailsGroup
      id="task-time"
      label={t("Time")}
      summary={total > 0 ? formatDuration(total) : undefined}
      action={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-row"
                variant="ghost-muted"
                aria-label={t("Log time")}
                onClick={onLogTime}
              >
                <RiAddLine className="size-3" />
              </Button>
            }
          />
          <TooltipPopup>{t("Log time")}</TooltipPopup>
        </Tooltip>
      }
    >
      {task.timeEntries.toReversed().map((entry) => {
        const name = personName(entry.createdBy);
        const own = entry.createdBy === currentPersonId;

        return (
          <div key={entry.id} className="group/time flex min-h-9 items-center gap-2 py-1">
            <ParticipantAvatar
              participant={{ kind: "person", personId: entry.createdBy, displayName: name }}
              bots={[]}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-13px">
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
                  "px-2.5 text-13px tabular-nums",
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
