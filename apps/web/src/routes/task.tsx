import {
  RiArchiveLine,
  RiBox3Line,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiEditLine,
  RiFileUnknowLine,
  RiLinkM,
  RiMoreLine,
  RiRepeatLine,
} from "@remixicon/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { useState } from "react";
import { ChoiceItem, DetailView, Section } from "@/components/detail";
import { Editor } from "@/components/editor/editor";
import { NotFound } from "@/components/empty-page";
import { FloatingChat } from "@/components/floating-chat";
import { QueryState } from "@/components/query-state";
import { People, statuses } from "@/components/task-meta";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskReview } from "@/components/tasks/task-review";
import {
  TaskLinksSection,
  TaskTimeSection,
} from "@/components/tasks/task-sections";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { type Task, taskStatusOrder, useTaskProject } from "@/lib/task-data";
import { useWorkspace } from "@/lib/workspace";

export function TaskPage({ taskId }: { taskId: string }) {
  const { api, workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: ["workspace", workspaceId, "task", taskId],
    queryFn: async ({ signal }) =>
      read(
        await api.tasks[":id"].$get(
          { param: { workspaceId, id: taskId } },
          { init: { signal } },
        ),
      ),
    retry: false,
  });
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <NotFound
        icon={RiFileUnknowLine}
        title="Task not found"
        description="It may be unavailable or outside your current workspace."
      />
    );
  if (!query.data || query.error)
    return (
      <QueryState
        pending={query.isPending}
        error={query.error}
        retry={query.refetch}
      />
    );
  return <TaskView key={taskId} task={query.data} />;
}

function TaskView({ task }: { task: Task }) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const directory = useDirectory();
  const project = useTaskProject(task.projectId);
  const [editing, setEditing] = useState(false);
  const current = statuses[task.status];
  const control = useMutation({
    mutationFn: async (
      action: Exclude<Task["status"], "review"> | "archive",
    ) =>
      action === "archive"
        ? read(
            await api.tasks[":id"].archive.$post({
              param: { workspaceId, id: task.id },
              json: { archived: !task.archived, editToken: task.editToken },
            }),
          )
        : read(
            await api.tasks[":id"].status.$post({
              param: { workspaceId, id: task.id },
              json: { status: action, editToken: task.editToken },
            }),
          ),
    onSuccess: () => invalidate(),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Unable to copy link");
    }
  };
  const people = [
    ...new Set([
      task.ownerId,
      ...task.assigneeUserIds,
      ...task.assigneeAgentIds,
    ]),
  ];
  return (
    <DetailView
      parent={{
        label: "Tasks",
        icon: RiCheckboxCircleLine,
        link: <Link to="/tasks" search={{ project: task.projectId }} />,
      }}
      current={current}
      title={task.title}
      type="task"
      more={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="More" />}
          >
            <RiMoreLine />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={copy}>
                <RiLinkM />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!project.canWrite || control.isPending}
                onClick={() => control.mutate("archive")}
              >
                <RiArchiveLine />
                {task.archived ? "Restore" : "Archive"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={!project.canWrite || control.isPending}
          onClick={() => setEditing(true)}
        >
          <RiEditLine data-icon="inline-start" />
          Edit task
        </Button>
      }
      people={
        <>
          <People ids={people} />
          <span className="text-muted-foreground">
            Owner: {directory.actorOf(task.ownerId).name}
          </span>
        </>
      }
      ask={
        <FloatingChat
          about="this task"
          projectId={task.projectId}
          subject={{ type: "task", id: task.id, label: task.title }}
        />
      }
      panel={
        <>
          <Section title="Properties">
            {project.canWrite &&
            !control.isPending &&
            task.status !== "review" ? (
              <ChoiceItem
                label="Status"
                value={task.status}
                options={
                  Object.fromEntries(
                    taskStatusOrder
                      .filter((status) => status !== "review")
                      .map((status) => [status, statuses[status]]),
                  ) as Record<
                    Exclude<Task["status"], "review">,
                    typeof statuses.todo
                  >
                }
                onChange={(status) => control.mutate(status)}
                hotkey={editing ? undefined : "s"}
              />
            ) : (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <current.icon className={current.className} />
                  <span>{statuses[task.status].label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <RiCalendarLine />
                <span>
                  {task.dueAt
                    ? new Date(task.dueAt).toLocaleDateString("en", {
                        dateStyle: "medium",
                      })
                    : "No due date"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <RiRepeatLine />
                <span>{task.recurrence ? "Repeats" : "No repeat"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {task.archived && (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <RiArchiveLine />
                  <span>Archived</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </Section>
          <Section title="Project">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: task.projectId }}
                  />
                }
              >
                <RiBox3Line />
                <span>
                  {directory.projects.find((item) => item.id === task.projectId)
                    ?.title ?? "Open project"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </Section>
          <TaskLinksSection task={task} canWrite={project.canWrite} />
          <TaskTimeSection task={task} canWrite={project.canWrite} />
        </>
      }
    >
      <QueryState
        pending={project.query.isPending}
        error={project.query.error ?? control.error}
        retry={() => {
          void project.query.refetch();
          void invalidate();
          control.reset();
        }}
      />
      {project.query.hasNextPage && (
        <Button
          variant="outline"
          disabled={project.query.isFetchingNextPage}
          onClick={() => project.query.fetchNextPage()}
        >
          Load more project members
        </Button>
      )}
      <TaskNotes task={task} canWrite={project.canWrite} />
      <TaskReview task={task} canWrite={project.canWrite} />
      {task.successorId && (
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link to="/tasks/$taskId" params={{ taskId: task.successorId }} />
          }
        >
          Next occurrence
        </Button>
      )}
      {task.predecessorId && (
        <Button
          variant="ghost"
          nativeButton={false}
          render={
            <Link to="/tasks/$taskId" params={{ taskId: task.predecessorId }} />
          }
        >
          Previous occurrence
        </Button>
      )}
      <TaskComments task={task} canWrite={project.canWrite} />
      {editing && (
        <TaskForm
          task={task}
          projectId={task.projectId}
          onClose={() => setEditing(false)}
        />
      )}
    </DetailView>
  );
}

function TaskNotes({ task, canWrite }: { task: Task; canWrite: boolean }) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [draft, setDraft] = useState<{ notes: string; editToken: number }>();
  const [generation, setGeneration] = useState(0);
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No description to save");
      return read(
        await api.tasks[":id"].$patch({
          param: { workspaceId, id: task.id },
          json: draft,
        }),
      );
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await invalidate();
    },
    onSuccess: async () => {
      await invalidate();
      setDraft(undefined);
      setGeneration((value) => value + 1);
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {!draft && canWrite && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() =>
            setDraft({ notes: task.notes, editToken: task.editToken })
          }
        >
          Edit description
        </Button>
      )}
      <Editor
        key={draft ? `draft-${generation}` : `${task.editToken}-${generation}`}
        value={draft?.notes ?? task.notes}
        readOnly={!draft || !canWrite || save.isPending}
        placeholder="Add description"
        onChange={(notes) =>
          setDraft((current) => ({
            notes,
            editToken: current?.editToken ?? task.editToken,
          }))
        }
      />
      {draft && (
        <div className="flex gap-2">
          <Button
            disabled={save.isPending || !canWrite}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving" : "Save description"}
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              setDraft(undefined);
              setGeneration((value) => value + 1);
              save.reset();
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      <QueryState error={save.error} />
      {save.error instanceof ApiError && save.error.status === 409 && (
        <p className="text-muted-foreground">
          Cancel and reopen the description to use the current task.
        </p>
      )}
    </div>
  );
}
