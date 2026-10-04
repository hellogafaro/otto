import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBox3Line,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiLinkM,
  RiMoreLine,
  RiPushpinLine,
  RiTimeLine,
  RiUnpinLine,
} from "@remixicon/react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { AttachmentGroup } from "@workspace/ui/components/attachment";
import { AvatarGroup } from "@workspace/ui/components/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@workspace/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@workspace/ui/components/questionnaire";
import { Separator } from "@workspace/ui/components/separator";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Composer, FileAttachment, type FileRef } from "@/components/composer";
import {
  ChoiceItem,
  ChoiceSearch,
  NewItem,
  PanelToggle,
  Section,
  WithPanel,
} from "@/components/detail";
import { NotFound } from "@/components/empty-page";
import { FileItems, fileResource, Lightbox } from "@/components/files";
import { MentionText } from "@/components/mentions";
import { SectionSidebar } from "@/components/section-sidebar";
import {
  ActorAvatar,
  actorOf,
  byUrgency,
  ChatIcon,
  Count,
  chatKind,
  chatOther,
  chatState,
  chatStatus,
  chatWithLooks,
  type Look,
  nameColors,
  needsYou,
  projectLooks,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import {
  agents,
  type Chat,
  type ChatMessage,
  type ChatQuestion,
  type ChatRun,
  chats,
  currentUserId,
  projects,
  type Resource,
} from "@/mock/tasks";

// Pinned, Waiting, Working, Snoozed and Done: the sidebar's groups, and the
// chat panel's search. Archived chats and sub-threads (shown in their
// parent) stay out.
export function chatGroups() {
  const now = new Date().toISOString();
  const snoozed = (chat: Chat) =>
    Boolean(chat.snoozedUntil && chat.snoozedUntil > now);
  const live = chats.filter((chat) => !chat.archived && !chat.parentId);
  const pinned = live.filter((chat) => chat.pinned);
  const rest = live.filter((chat) => !chat.pinned);
  const working = (chat: Chat) => chatState(chat) === "working";
  const current = rest.filter((chat) => !chat.done && !snoozed(chat));
  return [
    { title: "Pinned", chats: pinned, open: true },
    // Your turn: what needs you first, then the most recent.
    {
      title: "Waiting",
      chats: current.filter((chat) => !working(chat)).sort(byUrgency),
      open: true,
    },
    {
      title: "Working",
      chats: current.filter(working).sort(byUrgency),
      open: true,
    },
    {
      title: "Snoozed",
      chats: rest.filter((chat) => !chat.done && snoozed(chat)),
      open: false,
    },
    { title: "Done", chats: rest.filter((chat) => chat.done), open: false },
  ];
}

// The Chats sidebar (sub-threads open from their parent chat, not here),
// grouped by where each stands, not by kind: Pinned,
// Waiting (your turn: what needs you first, then the most recent), Working
// (an agent is at it), then Snoozed and Done, folded. Any chat can be in any group: a
// channel (#: a project's one channel or any group of people and agents) or
// a one-to-one chat with an agent or a person (their avatar); you can have
// several with the same one. Archived chats only come up in search.
export function ChatsSidebar() {
  const matchRoute = useMatchRoute();
  // Organizing a chat changes the mock in memory; this redraws the list.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const open = matchRoute({ to: "/chats/$chatId" });
  const openChat = open
    ? chats.find(({ id }) => id === open.chatId)
    : undefined;
  const groups = chatGroups();
  return (
    <SectionSidebar
      title="Chats"
      actions={
        // A new chat starts in the open chat's project.
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New chat"
                nativeButton={false}
                render={
                  <Link
                    to="/chats/new"
                    search={{ with: undefined, project: openChat?.projectId }}
                  />
                }
              />
            }
          >
            <RiAddLine />
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
      }
    >
      {groups.map(
        (group) =>
          group.chats.length > 0 && (
            <Collapsible key={group.title} defaultOpen={group.open}>
              {/* gap-2: the rows' icon-to-label gap, for the count. */}
              <SidebarGroupLabel
                render={
                  <CollapsibleTrigger className="group/label w-full gap-2" />
                }
              >
                {group.title}
                <Count>{group.chats.length}</Count>
                <RiArrowDownSLine className="ml-auto -rotate-90 transition-transform group-data-panel-open/label:rotate-0" />
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarMenu>
                  {group.chats.map((chat) => (
                    <ChatRow key={chat.id} chat={chat} onChange={redraw} />
                  ))}
                </SidebarMenu>
              </CollapsibleContent>
            </Collapsible>
          ),
      )}
    </SectionSidebar>
  );
}

// 2m, 3h, 4d, 2w: how long since the last message.
export function ago(createdAt?: string) {
  if (!createdAt) return "";
  const minutes = Math.max(0, (Date.now() - Date.parse(createdAt)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 10_080)}w`;
}

// One chat on one line: its icon and its whole title (no ellipsis), with a
// slot on the right that holds one thing at a time: its status icon
// (waiting on you, working, draft, done), else the time since its last
// message; on hover, keyboard focus or an open menu, only Pin, Archive and
// More. The slot takes the row's own color, solid, fading in from the left
// over the title.
// News you haven't read is brighter. Hovering the title shows its details.
function ChatRow({ chat, onChange }: { chat: Chat; onChange: () => void }) {
  const matchRoute = useMatchRoute();
  const state = chatState(chat);
  const urgent = needsYou(state);
  const last = chat.messages.at(-1);
  const status = chatStatus(chat);
  const change = (update: Partial<Chat>) => {
    Object.assign(chat, update);
    onChange();
  };
  return (
    <SidebarMenuItem>
      <HoverCard>
        <HoverCardTrigger
          delay={500}
          render={
            <SidebarMenuButton
              isActive={Boolean(
                matchRoute({
                  to: "/chats/$chatId",
                  params: { chatId: chat.id },
                }),
              )}
              // Chat titles stay normal weight, even when open, and run to
              // the row's edge under the status slot instead of truncating.
              className="group-has-data-[sidebar=menu-action]/menu-item:pr-2 data-active:font-normal"
              render={<Link to="/chats/$chatId" params={{ chatId: chat.id }} />}
            />
          }
        >
          <ChatIcon chat={chat} />
          <span
            className={cn(
              "text-clip!",
              (state === "unread" || urgent) && "text-foreground",
            )}
          >
            {chat.title}
          </span>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-64 gap-1">
          <ChatDetails chat={chat} />
        </HoverCardContent>
      </HoverCard>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-(--slot) pr-1 pl-1 text-xs text-muted-foreground [--slot:var(--background)] group-hover/menu-item:[--slot:var(--muted)] group-has-data-active/menu-item:[--slot:var(--secondary)] group-has-data-active/menu-item:group-hover/menu-item:[--slot:color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]! before:absolute before:inset-y-0 before:right-full before:w-6 before:bg-linear-to-r before:from-transparent before:to-(--slot) dark:group-hover/menu-item:[--slot:color-mix(in_oklch,var(--muted)_50%,var(--background))]">
        <span className="flex min-w-5 items-center justify-center px-1 group-hover/menu-item:hidden group-has-focus-visible/menu-item:hidden group-has-[[aria-expanded=true]]/menu-item:hidden">
          {status ? (
            <>
              <status.icon className={cn("size-3.5", status.className)} />
              <span className="sr-only">{status.label}</span>
            </>
          ) : (
            ago(last?.createdAt)
          )}
        </span>
        <span className="pointer-events-auto hidden items-center gap-0.5 group-hover/menu-item:flex group-has-focus-visible/menu-item:flex group-has-[[aria-expanded=true]]/menu-item:flex">
          <ChatActions chat={chat} onChange={change} />
        </span>
      </div>
    </SidebarMenuItem>
  );
}

// Pin, Archive and More (done, snooze, copy link): 24px, 2px apart, 4px
// inside the 32px row (xs 4 corners).
function ChatActions({
  chat,
  onChange,
}: {
  chat: Chat;
  onChange: (update: Partial<Chat>) => void;
}) {
  const snoozeFor = (hours: number) =>
    onChange({
      snoozedUntil: new Date(Date.now() + hours * 3_600_000).toISOString(),
    });
  return (
    <>
      <RowAction
        label={chat.pinned ? "Unpin" : "Pin"}
        onClick={() => onChange({ pinned: !chat.pinned })}
      >
        {chat.pinned ? <RiUnpinLine /> : <RiPushpinLine />}
      </RowAction>
      <RowAction
        label="Archive"
        onClick={() => onChange({ archived: true, pinned: false })}
      >
        <RiArchiveLine />
      </RowAction>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <SidebarMenuAction className="static" aria-label="More" />
                }
              />
            }
          >
            <RiMoreLine />
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" side="right" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() =>
                onChange({ done: !chat.done, snoozedUntil: undefined })
              }
            >
              <RiCheckboxCircleLine />
              {chat.done ? "Mark as active" : "Mark as done"}
            </DropdownMenuItem>
            {chat.snoozedUntil &&
            chat.snoozedUntil > new Date().toISOString() ? (
              <DropdownMenuItem
                onClick={() => onChange({ snoozedUntil: undefined })}
              >
                <RiTimeLine />
                Unsnooze
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <RiTimeLine />
                  Snooze
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  <DropdownMenuItem onClick={() => snoozeFor(3)}>
                    For 3 hours
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snoozeFor(18)}>
                    Until tomorrow
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => snoozeFor(24 * 7)}>
                    For a week
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard.writeText(
                  `${location.origin}/chats/${chat.id}`,
                )
              }
            >
              <RiLinkM />
              Copy link
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuAction
            className="static"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// The hover details: kind and time since the last message, the full title,
// then members, project, state and when it started.
// The row's hover card, kept light: the whole title, what the chat is, who is
// in it and when it last moved. No icon and no state; the row shows those.
function ChatDetails({ chat }: { chat: Chat }) {
  const kind = chatKind(chat);
  const other = chatOther(chat);
  const project = chat.projectId ? projects[chat.projectId] : undefined;
  const what = chat.general
    ? "General chat"
    : kind === "channel"
      ? "Group chat"
      : `Chat with ${other ? actorOf(other).name : "you"}`;
  const last = ago(chat.messages.at(-1)?.createdAt ?? chat.createdAt);
  return (
    <>
      <span className="font-medium">{chat.title}</span>
      <span className="text-muted-foreground">
        {project ? `${what} in ${project.title}` : what}
      </span>
      {/* Two groups, what it is and who and when, divided 12px apart
          (my-2 + the card's 4px gap). */}
      <Separator className="my-2" />
      <span className="flex items-center gap-2 text-muted-foreground">
        <AvatarGroup>
          {chat.memberIds.map((id) => (
            <ActorAvatar key={id} actorId={id} />
          ))}
        </AvatarGroup>
        {chat.memberIds.length} members
      </span>
      {last && (
        <span className="text-muted-foreground">
          {last === "now" ? "Active now" : `Active ${last} ago`}
        </span>
      )}
    </>
  );
}

export function ChatPage({ chatId }: { chatId: string }) {
  const chat = chats.find(({ id }) => id === chatId);
  if (!chat) {
    return (
      <NotFound
        icon={RiChat1Line}
        title="Chat not found"
        description="It may have been deleted or you may have left it."
      />
    );
  }
  return <ChatView key={chat.id} chat={chat} />;
}

// One chat: the top bar names it; the conversation scrolls in the page
// column and opens at the latest message; the composer sits under it.
function ChatView({ chat }: { chat: Chat }) {
  const [messages, setMessages] = useState(chat.messages);
  const [projectId, setProjectId] = useState(chat.projectId);
  const kind = chatKind(chat);
  const other = chatOther(chat);
  const parent = chat.parentId
    ? chats.find(({ id }) => id === chat.parentId)
    : undefined;
  const name = chat.general
    ? `#${chat.title}`
    : kind === "channel" || !other
      ? chat.title
      : actorOf(other).name;
  const send = (body: string, files?: FileRef[]) =>
    setMessages((current) => [
      ...current,
      {
        id: `local-${current.length}`,
        actorId: currentUserId,
        body,
        files,
        createdAt: new Date().toISOString(),
      },
    ]);

  // Everything shared in the chat, newest first: one viewer for the
  // attachments in messages and the panel's list.
  const shared = messages
    .flatMap(({ files = [], createdAt }) =>
      files.map((file) => fileResource(file, createdAt)),
    )
    .reverse();
  const [openId, setOpenId] = useState<string>();

  return (
    <WithPanel
      panel={
        <ChatPanel
          chat={chat}
          projectId={projectId}
          onProject={(next) => {
            // Mock only: the chat moves to the other project in memory.
            chat.projectId = next;
            setProjectId(next);
          }}
          shared={shared}
          onOpen={setOpenId}
        />
      }
    >
      <Lightbox resources={shared} openId={openId} onOpen={setOpenId} />
      <Topbar actions={<PanelToggle />}>
        {parent ? (
          // A sub-thread leads back to the chat it was opened from.
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          to="/chats/$chatId"
                          params={{ chatId: parent.id }}
                        />
                      }
                    />
                  }
                >
                  <ChatIcon chat={parent} />
                  {parent.title}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <Button variant="ghost" size="sm" aria-current="page">
                  <span className="truncate">{chat.title}</span>
                </Button>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : kind !== "channel" && other ? (
          // A one-to-one chat names its project first (an agent works in
          // that project's context), then switches between your chats with
          // the same agent or person.
          <Breadcrumb>
            <BreadcrumbList>
              {projectId && projects[projectId] && (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={
                            <Link
                              to="/projects/$projectId"
                              params={{ projectId }}
                            />
                          }
                        />
                      }
                    >
                      <RiBox3Line data-icon="inline-start" />
                      {projects[projectId].title}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </>
              )}
              <BreadcrumbItem>
                <ChatSwitcher chat={chat} agentId={other} />
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : (
          <Button variant="ghost" size="sm" aria-current="page">
            <ChatIcon chat={chat} />
            {chat.title}
          </Button>
        )}
      </Topbar>
      <ChatThread messages={messages} onAnswer={send} onOpen={setOpenId} />
      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        <Composer placeholder={`Message ${name}, @ to tag`} onSend={send} />
      </div>
    </WithPanel>
  );
}

// A chat's messages: they scroll and open at the latest, with day dividers
// and Scroll to end. The chat page and the floating chat both show one.
export function ChatThread({
  messages,
  onAnswer,
  onOpen,
  className,
}: {
  messages: ChatMessage[];
  /** The column's padding, e.g. the chat panel's 12px sides. */
  className?: string;
  onAnswer: (body: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent
            className={cn(
              "mx-auto w-full max-w-3xl justify-end gap-3.5 px-5 pt-5 pb-6",
              className,
            )}
          >
            {turnsOf(messages).map((turn, index, turns) => (
              <Fragment key={turn[0].id}>
                {/* A labelled rule where the day changes, with the same
                    2px above and 4px below that each turn keeps, so it
                    sits 20px from the turns on both sides. */}
                {day(turn[0].createdAt) !==
                  (index > 0 && day(turns[index - 1][0].createdAt)) && (
                  <Marker variant="separator" className="mt-0.5 mb-1">
                    <MarkerContent>{day(turn[0].createdAt)}</MarkerContent>
                  </Marker>
                )}
                {/* A group chat follows the latest message; no
                    assistant-style anchoring of your own message to the
                    top. Items contain their paint, so each keeps 2px above
                    (the copy button rises 2px out of the name line) and 4px
                    below (card rings and shadows); 14px between makes 20. */}
                <MessageScrollerItem
                  messageId={turn[0].id}
                  className="pt-0.5 pb-1"
                >
                  <Turn messages={turn} onAnswer={onAnswer} onOpen={onOpen} />
                </MessageScrollerItem>
              </Fragment>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Shown once you scroll up: a labelled 28px outline button,
            8px above the composer. The list fades out under it
            (the viewport's scroll-fade-y). */}
        <MessageScrollerButton variant="outline" size="compact">
          <RiArrowDownLine data-icon="inline-start" />
          Scroll to end
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const noProject: Look = { label: "No project", icon: RiBox3Line };

// The title of a one-to-one chat: a searchable list of your chats with the
// same agent or person (archived ones too, marked), newest first, and New
// chat on top.
function ChatSwitcher({ chat, agentId }: { chat: Chat; agentId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const mine = chats
    .filter(
      (candidate) =>
        chatKind(candidate) !== "channel" && chatOther(candidate) === agentId,
    )
    .sort((a, b) =>
      (b.messages.at(-1)?.createdAt ?? "").localeCompare(
        a.messages.at(-1)?.createdAt ?? "",
      ),
    );
  const items = ["new", ...mine.map(({ id }) => id)];
  const titleOf = (id: string) =>
    id === "new"
      ? `New chat with ${actorOf(agentId).name}`
      : (chats.find((candidate) => candidate.id === id)?.title ?? "");

  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        aria-current="page"
        onClick={() => setOpen(true)}
      >
        <ActorAvatar actorId={agentId} />
        <span className="truncate">{chat.title}</span>
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <Combobox
        autoHighlight
        items={items}
        value={chat.id}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(id) => titleOf(id as string)}
        onValueChange={(id) => {
          if (!id) return;
          setOpen(false);
          if (id === "new") {
            navigate({
              to: "/chats/new",
              search: { with: agentId, project: chat.projectId },
            });
          } else {
            navigate({
              to: "/chats/$chatId",
              params: { chatId: id as string },
            });
          }
        }}
      >
        <ComboboxContent anchor={anchor} className="w-80">
          <ComboboxSearch
            placeholder={`Search chats with ${actorOf(agentId).name}`}
          />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(id: string) => {
              const item = chats.find((candidate) => candidate.id === id);
              return (
                <ComboboxItem key={id} value={id}>
                  {id === "new" ? (
                    <RiAddLine />
                  ) : (
                    <RiChat1Line className="text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
                  {item && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.archived
                        ? "Archived"
                        : ago(item.messages.at(-1)?.createdAt)}
                    </span>
                  )}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}

// /chats/new: like a coding harness, nothing exists until you send. Above
// the composer sit two pickers: who the chat is with (one agent or person
// makes a one-to-one chat, several a channel) and the project it works in,
// prefilled from where you came from. The first message creates the chat,
// named from its first line, and opens it.
export function NewChatPage({
  search,
}: {
  search: { with?: string; project?: string };
}) {
  const navigate = useNavigate();
  return (
    <>
      <Topbar>
        <Button variant="ghost" size="sm" aria-current="page">
          <RiChat1Line data-icon="inline-start" />
          New chat
        </Button>
      </Topbar>
      <NewChatEmpty />
      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        <NewChatComposer
          withId={search.with}
          projectId={search.project}
          onCreated={(chat) =>
            navigate({ to: "/chats/$chatId", params: { chatId: chat.id } })
          }
        />
      </div>
    </>
  );
}

// A new chat's generic empty state.
export function NewChatEmpty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiChat1Line />
        </EmptyMedia>
        <EmptyTitle>New chat</EmptyTitle>
        <EmptyDescription>
          Choose who it's with and a project for context, then say what you
          need.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// Who a new chat is with (Otto unless asked) and its project, then the
// composer; sending creates the chat.
export function NewChatComposer({
  withId,
  projectId: initialProjectId,
  onCreated,
}: {
  withId?: string;
  projectId?: string;
  onCreated: (chat: Chat) => void;
}) {
  const [withIds, setWithIds] = useState<string[]>([
    withId && withId in chatWithLooks ? withId : "a_otto",
  ]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const names = withIds.map((id) => actorOf(id).name);
  const send = (body: string, files?: FileRef[]) => {
    const now = new Date().toISOString();
    const firstLine = body
      .replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1")
      .split("\n")[0];
    const chat: Chat = {
      id: `c_${Date.now()}`,
      title:
        firstLine.length > 48
          ? `${firstLine.slice(0, 47).trimEnd()}…`
          : firstLine,
      projectId,
      memberIds: [currentUserId, ...withIds],
      messages: [
        { id: "m1", actorId: currentUserId, body, files, createdAt: now },
      ],
      createdAt: now,
      readAt: now,
    };
    // Mock only: the chat joins the in-memory list.
    chats.unshift(chat);
    onCreated(chat);
  };
  return (
    <>
      {/* The pickers: a bare row of 28px text buttons, never a fill.
          px-1 + their 8px puts the icons 12px in, on the composer's text
          edge, and pb-2 + their 4px keeps them 12px above it. */}
      <div className="flex items-center gap-1 px-1 pb-2">
        <WithPicker value={withIds} onChange={setWithIds} />
        <ContextPicker
          label="Project"
          value={projectId ?? "none"}
          options={{ none: noProject, ...projectLooks }}
          onPick={(next) => setProjectId(next === "none" ? undefined : next)}
        />
      </div>
      <Composer
        placeholder={`Message ${
          names.length > 2 ? `${names.length} members` : names.join(" and ")
        }, @ to tag`}
        onSend={send}
      />
    </>
  );
}

// One picker above the new chat's composer: the current choice as a small
// ghost button that opens a searchable list.
function ContextPicker({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: Record<string, Look>;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = options[value];
  return (
    <>
      <Button
        ref={anchor}
        variant="plain"
        size="compact"
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen(true)}
      >
        <current.icon className={current.className} />
        {current.label}
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <ChoiceSearch
        label={label}
        value={value}
        options={options}
        onPick={(next) => {
          onPick(next);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
      />
    </>
  );
}

// Who a new chat is with: one or several agents and people, searchable;
// never empty.
export function WithPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label =
    value.length === 1
      ? actorOf(value[0]).name
      : `${actorOf(value[0]).name} and ${value.length - 1} more`;
  return (
    <>
      <Button
        ref={anchor}
        variant="plain"
        size="compact"
        aria-label={`With: ${value.map((id) => actorOf(id).name).join(", ")}`}
        onClick={() => setOpen(true)}
      >
        {value.length === 1 ? (
          <ActorAvatar actorId={value[0]} />
        ) : (
          <AvatarGroup>
            {value.slice(0, 3).map((id) => (
              <ActorAvatar key={id} actorId={id} />
            ))}
          </AvatarGroup>
        )}
        {label}
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <Combobox
        multiple
        autoHighlight
        items={Object.keys(chatWithLooks)}
        value={value}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(id) => chatWithLooks[id as string].label}
        onValueChange={(next) => {
          const ids = next as string[];
          if (ids.length > 0) onChange(ids);
        }}
      >
        <ComboboxContent anchor={anchor} className="w-56">
          <ComboboxSearch placeholder="Search agents and people" />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(id: string) => (
              <ComboboxItem key={id} value={id}>
                <ActorAvatar actorId={id} />
                {chatWithLooks[id].label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}

// What the chat is about and who and what is in it: its project (project
// chats), its members (people, then agents) and the resources shared in it,
// newest first. Resources hide until something is shared.
function ChatPanel({
  chat,
  projectId,
  onProject,
  shared,
  onOpen,
}: {
  chat: Chat;
  projectId?: string;
  onProject: (projectId?: string) => void;
  shared: Resource[];
  onOpen: (id: string) => void;
}) {
  const members = [...chat.memberIds].sort(
    (a, b) => Number(a in agents) - Number(b in agents),
  );
  const project = projectId ? projectLooks[projectId] : undefined;

  return (
    <>
      {/* A project's general chat (and a sub-thread, which follows its
          parent) links to the project; a chat started from a page keeps
          that page's project, shown but fixed; any other chat picks its
          project and works in that project's context. */}
      {chat.origin ? (
        projectId &&
        project && (
          <Section title="Project">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<div />}
                aria-label={`Project: ${project.label}, fixed`}
                className="pointer-events-none"
              >
                <project.icon className={project.className} />
                <span>{project.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </Section>
        )
      ) : !chat.general && !chat.parentId ? (
        <Section title="Project">
          <ChoiceItem
            label="Project"
            value={projectId ?? "none"}
            options={{ none: noProject, ...projectLooks }}
            onChange={(next) => onProject(next === "none" ? undefined : next)}
            searchable
          />
        </Section>
      ) : (
        projectId &&
        project && (
          <Section title="Project">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <Link to="/projects/$projectId" params={{ projectId }} />
                }
              >
                <project.icon className={project.className} />
                <span>{project.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </Section>
        )
      )}
      <Section title="Members" count={members.length}>
        {members.map((id) => (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton>
              <ActorAvatar actorId={id} />
              <span>{actorOf(id).name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        {/* Not wired yet. */}
        <NewItem label="Add member" />
      </Section>
      {shared.length > 0 && (
        <Section title="Files" count={shared.length}>
          <FileItems resources={shared} onOpen={onOpen} />
        </Section>
      )}
    </>
  );
}

// Consecutive messages from one sender within five minutes form a turn.
function turnsOf(messages: ChatMessage[]) {
  const turns: ChatMessage[][] = [];
  for (const message of messages) {
    const last = turns.at(-1)?.at(-1);
    const sameTurn =
      last &&
      last.actorId === message.actorId &&
      Date.parse(message.createdAt) - Date.parse(last.createdAt) < 5 * 60_000;
    if (sameTurn) turns.at(-1)?.push(message);
    else turns.push([message]);
  }
  return turns;
}

const clock = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const weekday = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

// A day divider's label: Today, Yesterday, else the weekday and date.
function day(createdAt: string) {
  const date = new Date(createdAt);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return weekday.format(date);
}

// 14s, 2m 41s.
function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

// One sender's turn, the same for everyone (like Slack): avatar, then name and
// time on one line, then each message as plain text (a ghost bubble). Copy
// shows on hover at the end of the name line, so turns reserve no space for
// it and keep one rhythm.
function Turn({
  messages,
  onAnswer,
  onOpen,
}: {
  messages: ChatMessage[];
  onAnswer: (body: string) => void;
  onOpen: (id: string) => void;
}) {
  const { actorId, createdAt } = messages[0];
  const mine = actorId === currentUserId;
  const working = messages.at(-1)?.working;

  return (
    <Message>
      <MessageAvatar>
        <ActorAvatar actorId={actorId} size="md" />
      </MessageAvatar>
      <MessageContent className="gap-1">
        <MessageHeader className="gap-2 px-0 text-sm">
          {/* You are always "You", uncolored: the others' colors do the
              grouping. */}
          <span
            className={
              mine ? "text-foreground" : nameColors[actorOf(actorId).color]
            }
          >
            {mine ? "You" : actorOf(actorId).name}
          </span>
          <span className="text-xs font-normal tabular-nums">
            {clock.format(new Date(createdAt))}
          </span>
          {!working && (
            // A 24px button in the 20px line, without growing it (-2px each
            // side).
            <CopyButton
              className="-my-0.5 ml-auto opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              text={messages.map(({ body }) => body).join("\n\n")}
            />
          )}
        </MessageHeader>
        {messages.map((message) => (
          <Entry
            key={message.id}
            message={message}
            onAnswer={onAnswer}
            onOpen={onOpen}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

// One message: the agent's run, then the text, files and any question.
function Entry({
  message,
  onAnswer,
  onOpen,
}: {
  message: ChatMessage;
  onAnswer: (body: string) => void;
  onOpen: (id: string) => void;
}) {
  const { body, files, run, question, working } = message;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {run && <Run run={run} />}
      {working ? (
        <Working status={body} actorId={message.actorId} />
      ) : (
        body && (
          <Bubble variant="ghost">
            {/* Keeps line breaks (lists, paragraphs), like comments. */}
            <BubbleContent className="whitespace-pre-line">
              <MentionText text={body} />
            </BubbleContent>
          </Bubble>
        )
      )}
      {files && files.length > 0 && (
        <AttachmentGroup className="max-w-full py-0">
          {files.map((file) => (
            <FileAttachment
              key={file.id}
              file={file}
              onOpen={() => onOpen(file.id)}
            />
          ))}
        </AttachmentGroup>
      )}
      {question && <Question question={question} onAnswer={onAnswer} />}
      {message.threadId && <ThreadCard threadId={message.threadId} />}
    </div>
  );
}

// A sub-thread an agent opened for this work, inline in the chat: its agents,
// its title and where it stands; it opens as its own page. Threads nest one
// level only.
function ThreadCard({ threadId }: { threadId: string }) {
  const thread = chats.find(({ id }) => id === threadId);
  if (!thread) return null;
  const status = chatStatus(thread);
  const count = thread.messages.length;
  return (
    <Item
      variant="outline"
      size="xs"
      className="max-w-md"
      render={<Link to="/chats/$chatId" params={{ chatId: thread.id }} />}
    >
      <ItemMedia>
        <AvatarGroup>
          {thread.memberIds
            .filter((id) => id in agents)
            .map((id) => (
              <ActorAvatar key={id} actorId={id} />
            ))}
        </AvatarGroup>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="truncate">{thread.title}</ItemTitle>
      </ItemContent>
      <ItemActions className="gap-2 text-xs text-muted-foreground">
        {status ? (
          <>
            <status.icon className={status.className} />
            {status.label}
          </>
        ) : (
          `${count} ${count === 1 ? "message" : "messages"}`
        )}
        <RiArrowRightSLine />
      </ItemActions>
    </Item>
  );
}

// Lighthearted lines an agent shows while it works, between mentions of
// what it is actually doing.
const musings = [
  "Working on it",
  "Thinking it through",
  "Connecting the dots",
  "Brewing ideas",
  "Reading between the lines",
  "Sharpening the pencils",
  "Weighing the options",
  "Untangling the details",
  "Gathering thoughts",
  "Checking twice",
  "Polishing the wording",
  "Putting the pieces together",
  "Consulting the notes",
  "Doing the math",
  "Following a hunch",
];

// An agent at work: a shimmering line, no spinner. It opens on the real
// status, then every few seconds fades to another line: a random musing,
// with the real status every third turn. Screen readers hear one steady
// "… is working" instead of each change.
function Working({ status, actorId }: { status: string; actorId: string }) {
  const [line, setLine] = useState(status);
  useEffect(() => {
    let turn = 0;
    const timer = setInterval(() => {
      turn += 1;
      setLine((current) => {
        if (turn % 3 === 0) return status;
        const others = musings.filter((musing) => musing !== current);
        return others[Math.floor(Math.random() * others.length)];
      });
    }, 3200);
    return () => clearInterval(timer);
  }, [status]);

  return (
    <Marker role="status">
      <span className="sr-only">{actorOf(actorId).name} is working</span>
      <MarkerContent aria-hidden>
        {/* The key restarts the fade on each new line; the shimmer sits on an
            inner span so the two animations don't override each other. */}
        <span key={line} className="block animate-in duration-500 fade-in">
          <span className="shimmer">{line}</span>
        </span>
      </MarkerContent>
    </Marker>
  );
}

// "Worked for 52s": what the agent did before replying, folded away. Opens
// to its steps; a failed run says so in red.
function Run({ run }: { run: ChatRun }) {
  return (
    <Collapsible>
      <Marker
        render={<CollapsibleTrigger />}
        className={cn(
          "w-fit cursor-pointer hover:text-foreground",
          run.failed && "text-destructive hover:text-destructive",
        )}
      >
        <MarkerContent>
          {run.failed ? "Failed after" : "Worked for"} {duration(run.seconds)}
        </MarkerContent>
        <MarkerIcon>
          <RiArrowRightSLine className="transition-transform group-data-panel-open/marker:rotate-90" />
        </MarkerIcon>
      </Marker>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <div className="flex flex-col gap-2 pt-2">
          {run.steps.map((step, index) => {
            const failed = run.failed && index === run.steps.length - 1;
            return (
              <Marker key={step} className={cn(failed && "text-destructive")}>
                <MarkerIcon>
                  {failed ? <RiCloseLine /> : <RiCheckLine />}
                </MarkerIcon>
                <MarkerContent>{step}</MarkerContent>
              </Marker>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 24px copy button; shows a check for a moment once copied.
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy"
            className={className}
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
        }
      >
        {copied ? <RiCheckLine /> : <RiFileCopyLine />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

// An agent's question on a compact card (12px spacing): the question, then the
// choices as one bordered list split by hairlines, then Send on the right.
// Pick a choice (or press its number) and send; the answer posts as your
// reply and the card keeps the question with the picked row.
function Question({
  question,
  onAnswer,
}: {
  question: ChatQuestion;
  onAnswer: (body: string) => void;
}) {
  const [answer, setAnswer] = useState<string>();
  // The stock small card at 12px instead of 16.
  const card = "mt-1 max-w-md data-[size=sm]:[--card-spacing:--spacing(3)]";

  if (answer) {
    return (
      <Card size="sm" className={card}>
        <CardHeader>
          <CardTitle>{question.prompt}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-10 items-center gap-2 rounded-md border bg-foreground/5 px-3 py-2.5">
            <RiCheckLine className="text-primary" />
            {answer}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className={card}>
      {/* The form and its item lay out as the card's own sections. */}
      <Questionnaire
        className="contents"
        items={[
          { name: question.name, required: true, choices: question.choices },
        ]}
        shortcuts="numbers"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get(question.name);
          const label = question.choices.find(
            (choice) => choice.value === value,
          )?.label;
          if (!label) return;
          setAnswer(label);
          onAnswer(label);
        }}
      >
        <QuestionnaireItem name={question.name} className="contents">
          <CardHeader>
            <QuestionnaireTitle>{question.prompt}</QuestionnaireTitle>
            {question.description && (
              <QuestionnaireDescription>
                {question.description}
              </QuestionnaireDescription>
            )}
          </CardHeader>
          <CardContent>
            <QuestionnaireChoices>
              {question.choices.map((choice) => (
                <QuestionnaireChoice key={choice.value} value={choice.value}>
                  {choice.label}
                </QuestionnaireChoice>
              ))}
            </QuestionnaireChoices>
          </CardContent>
        </QuestionnaireItem>
        <CardFooter>
          <QuestionnaireActions>
            <QuestionnaireSubmit className="col-start-3">
              Send
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </CardFooter>
      </Questionnaire>
    </Card>
  );
}
