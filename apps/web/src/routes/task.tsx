import {
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiFileUnknowLine,
  RiReplyLine,
  RiTimeLine,
} from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { AttachmentGroup } from "@workspace/ui/components/attachment";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { Separator } from "@workspace/ui/components/separator";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useRef, useState } from "react";
import {
  Composer,
  type ComposerHandle,
  FileAttachment,
  type FileRef,
} from "@/components/composer";
import {
  ChoiceItem,
  DetailView,
  NewItem,
  PersonPicker,
  Section,
} from "@/components/detail";
import { Editor } from "@/components/editor/editor";
import { NotFound } from "@/components/empty-page";
import { FileItems, fileResource, Lightbox } from "@/components/files";
import { FloatingChat } from "@/components/floating-chat";
import { MentionText, mention } from "@/components/mentions";
import {
  ActorAvatar,
  actorOf,
  assigneeLooks,
  formatDuration,
  ownerLooks,
  priorities,
  projectLooks,
  repeatLook,
  repeatPresets,
  resourceKindOf,
  shortDate,
  statuses,
} from "@/components/task-meta";
import {
  type Activity,
  activity,
  agents,
  currentUserId,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
  type TaskResource,
  type TaskStatus,
  type TimeEntry,
  taskResources,
  tasks,
  timeEntries,
} from "@/mock/tasks";

export function TaskPage({ taskId }: { taskId: string }) {
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return (
      <NotFound
        icon={RiFileUnknowLine}
        title="Task not found"
        description="It may have been deleted or moved."
      />
    );
  }

  return <TaskView task={task} />;
}

// Top bar with breadcrumb and actions; title, description and activity in the
// center; properties in a right floating sidebar below the top bar.
function TaskView({ task }: { task: Task }) {
  // Local only: nothing is saved yet.
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [projectId, setProjectId] = useState(task.projectId);
  const [ownerId, setOwnerId] = useState(task.ownerId);
  const [assigneeId, setAssigneeId] = useState(
    task.assigneeAgentId ?? task.assigneeUserId ?? "none",
  );
  const [recurrence, setRecurrence] = useState<TaskRecurrence>(task.recurrence);
  const current = statuses[status];
  const [items, setItems] = useState<Activity[]>(
    activity[task.id] ?? [
      {
        id: "created",
        type: "event",
        actorId: task.ownerId,
        body: "created the task",
        createdAt: task.updatedAt,
      },
    ],
  );
  const composer = useRef<ComposerHandle>(null);
  const ask = useRef<ComposerHandle>(null);
  // Files attached to comments open in the file viewer, stepping
  // through all of them in order.
  const commentFiles = items.flatMap(({ files = [], createdAt }) =>
    files.map((file) => fileResource(file, createdAt)),
  );
  const [openFileId, setOpenFileId] = useState<string>();

  // AI-first: "New …" rows prefill Ask Otto (a new chat about this task, not
  // a comment) instead of opening a form: a sentence-case start the cursor
  // lands after.
  const askOtto = (request: string) => ask.current?.prefill(`${request} `);
  // Replies stay flat: Reply tags the author at the start of the draft.
  const reply = (actorId: string) =>
    composer.current?.prepend(
      `${mention({
        type: actorId in agents ? "agent" : "user",
        id: actorId,
        label: actorOf(actorId).name,
      })} `,
    );
  const [description, setDescription] = useState(task.notes);

  const send = (body: string, files: FileRef[]) => {
    setItems((current) => [
      ...current,
      {
        id: `local-${current.length}`,
        type: "comment",
        actorId: currentUserId,
        body,
        files,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    <DetailView
      parent={{
        label: "Tasks",
        icon: RiCheckboxCircleLine,
        link: <Link to="/tasks" search={{}} />,
      }}
      current={current}
      title={task.title}
      ask={
        <FloatingChat
          ref={ask}
          about="this task"
          projectId={task.projectId}
          subject={{ type: "task", id: task.id, label: task.title }}
        />
      }
      people={
        <>
          <PersonPicker
            label="Owner"
            value={ownerId}
            options={ownerLooks}
            onChange={setOwnerId}
            hotkey="o"
          />
          <PersonPicker
            label="Assignee"
            value={assigneeId}
            options={assigneeLooks}
            onChange={setAssigneeId}
            hotkey="a"
          />
        </>
      }
      panel={
        <>
          <Section title="Properties">
            <ChoiceItem
              label="Status"
              value={status}
              options={statuses}
              onChange={setStatus}
              hotkey="s"
            />
            <ChoiceItem
              label="Priority"
              value={priority}
              options={priorities}
              onChange={setPriority}
              hotkey="p"
              firstKey={0}
            />
            <ChoiceItem
              label="Repeat"
              value={recurrence}
              // A custom rule joins the presets so it shows as selected.
              options={{
                ...repeatPresets,
                [recurrence]: repeatLook(recurrence),
              }}
              onChange={setRecurrence}
              hotkey="r"
              firstKey={0}
              extra={
                <DropdownMenuItem
                  onClick={() => askOtto("Repeat this task every")}
                >
                  Custom
                </DropdownMenuItem>
              }
              plain
            />
          </Section>
          <Section title="Project">
            <ChoiceItem
              label="Project"
              value={projectId}
              options={projectLooks}
              onChange={setProjectId}
              searchable
            />
          </Section>
          <FilesSection taskId={task.id} />
          <TimeSection taskId={task.id} onNew={() => askOtto("I spent")} />
        </>
      }
    >
      {/* Description: the backend field is `notes`. */}
      <Editor
        value={description}
        onChange={setDescription}
        placeholder="Add description"
      />

      <section className="flex flex-col gap-5">
        <h2 className="text-base font-medium">Activity</h2>
        <ul className="flex flex-col gap-5">
          {items.map((item) =>
            item.type === "event" ? (
              // px-4 lines the avatar up with the avatars in comment cards.
              <li
                key={item.id}
                className="flex items-center gap-2 px-4 text-sm text-muted-foreground"
              >
                <ActorAvatar actorId={item.actorId} />
                <span>
                  {actorOf(item.actorId).name} {item.body} ·{" "}
                  <span className="tabular-nums">
                    {shortDate.format(new Date(item.createdAt))}
                  </span>
                </span>
              </li>
            ) : (
              <li key={item.id}>
                <Card size="sm" className="relative">
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <ActorAvatar actorId={item.actorId} />
                      <span className="font-medium">
                        {actorOf(item.actorId).name}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {shortDate.format(new Date(item.createdAt))}
                      </span>
                      <CommentActions
                        body={item.body}
                        onReply={
                          item.actorId === currentUserId
                            ? undefined
                            : () => reply(item.actorId)
                        }
                      />
                    </div>
                    {item.body && (
                      <p className="whitespace-pre-line">
                        <MentionText text={item.body} />
                      </p>
                    )}
                    {item.files && item.files.length > 0 && (
                      <AttachmentGroup>
                        {item.files.map((file) => (
                          <FileAttachment
                            key={file.id}
                            file={file}
                            onOpen={() => setOpenFileId(file.id)}
                          />
                        ))}
                      </AttachmentGroup>
                    )}
                  </CardContent>
                </Card>
              </li>
            ),
          )}
        </ul>
        <Lightbox
          resources={commentFiles}
          openId={openFileId}
          onOpen={setOpenFileId}
        />
        <Composer
          ref={composer}
          placeholder="Leave a comment, @ to tag"
          onSend={send}
        />
      </section>
    </DetailView>
  );
}

// Corner actions on a comment card: 4px from the edges, so their 8px
// corners nest in the card's 12px (8 + 4). Revealed on hover/focus; always on touch.
// Copy shows a check for a moment; Reply is left out on your own comments.
function CommentActions({
  body,
  onReply,
}: {
  body: string;
  onReply?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? "Copied" : "Copy"}
              onClick={copy}
            />
          }
        >
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
      </Tooltip>
      {onReply && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reply"
                onClick={onReply}
              />
            }
          >
            <RiReplyLine />
          </TooltipTrigger>
          <TooltipContent>Reply</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// "New file" opens the file picker; picked files join the list at once.
// Uploads are simulated (spinner icon) until file storage exists.
function FilesSection({ taskId }: { taskId: string }) {
  const [resources, setResources] = useState<
    (TaskResource & { uploading?: boolean })[]
  >(taskResources[taskId] ?? []);
  const picker = useRef<HTMLInputElement>(null);

  const add = (files: FileList) => {
    const added = [...files].map((file) => ({
      id: crypto.randomUUID(),
      title: file.name,
      kind: resourceKindOf(file.type),
      createdAt: new Date().toISOString(),
      uploading: true,
    }));
    setResources((current) => [...current, ...added]);
    setTimeout(
      () =>
        setResources((current) =>
          current.map((resource) =>
            added.some(({ id }) => id === resource.id)
              ? { ...resource, uploading: false }
              : resource,
          ),
        ),
      900,
    );
  };

  return (
    <Section title="Files" count={resources.length}>
      <FileItems resources={resources} />
      <NewItem label="New file" onClick={() => picker.current?.click()}>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
      </NewItem>
    </Section>
  );
}

// Adding and editing time goes through Otto in the comment box; deleting is
// an instant human action and stays here.
function TimeSection({ taskId, onNew }: { taskId: string; onNew: () => void }) {
  const [entries, setEntries] = useState<TimeEntry[]>(
    timeEntries[taskId] ?? [],
  );
  const total = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  return (
    <Section title="Time" count={total ? formatDuration(total) : undefined}>
      {entries.map((entry) => (
        <TimeEntryItem
          key={entry.id}
          entry={entry}
          onDelete={() =>
            setEntries((current) =>
              current.filter((candidate) => candidate.id !== entry.id),
            )
          }
        />
      ))}
      <NewItem label="New time entry" onClick={onNew} />
    </Section>
  );
}

const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

// Who tracked it, how long and which day; hover for the note.
function TimeEntryItem({
  entry,
  onDelete,
}: {
  entry: TimeEntry;
  onDelete: () => void;
}) {
  const actor = actorOf(entry.actorId);
  return (
    <SidebarMenuItem>
      <HoverCard>
        <HoverCardTrigger render={<SidebarMenuButton />}>
          <RiTimeLine />
          <span>
            <span className="tabular-nums">
              {formatDuration(entry.minutes)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              <span className="tabular-nums">
                {shortDate.format(new Date(entry.date))}
              </span>
            </span>
          </span>
        </HoverCardTrigger>
        <HoverCardContent side="left" align="start">
          <span>
            <span className="font-medium tabular-nums">
              {formatDuration(entry.minutes)}
            </span>{" "}
            by {actor.name}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {day.format(new Date(entry.date))}
          </span>
          {entry.note && (
            <>
              {/* my-1.5 + the card's 2px gap = 8px around the divider. */}
              <Separator className="my-1.5" />
              <span>{entry.note}</span>
            </>
          )}
        </HoverCardContent>
      </HoverCard>
      <SidebarMenuAction
        showOnHover
        aria-label="Delete time entry"
        onClick={onDelete}
      >
        <RiCloseLine />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
