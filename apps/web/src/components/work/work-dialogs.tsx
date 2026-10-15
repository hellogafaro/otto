import {
  type EnvironmentId,
  type OrchestrationProjectShell,
  ProjectId,
  TaskId,
  type WorkParticipant,
  type WorkStatus,
} from "@otto/contracts";
import { RiBox3Line, RiCalendarLine, RiCloseLine, RiImageLine } from "@remixicon/react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { taskEnvironment } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  ComposerControl,
  ComposerControlIcon,
  ComposerSelectControl,
} from "../chat/composer-control";
import { PromptDialog } from "../prompt-dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useProjectCoverUpload } from "./project-cover";
import { AssigneesMenu, OwnerSelect, type WorkParticipants } from "./work-participants";
import { WorkStatusSelect } from "./work-status";

export function ProjectSelect({
  value,
  onChange,
  projects,
  variant,
}: {
  readonly value: ProjectId | null;
  readonly onChange: (projectId: ProjectId) => void;
  readonly projects: readonly OrchestrationProjectShell[];
  /** `ghost` is the quiet property row on a task page; `composer` a composer control. */
  readonly variant?: "ghost" | "composer";
}) {
  const { t } = useI18n();
  const current = projects.find((project) => project.id === value);
  const Trigger = variant === "composer" ? ComposerSelectControl : SelectTrigger;

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        const project = projects.find((candidate) => candidate.id === next);

        if (project) onChange(project.id);
      }}
    >
      <Trigger
        size="sm"
        variant={variant === "ghost" ? "ghost" : undefined}
        className="w-auto max-w-52 min-w-0"
        aria-label={t("Project")}
      >
        <SelectValue>
          <span className="flex min-w-0 items-center gap-1.5">
            <RiBox3Line aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{current?.title ?? t("Project")}</span>
          </span>
        </SelectValue>
      </Trigger>
      <SelectPopup alignItemWithTrigger={false}>
        {projects.map((project) => (
          <SelectItem key={project.id} hideIndicator value={project.id}>
            {project.title}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const dueDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A due day as a composer control over the native date picker. */
function DueDateControl({
  value,
  onChange,
}: {
  readonly value: string | null;
  readonly onChange: (dueDate: string | null) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [year, month, day] = (value ?? "").split("-").map(Number);

  return (
    <span className="relative">
      <ComposerControl aria-label={t("Due date")} onClick={() => input.current?.showPicker?.()}>
        <ComposerControlIcon icon={RiCalendarLine} />
        {value && year && month && day
          ? dueDateFormatter.format(new Date(year, month - 1, day))
          : t("Due date")}
      </ComposerControl>
      <input
        ref={input}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}

/**
 * Otto: New task, the routine composer: the title, then the description as the prompt, with
 * status, project, owner, assignees and due date as composer controls.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  environmentId,
  defaultProjectId,
  projects,
  participants,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly defaultProjectId: ProjectId | null;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly participants: WorkParticipants;
}) {
  const { t } = useI18n();
  const createTask = useAtomCommand(taskEnvironment.create);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [status, setStatus] = useState<WorkStatus>("backlog");
  const [owner, setOwner] = useState<WorkParticipant | null>(null);
  const [assignees, setAssignees] = useState<WorkParticipant[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const chosenProjectId = projectId ?? defaultProjectId ?? projects[0]?.id ?? null;

  const close = () => {
    setTitle("");
    setProjectId(null);
    setStatus("backlog");
    setOwner(null);
    setAssignees([]);
    setDueDate(null);
    onOpenChange(false);
  };

  const submit = async (description: string) => {
    if (chosenProjectId === null) return;

    const result = await createTask({
      environmentId,
      input: {
        taskId: TaskId.make(randomUUID()),
        projectId: chosenProjectId,
        title: title.trim(),
        description,
        owner,
        assignees,
        dueDate,
        status,
      },
    });

    if (AsyncResult.isSuccess(result)) close();
  };

  return (
    <PromptDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("New task")}
      titleInput={{ value: title, onChange: setTitle, label: t("Task title") }}
      placeholder={t("Add a description…")}
      promptOptional
      pickers={
        <>
          <WorkStatusSelect variant="composer" value={status} onChange={setStatus} />
          <ProjectSelect
            variant="composer"
            value={chosenProjectId}
            onChange={setProjectId}
            projects={projects}
          />
          <OwnerSelect
            variant="composer"
            value={owner}
            onChange={setOwner}
            participants={participants}
          />
          <AssigneesMenu
            variant="composer"
            value={assignees}
            onChange={setAssignees}
            participants={participants}
          />
          <DueDateControl value={dueDate} onChange={setDueDate} />
        </>
      }
      submitLabel={t("Create task")}
      canSubmit={chosenProjectId !== null && title.trim().length > 0}
      onSubmit={(description) => void submit(description)}
    />
  );
}

/**
 * Otto: New project, the routine composer: the title, then the description as the prompt, with
 * status, owner and an optional cover image as composer controls. The cover is uploaded into
 * the new project's Library folder once the project exists.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  environmentId,
  participants,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly participants: WorkParticipants;
  readonly onCreated?: (projectId: ProjectId) => void;
}) {
  const { t } = useI18n();
  const createProject = useAtomCommand(projectEnvironment.create);
  const { setCover } = useProjectCoverUpload();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<WorkStatus>("backlog");
  const [owner, setOwner] = useState<WorkParticipant | null>(null);
  const [cover, setCoverFile] = useState<File | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const close = () => {
    setTitle("");
    setStatus("backlog");
    setOwner(null);
    setCoverFile(null);
    onOpenChange(false);
  };

  const submit = async (description: string) => {
    const projectId = ProjectId.make(randomUUID());

    const result = await createProject({
      environmentId,
      input: { projectId, title: title.trim(), description, owner, status },
    });

    if (!AsyncResult.isSuccess(result)) return;

    close();
    onCreated?.(projectId);

    if (cover) void setCover(environmentId, projectId, cover);
  };

  return (
    <PromptDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("New project")}
      titleInput={{ value: title, onChange: setTitle, label: t("Project title") }}
      placeholder={t("Add a description…")}
      promptOptional
      pickers={
        <>
          <WorkStatusSelect variant="composer" value={status} onChange={setStatus} />
          <OwnerSelect
            variant="composer"
            value={owner}
            onChange={setOwner}
            participants={participants}
          />
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const [file] = event.currentTarget.files ?? [];
              event.currentTarget.value = "";

              if (file) setCoverFile(file);
            }}
          />
          <ComposerControl
            aria-label={t("Cover image")}
            className="max-w-52 min-w-0"
            onClick={() => coverInput.current?.click()}
          >
            <ComposerControlIcon icon={RiImageLine} />
            <span className="min-w-0 truncate">{cover?.name ?? t("Cover image")}</span>
          </ComposerControl>
          {cover ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ComposerControl
                    size="icon-sm"
                    aria-label={t("Remove cover")}
                    onClick={() => setCoverFile(null)}
                  />
                }
              >
                <ComposerControlIcon icon={RiCloseLine} />
              </TooltipTrigger>
              <TooltipPopup>{t("Remove cover")}</TooltipPopup>
            </Tooltip>
          ) : null}
        </>
      }
      submitLabel={t("Create project")}
      canSubmit={title.trim().length > 0}
      onSubmit={(description) => void submit(description)}
    />
  );
}
