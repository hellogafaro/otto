import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowDownSLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFileLine,
  RiFileTextLine,
  RiFileUnknowLine,
  RiImageLine,
  RiLayoutRightLine,
  RiLinkM,
  RiMoreLine,
  RiReplyLine,
  RiTimeLine,
  RiVideoLine,
} from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { AttachmentGroup } from "@workspace/ui/components/attachment";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
} from "@workspace/ui/components/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { Kbd } from "@workspace/ui/components/kbd";
import { Separator } from "@workspace/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from "@workspace/ui/components/sidebar";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Composer,
  type ComposerHandle,
  FileAttachment,
  type FileRef,
} from "@/components/composer";
import { Editor } from "@/components/editor/editor";
import { NotFound } from "@/components/empty-page";
import { MentionText, mention } from "@/components/mentions";
import { Page } from "@/components/page";
import {
  ActorAvatar,
  actorOf,
  assigneeLooks,
  formatDuration,
  type Look,
  ownerLooks,
  priorities,
  projectLooks,
  repeatLook,
  repeatPresets,
  shortDate,
  statuses,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import {
  type Activity,
  activity,
  agents,
  currentUserId,
  type ResourceKind,
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

  // AI-first: "New …" rows ask Otto, the orchestrator, in the comment box
  // instead of opening a form. The cursor lands at the end to finish the ask.
  const askOtto = (request: string) =>
    composer.current?.prefill(
      `${mention({ type: "agent", id: "a_otto", label: "Otto" })} ${request} `,
    );
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
    <SidebarProvider className="min-h-0 flex-1 flex-col">
      <Topbar
        actions={
          <>
            <MoreMenu />
            <PanelToggle />
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            {/* Crumbs are small ghost buttons with their icons, like the actions. */}
            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/tasks" search={{}} />}
                  />
                }
              >
                <RiCheckboxCircleLine data-icon="inline-start" />
                Tasks
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Button variant="ghost" size="sm" aria-current="page">
                <current.icon
                  data-icon="inline-start"
                  className={current.className}
                />
                <span className="truncate">{task.title}</span>
              </Button>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Topbar>

      <div className="flex min-h-0 flex-1">
        <SidebarInset>
          <Page title={task.title}>
            {/* -ml-2.25 puts the first avatar on the title's left edge (8px padding
                + 1px border). */}
            <div className="-mt-2 -ml-2.25 flex flex-wrap items-center gap-1 text-sm">
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
            </div>
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
                                <FileAttachment key={file.id} file={file} />
                              ))}
                            </AttachmentGroup>
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  ),
                )}
              </ul>
              <Composer
                ref={composer}
                placeholder="Leave a comment, @ to tag"
                onSend={send}
              />
            </section>
          </Page>
        </SidebarInset>

        {/* The card's 1px ring is drawn outside its box and bar buttons paint
            inside a 1px transparent border, so pt-px and pr/pb-2.5 leave 9px of
            visible space on every side, like the rail and top bar buttons. */}
        <Sidebar
          side="right"
          variant="floating"
          className="top-12 max-h-[calc(100svh-3rem)] pt-px pr-2.5 pb-2.5"
        >
          {/* Notion-style: full-width dividers between collapsible sections. */}
          <SidebarContent className="gap-0">
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
                  <DropdownMenuItem onClick={() => askOtto("repeat this")}>
                    Custom
                  </DropdownMenuItem>
                }
                plain
              />
            </Section>
            <SidebarSeparator />
            <Section title="Project">
              <ChoiceItem
                label="Project"
                value={projectId}
                options={projectLooks}
                onChange={setProjectId}
                searchable
              />
            </Section>
            <SidebarSeparator />
            <ResourcesSection taskId={task.id} />
            <SidebarSeparator />
            <TimeSection taskId={task.id} onNew={() => askOtto("I spent")} />
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}

// Corner actions on a comment card's insets: backgrounds 9px from the edges,
// icons on the 16px content line. Revealed on hover/focus; always on touch.
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
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
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

// "New resource" opens the file picker; picked files join the list at once.
// Uploads are simulated (spinner icon) until file storage exists.
function ResourcesSection({ taskId }: { taskId: string }) {
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
    <Section title="Resources" count={resources.length}>
      {resources.map((resource) => {
        const Icon = resource.uploading
          ? Spinner
          : resourceIcons[resource.kind];
        return (
          <SidebarMenuItem key={resource.id}>
            {/* The icon shows the type; hovering shows the full title, then
                type and date. */}
            <HoverCard>
              <HoverCardTrigger render={<SidebarMenuButton />}>
                <Icon />
                <span>{resource.title}</span>
              </HoverCardTrigger>
              <HoverCardContent side="left" align="start">
                <span className="font-medium">{resource.title}</span>
                <span className="text-muted-foreground">
                  {resourceTypes[resource.kind]} ·{" "}
                  {shortDate.format(new Date(resource.createdAt))}
                </span>
              </HoverCardContent>
            </HoverCard>
          </SidebarMenuItem>
        );
      })}
      <NewItem label="New resource" onClick={() => picker.current?.click()}>
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

function resourceKindOf(type: string): ResourceKind {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/") || type === "application/pdf") return "document";
  return "file";
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

// The quiet "New …" row that ends a sidebar list (the section's main action).
function NewItem({
  label,
  children,
  ...props
}: { label: string } & ComponentProps<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton {...props}>
        <RiAddLine />
        <span>{label}</span>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
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

// Page actions, kept to the main ones.
function MoreMenu() {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More" />
              }
            />
          }
        >
          <RiMoreLine />
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(location.href)}
          >
            <RiLinkM />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/* Not wired yet. */}
          <DropdownMenuItem variant="destructive">
            <RiDeleteBinLine />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Opens and closes the right panel; always the rightmost top bar action.
function PanelToggle() {
  const { open, toggleSidebar } = useSidebar();
  const label = open ? "Close panel" : "Open panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-expanded={open}
            onClick={toggleSidebar}
          />
        }
      >
        <RiLayoutRightLine />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const resourceTypes: Record<ResourceKind, string> = {
  video: "Video",
  image: "Image",
  document: "Document",
  file: "File",
};

const resourceIcons: Record<ResourceKind, RemixiconComponentType> = {
  video: RiVideoLine,
  image: RiImageLine,
  document: RiFileTextLine,
  file: RiFileLine,
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen render={<SidebarGroup />}>
      <SidebarGroupLabel
        render={<CollapsibleTrigger className="group/label" />}
      >
        {title}
        <span className="ml-auto flex items-center gap-2">
          {count !== undefined && <span className="tabular-nums">{count}</span>}
          <RiArrowDownSLine className="-rotate-90 transition-transform group-data-panel-open/label:rotate-0" />
        </span>
      </SidebarGroupLabel>
      <CollapsibleContent>
        <SidebarMenu>{children}</SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Keys typed into the description, comments or other fields never trigger shortcuts.
function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, [contenteditable=true]") !== null
  );
}

// Opens something from anywhere on the page with one key, unless typing.
function useHotkey(hotkey: string | undefined, onPress: () => void) {
  const press = useRef(onPress);
  press.current = onPress;
  useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target)
      )
        return;
      if (event.key.toLowerCase() === hotkey) {
        event.preventDefault();
        press.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);
}

// Long lists: a stock combobox with a search field, anchored to its trigger.
function ChoiceSearch<T extends string>({
  label,
  value,
  options,
  onPick,
  open,
  onOpenChange,
  anchor,
}: {
  label: string;
  value: T;
  options: Record<T, Look>;
  onPick: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
}) {
  return (
    <Combobox
      autoHighlight
      items={Object.keys(options) as T[]}
      value={value}
      onValueChange={(next) => next && onPick(next as T)}
      open={open}
      onOpenChange={onOpenChange}
      itemToStringLabel={(key) => options[key as T].label}
    >
      <ComboboxContent anchor={anchor} className="w-56">
        <ComboboxSearch placeholder={`Search ${label.toLowerCase()}`} />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(key: T) => {
            const look = options[key];
            return (
              <ComboboxItem key={key} value={key}>
                {/* 20px slot: avatars are 20px, so icons get the same column. */}
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <look.icon className={look.className} />
                </span>
                {look.label}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// Owner or assignee under the title: the person as a small ghost button with
// the Activity-size avatar; hover names the role. Opens a searchable list.
function PersonPicker({
  label,
  value,
  options,
  onChange,
  hotkey,
}: {
  label: string;
  value: string;
  options: Record<string, Look>;
  onChange: (value: string) => void;
  hotkey: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = options[value];
  useHotkey(hotkey, () => setOpen(true));

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={anchor}
              variant="ghost"
              size="sm"
              aria-label={`${label}: ${current.label}`}
              onClick={() => setOpen(true)}
            />
          }
        >
          <ActorAvatar actorId={value} />
          {current.label}
        </TooltipTrigger>
        <TooltipContent>
          {label}
          <Kbd>{hotkey.toUpperCase()}</Kbd>
        </TooltipContent>
      </Tooltip>
      <ChoiceSearch
        label={label}
        value={value}
        options={options}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
      />
    </>
  );
}

// One property row that opens a radio menu. `hotkey` opens it from anywhere
// on the page; inside, number keys pick an option (starting at `firstKey`).
function ChoiceItem<T extends string>({
  label,
  value,
  options,
  onChange,
  hotkey,
  firstKey = 1,
  searchable = false,
  extra,
  plain = false,
}: {
  label: string;
  value: T;
  options: Record<T, Look>;
  onChange: (value: T) => void;
  hotkey?: string;
  firstKey?: number;
  /** Long lists: a stock combobox with a search field instead of number keys. */
  searchable?: boolean;
  /** Actions under the options (e.g. "Custom"), after a separator. */
  extra?: ReactNode;
  /** Menu items without icons, when every option shares the row's icon. */
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLLIElement>(null);
  const keys = Object.keys(options) as T[];
  const current = options[value];
  useHotkey(hotkey, () => setOpen(true));

  const pick = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  if (searchable) {
    return (
      <SidebarMenuItem ref={anchor}>
        <SidebarMenuButton
          aria-label={`${label}: ${current.label}`}
          onClick={() => setOpen(true)}
        >
          <current.icon className={current.className} />
          <span>{current.label}</span>
        </SidebarMenuButton>
        <ChoiceSearch
          label={label}
          value={value}
          options={options}
          onPick={pick}
          open={open}
          onOpenChange={setOpen}
          anchor={anchor}
        />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton aria-label={`${label}: ${current.label}`} />
          }
        >
          <current.icon className={current.className} />
          <span>{current.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-52"
          onKeyDown={(event) => {
            const next = keys[Number(event.key) - firstKey];
            if (/^\d$/.test(event.key) && next) {
              event.preventDefault();
              pick(next);
            }
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel shortcut={hotkey?.toUpperCase()}>
              Change {label.toLowerCase()}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(next) => pick(next as T)}
            >
              {keys.map((option, index) => {
                const look = options[option];
                return (
                  <DropdownMenuRadioItem
                    key={option}
                    value={option}
                    shortcut={index + firstKey}
                  >
                    {!plain && <look.icon className={look.className} />}
                    {look.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {extra && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>{extra}</DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
