import { type RemixiconComponentType, RiUserLine } from "@remixicon/react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useRef, useState } from "react";
import { ChoiceSearch } from "@/components/detail";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import {
  type Task,
  type TaskCreate,
  type TaskUpdate,
  taskDueInput,
  useTaskProject,
} from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

export function TaskPicker({
  label,
  value,
  options,
  onChange,
  disabled,
  icon = RiUserLine,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange(value: string): void;
  disabled?: boolean;
  icon?: RemixiconComponentType;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {options[value] ?? "Choose"}
      </Button>
      <ChoiceSearch
        label={label}
        value={value}
        options={Object.fromEntries(
          Object.entries(options).map(([id, name]) => [
            id,
            { label: name, icon },
          ]),
        )}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
      />
    </>
  );
}

/** A dialog captures the original editToken; a background refresh cannot bless a stale draft. */
export function TaskForm({
  projectId,
  task,
  onClose,
  onCreated,
}: {
  projectId: string;
  task?: Task;
  onClose(): void;
  onCreated?(task: Task): void;
}) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const directory = useDirectory();
  const project = useTaskProject(projectId);
  const [baseline] = useState(task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [ownerId, setOwnerId] = useState(task?.ownerId ?? user.id);
  const [users, setUsers] = useState(task?.assigneeUserIds ?? []);
  const [agents, setAgents] = useState(task?.assigneeAgentIds ?? []);
  const [due, setDue] = useState(taskDueInput(task?.dueAt ?? null));
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? "");
  const usersChanged =
    baseline &&
    JSON.stringify([...users].sort()) !==
      JSON.stringify([...baseline.assigneeUserIds].sort());
  const agentsChanged =
    baseline &&
    JSON.stringify([...agents].sort()) !==
      JSON.stringify([...baseline.assigneeAgentIds].sort());
  const changed =
    !baseline ||
    title.trim() !== baseline.title ||
    notes !== baseline.notes ||
    ownerId !== baseline.ownerId ||
    due !== taskDueInput(baseline.dueAt) ||
    (recurrence.trim() || null) !== baseline.recurrence ||
    usersChanged ||
    agentsChanged;
  const transfer =
    !task ||
    task.ownerId === user.id ||
    workspace.role === "owner" ||
    workspace.role === "admin";
  const humanOptions = project.members.filter(
    (member) =>
      member.role === "contributor" &&
      !directory.members.some(
        (person) => person.userId === member.userId && person.role === "viewer",
      ),
  );
  const botOptions = directory.agents.filter(
    (agent) => !agent.projectId || agent.projectId === projectId,
  );
  const owners = Object.fromEntries(
    humanOptions.map((member) => [member.userId, member.name]),
  );
  if (task && !owners[task.ownerId])
    owners[task.ownerId] = directory.actorOf(task.ownerId).name;
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        title: title.trim(),
        notes,
        dueAt: due ? new Date(due).toISOString() : null,
        recurrence: recurrence.trim() || null,
      };
      if (baseline) {
        // Omitted fields preserve their exact server value, including sub-minute due dates and retained assignments.
        const json: TaskUpdate = {
          editToken: baseline.editToken,
          ...(title.trim() !== baseline.title ? { title: fields.title } : {}),
          ...(notes !== baseline.notes ? { notes } : {}),
          ...(due !== taskDueInput(baseline.dueAt)
            ? { dueAt: fields.dueAt }
            : {}),
          ...(fields.recurrence !== baseline.recurrence
            ? { recurrence: fields.recurrence }
            : {}),
          ...(ownerId !== baseline.ownerId ? { ownerId } : {}),
          ...(usersChanged ? { assigneeUserIds: users } : {}),
          ...(agentsChanged ? { assigneeAgentIds: agents } : {}),
        };
        return read(
          await api.tasks[":id"].$patch({
            param: { workspaceId, id: baseline.id },
            json,
          }),
        );
      }
      const json: TaskCreate = {
        ...fields,
        projectId,
        ownerId,
        assigneeUserIds: users,
        assigneeAgentIds: agents,
      };
      try {
        return await read(
          await api.tasks.$post({ param: { workspaceId }, json }),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new Error(
          "Could not confirm whether the task was saved. Check the task list before submitting again.",
        );
      }
    },
    onSuccess: async (saved) => {
      await invalidate();
      onCreated?.(saved);
      onClose();
    },
  });
  const toggle = (values: string[], id: string, checked: boolean) =>
    checked ? [...values, id] : values.filter((value) => value !== id);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90svh] overflow-y-auto"
        showCloseButton={!save.isPending}
      >
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {directory.projects.find((item) => item.id === projectId)?.title ??
              "Task project"}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-title">Title</FieldLabel>
              <Input
                id="task-title"
                required
                maxLength={200}
                value={title}
                disabled={save.isPending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-notes">Description</FieldLabel>
              <Textarea
                id="task-notes"
                maxLength={100000}
                value={notes}
                disabled={save.isPending}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <QueryState
              pending={project.query.isPending}
              error={project.query.error ?? directory.error}
              retry={() => {
                void project.query.refetch();
                void directory.membersQuery.refetch();
                void directory.agentsQuery.refetch();
              }}
            />
            <Field>
              <FieldLabel>Owner</FieldLabel>
              <TaskPicker
                label="Task owner"
                value={ownerId}
                options={owners}
                onChange={setOwnerId}
                disabled={save.isPending || !transfer}
              />
              <FieldDescription>
                A human with current Project writer access is required.
              </FieldDescription>
            </Field>
            {directory.membersQuery.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={directory.membersQuery.isFetchingNextPage}
                onClick={() => directory.membersQuery.fetchNextPage()}
              >
                Load more workspace members
              </Button>
            )}
            {project.query.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={project.query.isFetchingNextPage}
                onClick={() => project.query.fetchNextPage()}
              >
                Load more project members
              </Button>
            )}
            <FieldSet>
              <FieldLegend>Assignees</FieldLegend>
              <FieldDescription>
                Up to 20 people and 20 agents. Assignment grants no access.
              </FieldDescription>
              <FieldGroup className="max-h-40 overflow-y-auto">
                <FieldSet>
                  <FieldLegend>People</FieldLegend>
                  <FieldGroup>
                    {[
                      ...new Set([
                        ...users,
                        ...humanOptions.map((member) => member.userId),
                      ]),
                    ].map((id) => (
                      <Field key={id} orientation="horizontal">
                        <Checkbox
                          id={`task-user-${id}`}
                          checked={users.includes(id)}
                          disabled={
                            save.isPending ||
                            (!users.includes(id) && users.length >= 20)
                          }
                          onCheckedChange={(checked) =>
                            setUsers(toggle(users, id, checked === true))
                          }
                        />
                        <FieldLabel htmlFor={`task-user-${id}`}>
                          {humanOptions.find((member) => member.userId === id)
                            ?.name ?? directory.actorOf(id).name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
                <FieldSet>
                  <FieldLegend>Agents</FieldLegend>
                  <FieldGroup>
                    {[
                      ...new Set([
                        ...agents,
                        ...botOptions.map((agent) => agent.id),
                      ]),
                    ].map((id) => (
                      <Field key={id} orientation="horizontal">
                        <Checkbox
                          id={`task-agent-${id}`}
                          checked={agents.includes(id)}
                          disabled={
                            save.isPending ||
                            (!agents.includes(id) && agents.length >= 20)
                          }
                          onCheckedChange={(checked) =>
                            setAgents(toggle(agents, id, checked === true))
                          }
                        />
                        <FieldLabel htmlFor={`task-agent-${id}`}>
                          {botOptions.find((agent) => agent.id === id)?.title ??
                            directory.actorOf(id).name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </FieldSet>
            {directory.agentsQuery.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={directory.agentsQuery.isFetchingNextPage}
                onClick={() => directory.agentsQuery.fetchNextPage()}
              >
                Load more agents
              </Button>
            )}
            <Field>
              <FieldLabel htmlFor="task-due">Due date</FieldLabel>
              <Input
                id="task-due"
                type="datetime-local"
                value={due}
                disabled={save.isPending}
                onChange={(event) => setDue(event.target.value)}
              />
              <FieldDescription>
                Uses your browser’s time zone. Leave blank to clear.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="task-recurrence">Repeat</FieldLabel>
              <Textarea
                id="task-recurrence"
                maxLength={400}
                value={recurrence}
                disabled={save.isPending}
                onChange={(event) => setRecurrence(event.target.value)}
                placeholder={
                  "DTSTART;TZID=Europe/Berlin:20261005T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO"
                }
              />
              <FieldDescription>
                One DTSTART with an IANA time zone and one RRULE. Leave blank
                for no repeat. Done creates the next occurrence when one
                remains.
              </FieldDescription>
            </Field>
            <QueryState error={save.error} />
            {save.error instanceof ApiError && save.error.status === 409 && (
              <FieldDescription>
                Cancel and reopen this editor to use the current task.
              </FieldDescription>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  !project.canWrite ||
                  Boolean(directory.error) ||
                  directory.pending ||
                  !title.trim() ||
                  !ownerId ||
                  !changed
                }
              >
                {save.isPending ? "Saving" : task ? "Save task" : "Create task"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
