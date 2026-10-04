import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownLine,
  RiArrowDownSLine,
  RiBox3Line,
  RiChat1Line,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiGroupLine,
  RiMoreLine,
} from "@remixicon/react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useMatchRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { AttachmentGroup } from "@workspace/ui/components/attachment";
import { AvatarGroup } from "@workspace/ui/components/avatar";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Marker, MarkerContent } from "@workspace/ui/components/marker";
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
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { toast } from "@workspace/ui/components/sonner";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import {
  Fragment,
  type ReactNode,
  useCallback,
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
import {
  ChoiceSearch,
  PanelToggle,
  Section,
  WithPanel,
} from "@/components/detail";
import { EmptyPage } from "@/components/empty-page";
import { Lightbox } from "@/components/files";
import { MentionText } from "@/components/mentions";
import { QueryState } from "@/components/query-state";
import { SectionSidebar } from "@/components/section-sidebar";
import { ActorAvatar, type Look } from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import { ApiError, read } from "@/lib/api";
import {
  activeRun,
  type LiveActivity,
  type LiveChat,
  type LiveMessage,
  type LiveRun,
  useChat,
  useChatMessages,
  useChatPermissions,
  useChatRuns,
  useChatSessions,
  useChats,
  useMessageSend,
  useParticipants,
  useRunActivity,
} from "@/lib/chat-data";
import { useChatUpload } from "@/lib/chat-upload";
import { useDirectory } from "@/lib/directory";
import { savedResource } from "@/lib/file-library";
import { mentionUserIds, parseMentions } from "@/lib/mention-text";
import { useWorkspace } from "@/lib/workspace";

export function ago(createdAt?: string | null) {
  if (!createdAt) return "";
  const minutes = Math.max(0, (Date.now() - Date.parse(createdAt)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 10080)}w`;
}

// Backend Chat metadata has no pin/done/snooze/type state.
export function chatGroups(chats: LiveChat[] = []) {
  return [
    {
      title: "Chats",
      chats: chats.filter((chat) => !chat.archived),
      open: true,
    },
    {
      title: "Archived",
      chats: chats.filter((chat) => chat.archived),
      open: false,
    },
  ];
}

export function ChatsSidebar() {
  // /chats/new has no chatId; a fuzzy match on /chats/$chatId would read "new" as one.
  const { chatId } = useParams({ strict: false });
  const selected = useChat(chatId);
  const chats = useChats({ archived: "false" });
  const { workspace } = useWorkspace();
  // No chats: no sidebar. The new-chat page is the whole screen.
  if (
    !chats.error &&
    (chats.isPending || chats.data?.pages.every((page) => !page.items.length))
  )
    return null;
  return (
    <SectionSidebar
      title="Chats"
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          disabled={workspace.role === "viewer"}
          nativeButton={false}
          render={
            <Link
              to="/chats/new"
              search={{
                with: undefined,
                project: selected.data?.projectId ?? undefined,
              }}
            />
          }
        >
          <RiAddLine />
        </Button>
      }
    >
      <QueryState
        pending={chats.isPending}
        error={chats.error}
        retry={chats.refetch}
      />
      {!chats.error && (
        <>
          <SidebarMenu>
            {chats.data?.pages
              .flatMap((page) => page.items)
              .map((chat) => (
                <ChatRow key={chat.id} chat={chat} />
              ))}
          </SidebarMenu>
          {chats.hasNextPage && (
            <Button
              variant="ghost"
              disabled={chats.isFetchingNextPage}
              onClick={() => chats.fetchNextPage()}
            >
              Load more chats
            </Button>
          )}
        </>
      )}
    </SectionSidebar>
  );
}

function ChatRow({ chat }: { chat: LiveChat }) {
  const matchRoute = useMatchRoute();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={Boolean(
          matchRoute({ to: "/chats/$chatId", params: { chatId: chat.id } }),
        )}
        render={<Link to="/chats/$chatId" params={{ chatId: chat.id }} />}
      >
        <RiChat1Line />
        <span className="truncate">{chat.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction aria-label={`Actions for ${chat.title}`} />
          }
        >
          <RiMoreLine />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ChatMenuItems chat={chat} />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

// Keep the export used by Inbox during integration, but authorize from the live Chat.
export function ChatMenuItems({
  chat,
}: {
  chat: { id: string; title: string; archived?: boolean };
  onChange?: (update: { archived?: boolean }) => void;
}) {
  const current = useChat(chat.id);
  const participants = useParticipants(chat.id);
  const { canManage } = useChatPermissions(current.data, participants);
  const { api, workspaceId, invalidate } = useWorkspace();
  const archive = useMutation({
    mutationFn: async () =>
      read(
        await api.chats[":id"].archive.$post({
          param: { workspaceId, id: chat.id },
          json: { archived: !current.data?.archived },
        }),
      ),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        disabled={!canManage || archive.isPending}
        onClick={() => archive.mutate()}
      >
        <RiArchiveLine />
        {current.data?.archived ? "Restore chat" : "Archive chat"}
      </DropdownMenuItem>
      {archive.error && (
        <DropdownMenuItem disabled>{archive.error.message}</DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `${location.origin}/chats/${encodeURIComponent(chat.id)}`,
            );
            toast.success("Chat link copied");
          } catch {
            toast.error("Unable to copy the chat link");
          }
        }}
      >
        Copy chat link
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export function validateChatsSearch(input: Record<string, unknown>): {
  query?: string;
  project?: string;
  archived?: "true" | "false";
  sort?: "title" | "createdAt" | "updatedAt";
  order?: "asc" | "desc";
} {
  return {
    query:
      typeof input.query === "string" ? input.query.slice(0, 200) : undefined,
    project: typeof input.project === "string" ? input.project : undefined,
    archived:
      input.archived === "true" ? ("true" as const) : ("false" as const),
    sort:
      input.sort === "title" || input.sort === "createdAt"
        ? (input.sort as "title" | "createdAt")
        : ("updatedAt" as const),
    order: input.order === "asc" ? ("asc" as const) : ("desc" as const),
  };
}

export function ChatsLandingPage({
  search = validateChatsSearch({}),
}: {
  search?: ReturnType<typeof validateChatsSearch>;
}) {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const chats = useChats({
    query: search.query || undefined,
    projectId: search.project,
    archived: search.archived,
    sort: search.sort,
    order: search.order,
  });
  // Chats always has one open: the first one, or the empty page with New chat.
  if (chats.error || chats.isPending)
    return (
      <QueryState
        pending={chats.isPending}
        error={chats.error}
        retry={chats.refetch}
      />
    );
  const first = chats.data.pages[0]?.items[0];
  return first ? (
    <Navigate to="/chats/$chatId" params={{ chatId: first.id }} replace />
  ) : (
    <EmptyPage
      icon={RiChat1Line}
      title="No chats"
      description="Conversations with your team and agents live here."
      create={
        workspace.role === "viewer"
          ? undefined
          : {
              action: "New chat",
              onClick: () =>
                void navigate({
                  to: "/chats/new",
                  search: { with: undefined, project: search.project },
                }),
            }
      }
    />
  );
}

export function ChatPage({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  if (chat.isPending || chat.error)
    return (
      <QueryState
        pending={chat.isPending}
        error={chat.error}
        retry={chat.refetch}
      />
    );
  return <ChatView key={chatId} chat={chat.data} />;
}

function ChatView({ chat }: { chat: LiveChat }) {
  const messages = useChatMessages(chat.id);
  const participants = useParticipants(chat.id);
  const permissions = useChatPermissions(chat, participants);
  const composer = useRef<ComposerHandle>(null);
  const send = useMessageSend(chat.id);
  const [replyTo, setReplyTo] = useState<string>();
  const [title, setTitle] = useState(chat.title);
  const [editing, setEditing] = useState(false);
  const { api, workspaceId, invalidate } = useWorkspace();
  const rename = useMutation({
    mutationFn: async () =>
      read(
        await api.chats[":id"].$patch({
          param: { workspaceId, id: chat.id },
          json: { title },
        }),
      ),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });
  return (
    <WithPanel
      panel={
        <ChatPanel
          chat={chat}
          participants={participants}
          canManage={permissions.canManage}
          messages={messages.data ?? []}
        />
      }
    >
      <Topbar
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Chat actions"
                  />
                }
              >
                <RiMoreLine />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <ChatMenuItems chat={chat} />
              </DropdownMenuContent>
            </DropdownMenu>
            <PanelToggle />
          </>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={!permissions.canManage}
          onClick={() => {
            setTitle(chat.title);
            setEditing(true);
          }}
        >
          <RiChat1Line data-icon="inline-start" />
          {chat.title}
        </Button>
      </Topbar>
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!rename.isPending) setEditing(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="chat-title">Title</FieldLabel>
                <Input
                  id="chat-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  maxLength={200}
                  disabled={rename.isPending}
                />
              </Field>
              {rename.error && <p role="alert">{rename.error.message}</p>}
              <Button
                disabled={rename.isPending || !title.trim()}
                type="submit"
              >
                {rename.isPending ? "Saving" : "Save"}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={rename.isPending}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
      <QueryState
        pending={messages.isPending}
        error={messages.error}
        retry={messages.refetch}
      />
      {!messages.error && !messages.isPending && (
        <ChatThread
          chatId={chat.id}
          messages={messages.data ?? []}
          onReply={permissions.canWrite ? setReplyTo : undefined}
        >
          <ChatPresence chatId={chat.id} />
          <ChatRunFeed chatId={chat.id} canWrite={permissions.canWrite} />
        </ChatThread>
      )}
      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        {chat.archived && (
          <p>
            Archived. New Runs are unavailable; authorized discussion and active
            Run controls continue.
          </p>
        )}
        {replyTo && (
          <p>
            Replying to message {replyTo}
            <Button
              variant="ghost"
              size="compact"
              onClick={() => setReplyTo(undefined)}
            >
              Cancel reply
            </Button>
          </p>
        )}
        {send.error && (
          <p role="alert">{send.error.message} Your draft is retained.</p>
        )}
        {permissions.canWrite ? (
          <ChatComposer
            chat={chat}
            composerRef={composer}
            sending={send.isPending}
            onSend={(body, files) =>
              send
                .mutateAsync({
                  body,
                  fileIds: files.map((file) => file.id),
                  replyTo,
                })
                .then(() => setReplyTo(undefined))
            }
          />
        ) : (
          <p>
            {participants.error?.message ??
              (participants.authorityPending
                ? "Checking your chat access…"
                : "This chat is read-only for you.")}
          </p>
        )}
      </div>
    </WithPanel>
  );
}

// The page and floating window use the same acknowledged binary upload boundary.
export function ChatComposer({
  chat,
  composerRef,
  onSend,
  sending = false,
  disabled = false,
  compact = false,
  embedded = false,
  tools,
  idle,
}: {
  chat: LiveChat;
  composerRef?: React.Ref<ComposerHandle>;
  onSend: (body: string, files: FileRef[]) => Promise<void>;
  sending?: boolean;
  disabled?: boolean;
  compact?: boolean;
  embedded?: boolean;
  tools?: ReactNode;
  idle?: ReactNode;
}) {
  const upload = useChatUpload(chat.projectId ?? undefined);
  const { api, workspaceId, invalidate } = useWorkspace();
  const lastTyped = useRef(0);
  const [presenceError, setPresenceError] = useState<Error>();
  const typing = async (value: boolean) => {
    if (disabled) return;
    if (value && Date.now() - lastTyped.current < 10000) return;
    lastTyped.current = value ? Date.now() : 0;
    try {
      await read(
        await api.chats[":id"].presence.$put({
          param: { workspaceId, id: chat.id },
          json: { typing: value },
        }),
      );
      setPresenceError(undefined);
      await invalidate();
    } catch (error) {
      setPresenceError(
        error instanceof Error
          ? error
          : new Error("Unable to update typing presence."),
      );
    }
  };
  return (
    <fieldset
      aria-label="Message composer"
      className="flex flex-col gap-2"
      onInput={() => void typing(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          void typing(false);
      }}
    >
      <Composer
        ref={composerRef}
        projectId={chat.projectId ?? undefined}
        placeholder={`Message ${chat.title}, @ to tag`}
        onSend={async (body, files) => {
          if (!body.trim())
            throw new Error("Add message text before sending attachments.");
          if (files.length > 30)
            throw new Error(
              "A message can attach at most 30 files. Remove extra attachments and retry.",
            );
          await onSend(body, files);
          await typing(false);
        }}
        compact={compact}
        embedded={embedded}
        tools={tools}
        idle={idle}
        pending={sending}
        disabled={disabled}
        upload={upload.upload}
      />
      {presenceError && (
        <p role="alert">
          {presenceError.message} Typing presence is unavailable.
        </p>
      )}
    </fieldset>
  );
}

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
            void navigate({ to: "/chats/$chatId", params: { chatId: chat.id } })
          }
        />
      </div>
    </>
  );
}

export function NewChatEmpty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiChat1Line />
        </EmptyMedia>
        <EmptyTitle>New chat</EmptyTitle>
        <EmptyDescription>
          Choose participants and optional project context, then send your first
          message. Start an Agent Run explicitly from the chat.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function useNewChat() {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const directory = useDirectory();
  const created = useRef<LiveChat | undefined>(undefined);
  const uncertainCreation = useRef(false);
  const request = useRef({ signature: "", id: "" });
  const create = useMutation({
    mutationFn: async (input: {
      memberIds: string[];
      body: string;
      files: FileRef[];
      projectId?: string;
      visibility: "participants" | "workspace";
    }) => {
      if (!input.body.trim())
        throw new Error("Add a message before creating a chat.");
      if (uncertainCreation.current)
        throw new Error(
          "Chat creation was not acknowledged, inspect Chats before starting another.",
        );
      if (!created.current) {
        try {
          created.current = await read(
            await api.chats.$post({
              param: { workspaceId },
              json: {
                title: parseMentions(input.body)
                  .reduceRight(
                    (text, item) =>
                      text.slice(0, item.index) +
                      item.label +
                      text.slice(item.index + item.length),
                    input.body,
                  )
                  .split("\n")[0]
                  .slice(0, 200),
                projectId: input.projectId,
                visibility: input.visibility,
              },
            }),
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status >= 500) {
            uncertainCreation.current = true;
            throw new Error(
              "Chat creation was not acknowledged, inspect Chats before starting another.",
            );
          }
          throw error;
        }
        await invalidate();
      }
      const chat = created.current;
      for (const memberId of input.memberIds) {
        if (memberId === user.id) continue;
        const bot = directory.agents.find((agent) => agent.id === memberId);
        if (
          !bot &&
          !directory.members.some((member) => member.userId === memberId)
        )
          throw new Error("Selected participant is no longer available.");
        await read(
          await api.chats[":id"].participants.$post({
            param: { workspaceId, id: chat.id },
            json: {
              ...(bot ? { agentId: memberId } : { userId: memberId }),
              role: "contributor",
            },
          }),
        );
        await invalidate();
      }
      const fileIds = input.files.map((file) => file.id);
      const signature = JSON.stringify([chat.id, input.body, fileIds]);
      if (signature !== request.current.signature)
        request.current = { signature, id: crypto.randomUUID() };
      await read(
        await api.chats[":id"].messages.$post({
          param: { workspaceId, id: chat.id },
          json: {
            body: input.body,
            fileIds,
            requestId: request.current.id,
            mentionUserIds: mentionUserIds(input.body),
          },
        }),
      );
      await invalidate();
      return chat;
    },
  });
  return {
    ...create,
    createdChat: created.current,
    uncertainCreation: uncertainCreation.current,
    reset: () => {
      created.current = undefined;
      uncertainCreation.current = false;
      request.current = { signature: "", id: "" };
      create.reset();
    },
  };
}

export function NewChatComposer({
  withId,
  projectId: initialProjectId,
  onCreated,
}: {
  withId?: string;
  projectId?: string;
  onCreated: (chat: LiveChat) => void;
}) {
  const directory = useDirectory();
  const { workspace } = useWorkspace();
  const [withIds, setWithIds] = useState<string[]>(withId ? [withId] : []);
  const [projectId, setProjectId] = useState(initialProjectId);
  const create = useNewChat();
  const upload = useChatUpload(projectId);
  const validProject =
    !projectId ||
    directory.projects.some(
      (project) => project.id === projectId && !project.archived,
    );
  const validPeople = withIds.every(
    (id) =>
      directory.members.some((member) => member.userId === id) ||
      directory.agents.some(
        (agent) =>
          agent.id === id &&
          !agent.archived &&
          (!agent.projectId || agent.projectId === projectId),
      ),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-1 pb-2">
        <WithPicker
          value={withIds}
          onChange={setWithIds}
          projectId={projectId}
          disabled={create.isPending || Boolean(create.createdChat)}
        />
        <ContextPicker
          label="Project"
          value={projectId ?? "none"}
          options={{
            none: { label: "No project", icon: RiBox3Line },
            ...Object.fromEntries(
              directory.projects
                .filter((project) => !project.archived)
                .map((project) => [
                  project.id,
                  { label: project.title, icon: RiBox3Line },
                ]),
            ),
          }}
          onPick={(next) => setProjectId(next === "none" ? undefined : next)}
          disabled={create.isPending || Boolean(create.createdChat)}
        />
      </div>
      {(!validProject || !validPeople) && (
        <p role="alert">
          A selected project or participant is unavailable in this context.
          Change the selection.
        </p>
      )}
      {create.error && (
        <p role="alert">{create.error.message} Your draft is retained.</p>
      )}
      {create.uncertainCreation && (
        <p>
          <Link to="/chats">Inspect Chats</Link> before retrying creation.
        </p>
      )}
      {create.createdChat && create.error && (
        <p>
          Chat saved; participant or message setup needs retry.{" "}
          <Link to="/chats/$chatId" params={{ chatId: create.createdChat.id }}>
            Open saved chat
          </Link>
        </p>
      )}
      <DirectoryPages kind="projects" />
      <Composer
        upload={upload.upload}
        projectId={projectId}
        placeholder="Write your first message"
        onSend={async (body, files) => {
          const chat = await create.mutateAsync({
            memberIds: withIds,
            projectId,
            // Participants only: the project's own chat is the one that is open to the whole project.
            visibility: "participants",
            body,
            files,
          });
          onCreated(chat);
        }}
        {...{
          pending: create.isPending,
          disabled:
            workspace.role === "viewer" ||
            directory.pending ||
            Boolean(directory.error) ||
            !validProject ||
            !validPeople,
          // Starts disabled: someone (yourself counts) must be chosen under With. No project is a valid choice.
          sendable: withIds.length > 0,
        }}
      />
    </>
  );
}

export function ContextPicker({
  label,
  value,
  options,
  onPick,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Record<string, Look>;
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = options[value] ?? {
    label: "Unavailable selection",
    icon: RiCloseLine,
  };
  return (
    <>
      <Button
        ref={anchor}
        variant="plain"
        size="compact"
        aria-label={`${label}: ${current.label}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <current.icon />
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

function DirectoryPages({ kind }: { kind: "people" | "projects" | "agents" }) {
  const directory = useDirectory();
  const queries =
    kind === "people"
      ? [directory.membersQuery, directory.agentsQuery]
      : kind === "agents"
        ? [directory.agentsQuery]
        : [directory.projectsQuery];
  const error = queries.find((query) => query.error)?.error;
  return (
    <>
      <QueryState
        error={error}
        retry={() => {
          for (const query of queries) void query.refetch();
        }}
      />
      {kind === "people" && directory.membersQuery.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={directory.membersQuery.isFetchingNextPage}
          onClick={() => directory.membersQuery.fetchNextPage()}
        >
          More people
        </Button>
      )}
      {(kind === "people" || kind === "agents") &&
        directory.agentsQuery.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={directory.agentsQuery.isFetchingNextPage}
            onClick={() => directory.agentsQuery.fetchNextPage()}
          >
            More Agents
          </Button>
        )}
      {kind === "projects" && directory.projectsQuery.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={directory.projectsQuery.isFetchingNextPage}
          onClick={() => directory.projectsQuery.fetchNextPage()}
        >
          More projects
        </Button>
      )}
    </>
  );
}

export function WithPicker({
  value,
  onChange,
  projectId,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  projectId?: string;
  disabled?: boolean;
}) {
  const directory = useDirectory();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const items = [
    ...directory.members.map((person) => person.userId),
    ...directory.agents
      .filter(
        (agent) =>
          !agent.archived &&
          (!agent.projectId || agent.projectId === projectId),
      )
      .map((agent) => agent.id),
  ];
  const label = !value.length
    ? "Participants"
    : value.length === 1
      ? directory.actorOf(value[0]).name
      : `${directory.actorOf(value[0]).name} and ${value.length - 1} more`;
  return (
    <>
      <QueryState
        error={directory.error}
        retry={() => {
          void directory.membersQuery.refetch();
          void directory.agentsQuery.refetch();
          void directory.projectsQuery.refetch();
        }}
      />
      <Button
        ref={anchor}
        variant="plain"
        size="compact"
        disabled={disabled || directory.pending || Boolean(directory.error)}
        onClick={() => setOpen(true)}
        aria-label={`With: ${label}`}
      >
        {value.length ? (
          <AvatarGroup>
            {value.slice(0, 3).map((id) => (
              <ActorAvatar key={id} actorId={id} />
            ))}
          </AvatarGroup>
        ) : (
          <RiGroupLine />
        )}
        {label}
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <Combobox
        multiple
        autoHighlight
        items={items}
        value={value}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(id) => directory.actorOf(id as string).name}
        onValueChange={(next) => {
          if ((next as string[]).length <= 99) onChange(next as string[]);
        }}
      >
        <ComboboxContent anchor={anchor} className="w-64">
          <ComboboxSearch placeholder="Search agents and people" />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(id: string) => (
              <ComboboxItem key={id} value={id}>
                <ActorAvatar actorId={id} />
                {directory.actorOf(id).name}
              </ComboboxItem>
            )}
          </ComboboxList>
          <DirectoryPages kind="people" />
        </ComboboxContent>
      </Combobox>
    </>
  );
}

function ChatPanel({
  chat,
  participants,
  canManage,
  messages,
}: {
  chat: LiveChat;
  participants: ReturnType<typeof useParticipants>;
  canManage: boolean;
  messages: LiveMessage[];
}) {
  const directory = useDirectory();
  const { api, workspaceId, invalidate } = useWorkspace();
  const [ids, setIds] = useState<string[]>([]);
  const [role, setRole] = useState<"viewer" | "contributor">("contributor");
  const update = useMutation({
    mutationFn: async (input: {
      participantId: string;
      role?: "viewer" | "contributor";
    }) =>
      input.role
        ? read(
            await api.chats[":id"].participants[":participantId"].$patch({
              param: {
                workspaceId,
                id: chat.id,
                participantId: input.participantId,
              },
              json: { role: input.role },
            }),
          )
        : read(
            await api.chats[":id"].participants[":participantId"].$delete({
              param: {
                workspaceId,
                id: chat.id,
                participantId: input.participantId,
              },
            }),
          ),
    onSuccess: invalidate,
  });
  const add = useMutation({
    mutationFn: async () => {
      for (const id of ids) {
        const bot = directory.agents.some((agent) => agent.id === id);
        await read(
          await api.chats[":id"].participants.$post({
            param: { workspaceId, id: chat.id },
            json: { ...(bot ? { agentId: id } : { userId: id }), role },
          }),
        );
        await invalidate();
      }
    },
    onSuccess: () => setIds([]),
  });
  const project = directory.projects.find((item) => item.id === chat.projectId);
  const fileIds = [...new Set(messages.flatMap((message) => message.fileIds))];
  return (
    <>
      <Section title="Project">
        {chat.projectId ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: chat.projectId }}
                />
              }
            >
              <RiBox3Line />
              {project?.title ?? "Project"}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          <p>No project</p>
        )}
      </Section>
      <Section title="Visibility">
        <p>
          {chat.visibility === "participants" ? "Participants" : "Workspace"}
        </p>
      </Section>
      <Section title="Participants" count={participants.data?.items.length}>
        <ParticipantPages participants={participants} />
        {!participants.error &&
          participants.data?.items.map((person) => {
            const id = person.userId ?? person.agentId ?? "";
            return (
              <SidebarMenuItem key={person.id}>
                <div className="flex items-center gap-2">
                  <ActorAvatar actorId={id} />
                  <span className="min-w-0 flex-1 truncate">
                    {directory.actorOf(id).name}
                  </span>
                  {canManage ? (
                    <>
                      <ContextPicker
                        label={`Role for ${directory.actorOf(id).name}`}
                        value={person.role}
                        options={{
                          contributor: {
                            label: "Contributor",
                            icon: RiChat1Line,
                          },
                          viewer: { label: "Viewer", icon: RiChat1Line },
                        }}
                        onPick={(next) =>
                          update.mutate({
                            participantId: person.id,
                            role: next as typeof person.role,
                          })
                        }
                        disabled={update.isPending}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${directory.actorOf(id).name}`}
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ participantId: person.id })
                        }
                      >
                        <RiCloseLine />
                      </Button>
                    </>
                  ) : (
                    <span>{person.role}</span>
                  )}
                </div>
              </SidebarMenuItem>
            );
          })}
        {update.error && <p role="alert">{update.error.message}</p>}
        {canManage && (
          <>
            <WithPicker
              value={ids}
              onChange={setIds}
              projectId={chat.projectId ?? undefined}
              disabled={add.isPending}
            />
            <ContextPicker
              label="New participant role"
              value={role}
              options={{
                contributor: { label: "Contributor", icon: RiChat1Line },
                viewer: { label: "Viewer", icon: RiChat1Line },
              }}
              onPick={(next) => setRole(next as typeof role)}
              disabled={add.isPending}
            />
            <Button
              variant="ghost"
              disabled={!ids.length || add.isPending}
              onClick={() => add.mutate()}
            >
              Add participants
            </Button>
            {add.error && <p role="alert">{add.error.message}</p>}
          </>
        )}
      </Section>
      {fileIds.length > 0 && (
        <Section title="Files" count={fileIds.length}>
          {fileIds.map((id) => (
            <SavedChatFile key={id} fileId={id} />
          ))}
        </Section>
      )}
      <Section title="Agent Runs">
        <RunAdmission chat={chat} messages={messages} />
      </Section>
    </>
  );
}

const clock = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const weekday = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "short",
  day: "numeric",
});
function day(createdAt: string) {
  const date = new Date(createdAt);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString()
    ? "Yesterday"
    : weekday.format(date);
}

export function ChatPresence({ chatId }: { chatId: string }) {
  const { api, workspaceId, user } = useWorkspace();
  const directory = useDirectory();
  const presence = useQuery({
    queryKey: ["workspace", workspaceId, "chat", chatId, "presence"],
    queryFn: async () =>
      read(
        await api.chats[":id"].presence.$get({
          param: { workspaceId, id: chatId },
        }),
      ),
    refetchInterval: 5000,
    retry: false,
  });
  const people = presence.error
    ? []
    : (presence.data?.filter(
        (person) => person.typing && person.userId !== user.id,
      ) ?? []);
  return (
    <>
      {presence.error && (
        <QueryState error={presence.error} retry={presence.refetch} />
      )}
      {people.length > 0 && (
        <Marker role="status">
          <MarkerContent>
            {people
              .map((person) => directory.actorOf(person.userId).name)
              .join(", ")}{" "}
            typing
          </MarkerContent>
        </Marker>
      )}
    </>
  );
}

export function ChatThread({
  chatId,
  messages,
  className,
  children,
  onReply,
}: {
  chatId?: string;
  messages: LiveMessage[];
  className?: string;
  children?: ReactNode;
  onReply?: (id: string) => void;
}) {
  const turns: LiveMessage[][] = [];
  for (const message of messages) {
    const last = turns.at(-1)?.at(-1);
    const actor = message.authorUserId ?? message.authorAgentId;
    if (
      last &&
      (last.authorUserId ?? last.authorAgentId) === actor &&
      Date.parse(message.createdAt) - Date.parse(last.createdAt) < 300000
    )
      turns.at(-1)?.push(message);
    else turns.push([message]);
  }
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
            {turns.map((turn, index) => (
              <Fragment key={turn[0].id}>
                {day(turn[0].createdAt) !==
                  (index > 0 && day(turns[index - 1][0].createdAt)) && (
                  <MessageScrollerItem messageId={`day-${turn[0].id}`}>
                    <Marker variant="separator" className="mt-0.5 mb-1">
                      <MarkerContent>{day(turn[0].createdAt)}</MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                )}
                <MessageScrollerItem
                  messageId={turn[0].id}
                  className="pt-0.5 pb-1"
                >
                  <Turn messages={turn} onReply={onReply} chatId={chatId} />
                </MessageScrollerItem>
              </Fragment>
            ))}
            {!messages.length && (
              <MessageScrollerItem messageId="empty">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No messages</EmptyTitle>
                    <EmptyDescription>
                      Messages in this chat show up here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {children && (
              <MessageScrollerItem messageId="runs">
                {children}
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" size="compact">
          <RiArrowDownLine data-icon="inline-start" />
          Scroll to end
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function Turn({
  messages,
  onReply,
  chatId,
}: {
  messages: LiveMessage[];
  onReply?: (id: string) => void;
  chatId?: string;
}) {
  const directory = useDirectory();
  const { user } = useWorkspace();
  const first = messages[0];
  const actorId = first.authorUserId ?? first.authorAgentId ?? "";
  return (
    <Message>
      <MessageAvatar>
        <ActorAvatar actorId={actorId} size="md" />
      </MessageAvatar>
      <MessageContent className="gap-1">
        <MessageHeader className="gap-2 px-0 text-sm">
          <span>
            {actorId === user.id ? "You" : directory.actorOf(actorId).name}
          </span>
          <span className="text-xs font-normal tabular-nums">
            {clock.format(new Date(first.createdAt))}
          </span>
          <CopyButton
            text={messages.map((message) => message.body).join("\n\n")}
          />
        </MessageHeader>
        {messages.map((message) => (
          <div className="flex w-full min-w-0 flex-col gap-2" key={message.id}>
            {message.replyTo && (
              <Marker>
                <MarkerContent>
                  Reply to message {message.replyTo}
                </MarkerContent>
              </Marker>
            )}
            <Bubble variant="ghost">
              <BubbleContent className="whitespace-pre-line">
                <MentionText text={message.body} />
              </BubbleContent>
            </Bubble>
            {message.fileIds.length > 0 && (
              <AttachmentGroup className="max-w-full py-0">
                {message.fileIds.map((fileId) => (
                  <SavedChatFile key={fileId} fileId={fileId} />
                ))}
              </AttachmentGroup>
            )}
            {onReply && (
              <Button
                variant="ghost"
                size="compact"
                className="w-fit"
                onClick={() => onReply(message.id)}
              >
                Reply
              </Button>
            )}
            {chatId && <ReadReceipt chatId={chatId} cursor={message.cursor} />}
          </div>
        ))}
      </MessageContent>
    </Message>
  );
}

function ReadReceipt({ chatId, cursor }: { chatId: string; cursor: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { api, workspaceId, invalidate } = useWorkspace();
  const [error, setError] = useState<Error>();
  const saved = useRef(false);
  const pending = useRef(false);
  const save = useCallback(async () => {
    if (
      saved.current ||
      pending.current ||
      document.hidden ||
      ref.current?.closest("[inert], [aria-hidden='true']")
    )
      return;
    pending.current = true;
    try {
      await read(
        await api.chats[":id"].read.$post({
          param: { workspaceId, id: chatId },
          json: { cursor },
        }),
      );
      saved.current = true;
      setError(undefined);
      await invalidate();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error("Unable to save read position."),
      );
    } finally {
      pending.current = false;
    }
  }, [api, workspaceId, chatId, cursor, invalidate]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) void save();
    });
    observer.observe(element);
    const wake = () => {
      if (visible) void save();
    };
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("focusin", wake);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("focusin", wake);
    };
  }, [save]);
  return (
    <span ref={ref} className="block min-h-px">
      {error && (
        <Button variant="ghost" size="compact" onClick={() => void save()}>
          Retry saving read position
        </Button>
      )}
    </span>
  );
}

function SavedChatFile({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false);
  const { api, workspaceId } = useWorkspace();
  const file = useQuery({
    queryKey: ["workspace", workspaceId, "file", fileId],
    queryFn: async () =>
      read(await api.files[":id"].$get({ param: { workspaceId, id: fileId } })),
    retry: false,
  });
  if (file.isPending || file.error)
    return (
      <QueryState
        pending={file.isPending}
        error={file.error}
        retry={file.refetch}
      />
    );
  const value = file.data;
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}/file`;
  return (
    <>
      <FileAttachment
        file={{
          id: fileId,
          name: value.title,
          type: value.mediaType,
          size: value.byteLength,
          url,
        }}
        onOpen={() => setOpen(true)}
      />
      <Lightbox
        resources={[savedResource(value)]}
        openId={open ? fileId : undefined}
        onOpen={(id) => setOpen(Boolean(id))}
      />
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={error ? "Copy failed; retry" : copied ? "Copied" : "Copy"}
      className="-my-0.5 ml-auto"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setError(false);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setError(true);
        }
      }}
    >
      {copied ? <RiCheckLine /> : error ? <RiCloseLine /> : <RiFileCopyLine />}
    </Button>
  );
}

export function ChatRunFeed({
  chatId,
  canWrite,
}: {
  chatId: string;
  canWrite: boolean;
}) {
  const runs = useChatRuns(chatId);
  return (
    <>
      <QueryState
        pending={runs.isPending}
        error={runs.error}
        retry={runs.refetch}
      />
      {!runs.error &&
        runs.data?.pages
          .flatMap((page) => page.items)
          .map((run) => <Run key={run.id} run={run} canWrite={canWrite} />)}
      {runs.hasNextPage && (
        <Button
          variant="ghost"
          disabled={runs.isFetchingNextPage}
          onClick={() => runs.fetchNextPage()}
        >
          More Runs
        </Button>
      )}
    </>
  );
}

function Run({ run, canWrite }: { run: LiveRun; canWrite: boolean }) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const directory = useDirectory();
  const [open, setOpen] = useState(activeRun(run));
  const [body, setBody] = useState("");
  const steerRequest = useRef({ body: "", id: "" });
  const activity = useRunActivity(run, open);
  const usage = useQuery({
    queryKey: ["workspace", workspaceId, "run", run.id, "usage"],
    queryFn: async () =>
      read(
        await api.runs[":id"].usage.$get({
          param: { workspaceId, id: run.id },
        }),
      ),
    enabled: open,
    refetchInterval: activeRun(run) ? 5000 : false,
    retry: false,
  });
  const stop = useMutation({
    mutationFn: async () =>
      read(
        await api.runs[":id"].stop.$post({
          param: { workspaceId, id: run.id },
        }),
      ),
    onSuccess: invalidate,
  });
  const steer = useMutation({
    mutationFn: async () => {
      if (steerRequest.current.body !== body)
        steerRequest.current = { body, id: crypto.randomUUID() };
      return read(
        await api.runs[":id"].steer.$post({
          param: { workspaceId, id: run.id },
          json: { body, requestId: steerRequest.current.id },
        }),
      );
    },
    onSuccess: async () => {
      setBody("");
      steerRequest.current = { body: "", id: "" };
      await invalidate();
    },
  });
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" className="w-fit" />}>
        <ActorAvatar actorId={run.agentId} />
        {directory.actorOf(run.agentId).name}: {run.state}
        <RiArrowDownSLine />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 py-3">
          {run.outcome && <p>{run.outcome}</p>}
          <QueryState
            pending={activity.isPending}
            error={activity.error}
            retry={activity.refetch}
          />
          {!activity.error &&
            activity.data?.map((item) =>
              item.type === "question" ? (
                <RunQuestion
                  key={item.id}
                  question={item}
                  canWrite={canWrite}
                />
              ) : (
                <Marker key={item.id}>
                  <MarkerContent>
                    <span className="whitespace-pre-line">
                      {item.type === "steer" ? "Instruction: " : ""}
                      {item.body}
                    </span>
                  </MarkerContent>
                </Marker>
              ),
            )}
          <QueryState
            pending={usage.isPending}
            error={usage.error}
            retry={usage.refetch}
          />
          {!usage.error && usage.data && (
            <p>
              Pi observed · {usage.data.model} ·{" "}
              {usage.data.totalTokens === null
                ? "Token total unknown"
                : `${usage.data.totalTokens} tokens`}
              {usage.data.estimatedCost
                ? ` · $${usage.data.estimatedCost.amount.toFixed(6)} API list-price estimate`
                : " · Cost unknown"}
              .{" "}
              {usage.data.complete
                ? "Complete observed usage."
                : "Usage is incomplete."}{" "}
              This is not an account charge.
            </p>
          )}
          {activeRun(run) && canWrite && (
            <>
              <Button
                variant="outline"
                disabled={stop.isPending}
                onClick={() => stop.mutate()}
              >
                {stop.isPending ? "Requesting stop" : "Stop Run"}
              </Button>
              {stop.isSuccess && (
                <p>Stop acknowledged. Current state: {run.state}.</p>
              )}
              {stop.error && <p role="alert">{stop.error.message}</p>}
              {run.type === "prompt" && run.state === "running" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    steer.mutate();
                  }}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`steer-${run.id}`}>
                        Steer this Run
                      </FieldLabel>
                      <Textarea
                        id={`steer-${run.id}`}
                        value={body}
                        maxLength={100000}
                        disabled={steer.isPending}
                        onChange={(event) => setBody(event.target.value)}
                        required
                      />
                    </Field>
                    <Button
                      disabled={steer.isPending || !body.trim()}
                      type="submit"
                    >
                      Send instruction
                    </Button>
                    {steer.error && <p role="alert">{steer.error.message}</p>}
                  </FieldGroup>
                </form>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunQuestion({
  question,
  canWrite,
}: {
  question: LiveActivity;
  canWrite: boolean;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [body, setBody] = useState("");
  const answer = useMutation({
    mutationFn: async () =>
      read(
        await api.questions[":id"].answer.$post({
          param: { workspaceId, id: question.id },
          json: { body },
        }),
      ),
    onSuccess: invalidate,
  });
  return (
    <Card size="sm" className="max-w-md">
      <CardHeader>
        <CardTitle>{question.body}</CardTitle>
      </CardHeader>
      <CardContent>
        {question.answer !== null ? (
          <p>{question.answer}</p>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`question-${question.id}`}>
                Your answer
              </FieldLabel>
              <Textarea
                id={`question-${question.id}`}
                required
                maxLength={16000}
                value={body}
                disabled={!canWrite || answer.isPending}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            {answer.error && <p role="alert">{answer.error.message}</p>}
          </FieldGroup>
        )}
      </CardContent>
      {question.answer === null && (
        <CardFooter>
          <Button
            disabled={!canWrite || !body.trim() || answer.isPending}
            onClick={() => answer.mutate()}
          >
            Send answer
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ParticipantPages({
  participants,
}: {
  participants: ReturnType<typeof useParticipants>;
}) {
  return (
    <>
      <QueryState
        pending={participants.isPending || participants.authorityPending}
        error={participants.error}
        retry={participants.refetch}
      />
      {!participants.error && participants.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={participants.isFetching}
          onClick={() => participants.fetchNextPage({ cancelRefetch: false })}
        >
          {participants.isFetchingNextPage
            ? "Loading participants…"
            : "More participants"}
        </Button>
      )}
    </>
  );
}

function RunAdmission({
  chat,
  messages,
}: {
  chat: LiveChat;
  messages: LiveMessage[];
}) {
  const directory = useDirectory();
  const participants = useParticipants(chat.id);
  const { canWrite } = useChatPermissions(chat, participants);
  const { api, workspaceId, invalidate } = useWorkspace();
  const [agentId, setAgentId] = useState("");
  const [type, setType] = useState<"prompt" | "script">("prompt");
  const [sessionId, setSessionId] = useState("");
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [messageIds, setMessageIds] = useState<string[]>([]);
  const sessions = useChatSessions(chat.id, agentId || undefined);
  const docs = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryKey: ["workspace", workspaceId, "chat", chat.id, "run-documents"],
    queryFn: async ({ pageParam }) =>
      read(
        await api.documents.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            projectId: chat.projectId ?? undefined,
            archived: "false",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: canWrite,
    retry: false,
  });
  const tasks = useInfiniteQuery({
    initialPageParam: undefined as string | undefined,
    queryKey: ["workspace", workspaceId, "chat", chat.id, "run-tasks"],
    queryFn: async ({ pageParam }) =>
      read(
        await api.tasks.$get({
          param: { workspaceId },
          query: {
            projectId: chat.projectId ?? "",
            limit: "100",
            archived: "false",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: canWrite && Boolean(chat.projectId),
    retry: false,
  });
  const selected = directory.agents.find((agent) => agent.id === agentId);
  const members =
    participants.data?.items
      .filter((person) => person.agentId && person.role === "contributor")
      .flatMap((person) => (person.agentId ? [person.agentId] : [])) ?? [];
  const available = directory.agents.filter(
    (agent) => !agent.archived && members.includes(agent.id),
  );
  const request = useRef({ signature: "", id: "" });
  const admit = useMutation({
    mutationFn: async () => {
      const input = {
        chatId: chat.id,
        agentId,
        type,
        body,
        sessionId: type === "prompt" && sessionId ? sessionId : undefined,
        taskId: taskId || undefined,
        documentIds,
        messageIds,
      };
      const signature = JSON.stringify(input);
      if (signature !== request.current.signature)
        request.current = { signature, id: crypto.randomUUID() };
      return read(
        await api.runs.$post({
          param: { workspaceId },
          json: { ...input, requestId: request.current.id },
        }),
      );
    },
    onSuccess: async () => {
      setBody("");
      request.current = { signature: "", id: "" };
      await invalidate();
    },
  });
  if (!canWrite)
    return (
      <>
        <ParticipantPages participants={participants} />
        {!participants.authorityPending && !participants.error && (
          <p>Run admission requires contributor access.</p>
        )}
      </>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        admit.mutate();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>Agent</FieldLabel>
          <ContextPicker
            label="Agent"
            value={agentId || "none"}
            options={{
              none: { label: "Choose Agent", icon: RiChat1Line },
              ...Object.fromEntries(
                available.map((agent) => [
                  agent.id,
                  { label: agent.title, icon: RiChat1Line },
                ]),
              ),
            }}
            onPick={(id) => {
              setAgentId(id === "none" ? "" : id);
              setSessionId("");
            }}
            disabled={admit.isPending}
          />
        </Field>
        <DirectoryPages kind="agents" />
        <ParticipantPages participants={participants} />
        {!available.length && (
          <p>
            {participants.hasNextPage || directory.agentsQuery.hasNextPage
              ? "Load more participants and Agents to find an eligible contributor."
              : "Add an eligible Agent as a contributor to this chat first."}
          </p>
        )}
        {selected && (
          <p>
            {selected.model} ·{" "}
            {selected.subscriptionId
              ? "Uses this Agent’s configured account."
              : "No configured AI account."}{" "}
            Account and model are managed in{" "}
            <Link to="/settings/agents/$agentId" params={{ agentId }}>
              Agent settings
            </Link>
            .
          </p>
        )}
        <ContextPicker
          label="Run type"
          value={type}
          options={{
            prompt: { label: "Prompt", icon: RiChat1Line },
            script: { label: "Script", icon: RiChat1Line },
          }}
          onPick={(value) => {
            setType(value as typeof type);
            setSessionId("");
          }}
          disabled={admit.isPending}
        />
        {type === "prompt" && (
          <>
            <QueryState
              pending={sessions.isPending}
              error={sessions.error}
              retry={sessions.refetch}
            />
            <ContextPicker
              label="Private Session"
              value={sessionId || "fresh"}
              options={{
                fresh: { label: "Fresh private Session", icon: RiChat1Line },
                ...Object.fromEntries(
                  (
                    sessions.data?.pages.flatMap((page) => page.items) ?? []
                  ).map((session) => [
                    session.id,
                    {
                      label: `Continue ${session.createdAt ? new Date(session.createdAt).toLocaleString() : session.id}`,
                      icon: RiChat1Line,
                    },
                  ]),
                ),
              }}
              onPick={(id) => setSessionId(id === "fresh" ? "" : id)}
              disabled={admit.isPending || !agentId || Boolean(sessions.error)}
            />
            {sessions.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={sessions.isFetchingNextPage}
                onClick={() => sessions.fetchNextPage()}
              >
                More Sessions
              </Button>
            )}
            <p>
              Private context stays private. A continued Session must match the
              accepted scope, account and model; conflicts require your explicit
              fresh selection.
            </p>
          </>
        )}
        {chat.projectId && (
          <>
            <QueryState
              pending={tasks.isPending}
              error={tasks.error}
              retry={tasks.refetch}
            />
            <ContextPicker
              label="Task context"
              value={taskId || "none"}
              options={{
                none: { label: "No Task", icon: RiBox3Line },
                ...Object.fromEntries(
                  (tasks.data?.pages.flatMap((page) => page.items) ?? []).map(
                    (task) => [
                      task.id,
                      { label: task.title, icon: RiBox3Line },
                    ],
                  ),
                ),
              }}
              onPick={(id) => setTaskId(id === "none" ? "" : id)}
              disabled={admit.isPending}
            />
          </>
        )}
        {tasks.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={tasks.isFetchingNextPage}
            onClick={() => tasks.fetchNextPage()}
          >
            More Tasks
          </Button>
        )}
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" type="button" />}>
            Select execution context
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Button
              type="button"
              variant="ghost"
              disabled={admit.isPending}
              onClick={() => {
                setDocumentIds([]);
                setMessageIds([]);
              }}
            >
              Clear execution selections
            </Button>
            <QueryState
              pending={docs.isPending}
              error={docs.error}
              retry={docs.refetch}
            />
            {docs.data?.pages
              .flatMap((page) => page.items)
              .map((document) => (
                <Field key={document.id} orientation="horizontal">
                  <Checkbox
                    id={`run-doc-${document.id}`}
                    checked={documentIds.includes(document.id)}
                    disabled={
                      admit.isPending ||
                      (!documentIds.includes(document.id) &&
                        documentIds.length >= 20)
                    }
                    onCheckedChange={(checked) =>
                      setDocumentIds((ids) =>
                        checked
                          ? [...ids, document.id]
                          : ids.filter((id) => id !== document.id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`run-doc-${document.id}`}>
                    {document.title}
                  </FieldLabel>
                </Field>
              ))}
            {docs.hasNextPage && (
              <Button
                type="button"
                variant="ghost"
                disabled={docs.isFetchingNextPage}
                onClick={() => docs.fetchNextPage()}
              >
                More Documents
              </Button>
            )}
            {messages.slice(-100).map((message) => (
              <Field key={message.id} orientation="horizontal">
                <Checkbox
                  id={`run-message-${message.id}`}
                  checked={messageIds.includes(message.id)}
                  disabled={admit.isPending}
                  onCheckedChange={(checked) =>
                    setMessageIds((ids) =>
                      checked
                        ? [...ids, message.id]
                        : ids.filter((id) => id !== message.id),
                    )
                  }
                />
                <FieldLabel htmlFor={`run-message-${message.id}`}>
                  {message.body.slice(0, 80)}
                </FieldLabel>
              </Field>
            ))}
          </CollapsibleContent>
        </Collapsible>
        <Field>
          <FieldLabel htmlFor="run-body">
            {type === "script" ? "Script" : "Prompt"}
          </FieldLabel>
          <Textarea
            id="run-body"
            required
            maxLength={100000}
            value={body}
            disabled={admit.isPending}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        {admit.error && (
          <p role="alert">
            {admit.error.message} No account, model or Session fallback was
            attempted.
          </p>
        )}
        <Button
          type="submit"
          disabled={
            chat.archived ||
            !agentId ||
            !available.some((agent) => agent.id === agentId) ||
            !body.trim() ||
            admit.isPending ||
            (type === "prompt" && !selected?.subscriptionId)
          }
        >
          {admit.isPending ? "Admitting Run" : "Start Run"}
        </Button>
        {chat.archived && <p>Restore the chat before starting a new Run.</p>}
      </FieldGroup>
    </form>
  );
}
