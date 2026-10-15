import {
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationTask,
  ProjectId,
  TaskId,
  type WorkParticipant,
  type WorkResource,
  type WorkStatus,
} from "@otto/contracts";
import { RiAddLine, RiBox3Line, RiCloseLine, RiLink } from "@remixicon/react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState, type FormEvent, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { taskEnvironment } from "../../state/tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { RichTextEditor } from "../rich-text-editor";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { projectStatus } from "./work.logic";
import { AssigneesMenu, OwnerSelect, type WorkParticipants } from "./work-participants";
import { WorkStatusSelect } from "./work-status";

type ResourceDraft = { readonly key: string; title: string; url: string };

/** The dialog edits web links; tasks and projects are linked from the page and kept as they are. */
function toDrafts(resources: readonly WorkResource[] | undefined): ResourceDraft[] {
  return (resources ?? []).flatMap((resource) =>
    resource.type === "link"
      ? [{ key: randomUUID(), title: resource.title, url: resource.url }]
      : [],
  );
}

/** Saved resources: the kept tasks and projects, then each link row with a URL. */
function toResources(
  drafts: readonly ResourceDraft[],
  saved: readonly WorkResource[] | undefined,
): WorkResource[] {
  return [
    ...(saved ?? []).filter((resource) => resource.type !== "link"),
    ...drafts.flatMap((draft) => {
      const url = draft.url.trim();

      if (!/^https?:\/\//i.test(url)) return [];

      return [
        {
          type: "link" as const,
          title: draft.title.trim() || url.replace(/^https?:\/\//i, ""),
          url,
        },
      ];
    }),
  ];
}

function ResourcesEditor({
  drafts,
  onChange,
}: {
  readonly drafts: ResourceDraft[];
  readonly onChange: (drafts: ResourceDraft[]) => void;
}) {
  const { t } = useI18n();

  const update = (key: string, patch: Partial<ResourceDraft>) =>
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  return (
    <div className="flex flex-col gap-1.5">
      {drafts.map((draft) => (
        <div key={draft.key} className="flex items-center gap-1.5">
          <RiLink aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            size="sm"
            className="w-40"
            placeholder={t("Title")}
            value={draft.title}
            onChange={(event) => update(draft.key, { title: event.target.value })}
          />
          <Input
            size="sm"
            type="url"
            placeholder="https://"
            value={draft.url}
            onChange={(event) => update(draft.key, { url: event.target.value })}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Remove")}
            onClick={() => onChange(drafts.filter((entry) => entry.key !== draft.key))}
          >
            <RiCloseLine />
          </Button>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange([...drafts, { key: randomUUID(), title: "", url: "" }])}
        >
          <RiAddLine />
          {t("Add link")}
        </Button>
      </div>
    </div>
  );
}

/** Linear-style editor: a large title, a quiet description, then a row of property pills. */
function WorkEditor({
  heading,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  properties,
  drafts,
  onDraftsChange,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  readonly heading: string;
  readonly title: string;
  readonly onTitleChange: (title: string) => void;
  readonly description: string;
  readonly onDescriptionChange: (description: string) => void;
  readonly properties: ReactNode;
  readonly drafts: ResourceDraft[];
  readonly onDraftsChange: (drafts: ResourceDraft[]) => void;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-3 px-5 pb-5">
        <Input
          autoFocus
          aria-label={t("Title")}
          placeholder={t("Title")}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <RichTextEditor
          value={description}
          ariaLabel={t("Description")}
          placeholder={t("Add a description…")}
          onChange={onDescriptionChange}
        />
        <div className="flex flex-wrap items-center gap-1.5">{properties}</div>
        <ResourcesEditor drafts={drafts} onChange={onDraftsChange} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={pending || title.trim().length === 0}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProjectSelect({
  value,
  onChange,
  projects,
  variant,
}: {
  readonly value: ProjectId | null;
  readonly onChange: (projectId: ProjectId) => void;
  readonly projects: readonly OrchestrationProjectShell[];
  /** `ghost` is the quiet property row on a task page. */
  readonly variant?: "ghost";
}) {
  const { t } = useI18n();
  const current = projects.find((project) => project.id === value);

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        const project = projects.find((candidate) => candidate.id === next);

        if (project) onChange(project.id);
      }}
    >
      <SelectTrigger
        size="sm"
        variant={variant}
        className="w-auto min-w-0"
        aria-label={t("Project")}
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <RiBox3Line aria-hidden className="size-3.5" />
            {current?.title ?? t("Project")}
          </span>
        </SelectValue>
      </SelectTrigger>
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

export function TaskDialog({
  open,
  onOpenChange,
  environmentId,
  task,
  defaultProjectId,
  projects,
  participants,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly task: OrchestrationTask | null;
  readonly defaultProjectId: ProjectId | null;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly participants: WorkParticipants;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" showCloseButton={false}>
        {open ? (
          <TaskEditor
            key={task?.id ?? "new"}
            environmentId={environmentId}
            task={task}
            defaultProjectId={defaultProjectId}
            projects={projects}
            participants={participants}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function TaskEditor({
  environmentId,
  task,
  defaultProjectId,
  projects,
  participants,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: OrchestrationTask | null;
  readonly defaultProjectId: ProjectId | null;
  readonly projects: readonly OrchestrationProjectShell[];
  readonly participants: WorkParticipants;
  readonly onDone: () => void;
}) {
  const { t } = useI18n();
  const createTask = useAtomCommand(taskEnvironment.create);
  const updateTask = useAtomCommand(taskEnvironment.update);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");

  const [projectId, setProjectId] = useState<ProjectId | null>(
    task?.projectId ?? defaultProjectId ?? projects[0]?.id ?? null,
  );

  const [status, setStatus] = useState<WorkStatus>(task?.status ?? "backlog");
  const [owner, setOwner] = useState<WorkParticipant | null>(task?.owner ?? null);
  const [assignees, setAssignees] = useState<WorkParticipant[]>([...(task?.assignees ?? [])]);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [drafts, setDrafts] = useState(() => toDrafts(task?.resources));
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (projectId === null || title.trim().length === 0) return;

    setPending(true);

    const fields = {
      projectId,
      title: title.trim(),
      description: description.trim(),
      owner,
      assignees,
      resources: toResources(drafts, task?.resources),
      dueDate: dueDate === "" ? null : dueDate,
      status,
    };

    const result = task
      ? await updateTask({ environmentId, input: { taskId: task.id, ...fields } })
      : await createTask({
          environmentId,
          input: { taskId: TaskId.make(randomUUID()), ...fields },
        });

    setPending(false);

    if (AsyncResult.isSuccess(result)) onDone();
  };

  return (
    <WorkEditor
      heading={task ? t("Edit task") : t("New task")}
      title={title}
      onTitleChange={setTitle}
      description={description}
      onDescriptionChange={setDescription}
      drafts={drafts}
      onDraftsChange={setDrafts}
      submitLabel={task ? t("Save") : t("Create task")}
      pending={pending || projectId === null}
      onSubmit={() => void submit()}
      onCancel={onDone}
      properties={
        <>
          <WorkStatusSelect value={status} onChange={setStatus} />
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} />
          <OwnerSelect value={owner} onChange={setOwner} participants={participants} />
          <AssigneesMenu value={assignees} onChange={setAssignees} participants={participants} />
          <Input
            size="sm"
            type="date"
            aria-label={t("Due date")}
            className="w-36"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </>
      }
    />
  );
}

export function ProjectDialog({
  open,
  onOpenChange,
  environmentId,
  project,
  participants,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly project: OrchestrationProjectShell | null;
  readonly participants: WorkParticipants;
  readonly onCreated?: (projectId: ProjectId) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" showCloseButton={false}>
        {open ? (
          <ProjectEditor
            key={project?.id ?? "new"}
            environmentId={environmentId}
            project={project}
            participants={participants}
            onDone={(createdId) => {
              onOpenChange(false);

              if (createdId) onCreated?.(createdId);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function ProjectEditor({
  environmentId,
  project,
  participants,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: OrchestrationProjectShell | null;
  readonly participants: WorkParticipants;
  readonly onDone: (createdId?: ProjectId) => void;
}) {
  const { t } = useI18n();
  const createProject = useAtomCommand(projectEnvironment.create);
  const updateProject = useAtomCommand(projectEnvironment.update);
  const [title, setTitle] = useState(project?.title ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<WorkStatus>(project ? projectStatus(project) : "backlog");
  const [owner, setOwner] = useState<WorkParticipant | null>(project?.owner ?? null);
  const [drafts, setDrafts] = useState(() => toDrafts(project?.resources));
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (title.trim().length === 0) return;

    setPending(true);

    const fields = {
      title: title.trim(),
      description: description.trim(),
      owner,
      resources: toResources(drafts, project?.resources),
      status,
    };

    if (project) {
      const result = await updateProject({
        environmentId,
        input: { projectId: project.id, ...fields },
      });

      setPending(false);

      if (AsyncResult.isSuccess(result)) onDone();

      return;
    }

    const projectId = ProjectId.make(randomUUID());
    const result = await createProject({ environmentId, input: { projectId, ...fields } });
    setPending(false);

    if (AsyncResult.isSuccess(result)) onDone(projectId);
  };

  return (
    <WorkEditor
      heading={project ? t("Edit project") : t("New project")}
      title={title}
      onTitleChange={setTitle}
      description={description}
      onDescriptionChange={setDescription}
      drafts={drafts}
      onDraftsChange={setDrafts}
      submitLabel={project ? t("Save") : t("Create project")}
      pending={pending}
      onSubmit={() => void submit()}
      onCancel={() => onDone()}
      properties={
        <>
          <WorkStatusSelect value={status} onChange={setStatus} />
          <OwnerSelect value={owner} onChange={setOwner} participants={participants} />
        </>
      }
    />
  );
}
