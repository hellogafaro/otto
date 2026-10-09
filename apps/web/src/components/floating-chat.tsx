import {
  type RemixiconComponentType,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiChat1Line,
  RiCloseLine,
  RiEditBoxLine,
  RiExpandDiagonalLine,
  RiInboxLine,
  RiSubtractLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
} from "@workspace/ui/components/combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  type ReactNode,
  type Ref,
  type RefObject,
  useContext,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  Composer,
  type ComposerHandle,
  type FileRef,
} from "@/components/composer";
import { ListRow } from "@/components/list-row";
import { type MentionType, mention } from "@/components/mentions";
import { QueryState } from "@/components/query-state";
import { read } from "@/lib/api";
import {
  type LiveChat,
  useChat,
  useChatMessages,
  useChatPermissions,
  useChats,
  useMessageSend,
  useParticipants,
} from "@/lib/chat-data";
import { useChatUpload } from "@/lib/chat-upload";
import { useWorkspace } from "@/lib/workspace";
import {
  ChatComposer,
  ChatPresence,
  ChatRunFeed,
  ChatThread,
  useNewChat,
  WithPicker,
} from "@/routes/chats";
import "@/components/floating-chat.css";

type FloatingChatState = {
  /** The conversation in the window; none for a new one. */
  chatId?: string;
  /** Grown into the window, or just the bar. */
  expanded: boolean;
  /** The window lists your chats that need you instead of one chat. */
  listing: boolean;
};

type FloatingChatValue = FloatingChatState & {
  /** Moves to another state, morphing when its shape changes. */
  change: (next: Partial<FloatingChatState>) => void;
  /** The page's floating chat composer, for others to prefill. */
  composer: RefObject<ComposerHandle | null>;
  viewRevision: RefObject<number>;
};

const FloatingChatContext = createContext<FloatingChatValue | null>(null);

// The conversation outlives the page: it follows you from page to page.
export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FloatingChatState>({
    expanded: false,
    listing: false,
  });
  const composer = useRef<ComposerHandle>(null);
  const viewRevision = useRef(0);
  // Folding, growing and switching between a chat and the list morph
  // (View Transitions), unless reduced motion is asked for or the browser
  // can't. Only a change of shape morphs; replies just render.
  const change = (next: Partial<FloatingChatState>) => {
    viewRevision.current += 1;
    const target = { ...state, ...next };
    const apply = () => setState(target);
    const reshapes =
      target.expanded !== state.expanded ||
      (target.expanded &&
        (target.listing !== state.listing || target.chatId !== state.chatId));
    if (
      !reshapes ||
      !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return apply();
    // Growing ("open"), folding ("closed"), or the open window switching
    // between a chat and the list ("switch"): the CSS times each its way.
    document.documentElement.dataset.floatingChat = !target.expanded
      ? "closed"
      : state.expanded
        ? "switch"
        : "open";
    document.startViewTransition(() => flushSync(apply));
  };
  return (
    <FloatingChatContext value={{ ...state, change, composer, viewRevision }}>
      {children}
    </FloatingChatContext>
  );
}

// Prefills the page's floating chat, e.g. the file viewer's Ask, which
// closes the viewer and starts the bar with a link to the file.
export function useAskAgent() {
  const { composer } = useFloatingChat();
  // After the viewer has closed, so the bar can take focus.
  return (text: string) => setTimeout(() => composer.current?.prefill(text));
}

function useFloatingChat() {
  const value = useContext(FloatingChatContext);
  if (!value) throw new Error("useFloatingChat needs a FloatingChatProvider");
  return value;
}

type Subject = { type: MentionType; id: string; label: string };

export function FloatingChat({
  about,
  projectId,
  subject,
  ref,
}: {
  about: string;
  projectId?: string;
  subject?: Subject;
  ref?: Ref<ComposerHandle>;
}) {
  const navigate = useNavigate();
  const { chatId, expanded, listing, change, composer, viewRevision } =
    useFloatingChat();
  const { api, workspaceId, workspace } = useWorkspace();
  const [withIds, setWithIds] = useState<string[]>([]);
  const current = useChat(chatId);
  const chat = current.error ? undefined : current.data;
  const participants = useParticipants(chatId);
  const permissions = useChatPermissions(chat, participants);
  const messages = useChatMessages(
    chatId,
    expanded && !listing && Boolean(chat),
  );
  const chats = useChats({ archived: "false" });
  const attention = useQuery({
    queryKey: ["workspace", workspaceId, "floating-attention"],
    queryFn: async () =>
      read(
        await api.attention.$get({
          param: { workspaceId },
          query: { limit: "100" },
        }),
      ),
    refetchInterval: 5000,
    retry: false,
  });
  const newChat = useNewChat();
  const upload = useChatUpload(projectId);
  const sendMessage = useMessageSend(chatId);
  const questionRuns = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "floating-question-runs",
      attention.data?.questions.items.map((question) => question.runId),
    ],
    queryFn: async () =>
      Promise.all(
        [
          ...new Set(
            attention.data?.questions.items.map((question) => question.runId) ??
              [],
          ),
        ].map(async (id) =>
          read(await api.runs[":id"].$get({ param: { workspaceId, id } })),
        ),
      ),
    enabled: Boolean(attention.data) && !attention.error,
    retry: false,
  });
  const pendingIds = new Set(
    questionRuns.error ? [] : questionRuns.data?.map((run) => run.chatId),
  );
  const unreadIds = new Set(
    attention.error ? [] : attention.data?.items.map((item) => item.chatId),
  );
  const pending = (
    chats.error ? [] : (chats.data?.pages.flatMap((page) => page.items) ?? [])
  ).filter((item) => pendingIds.has(item.id) || unreadIds.has(item.id));
  const setComposer = (handle: ComposerHandle | null) => {
    composer.current = handle;
    if (typeof ref === "function") ref(handle);
    else if (ref) ref.current = handle;
  };
  // Closing the window only changes presentation; it never ends a Run or deletes its Chat.
  const show = (id: string) =>
    change({ chatId: id, listing: false, expanded: true });
  const list = () => change({ listing: true, expanded: true });

  const send = async (body: string, files: FileRef[]) => {
    const submittedView = viewRevision.current;
    if (chatId) {
      await sendMessage.mutateAsync({
        body,
        fileIds: files.map((file) => file.id),
      });
      if (submittedView === viewRevision.current) change({ expanded: true });
    } else {
      const created = await newChat.mutateAsync({
        memberIds: withIds,
        body: subject ? `${mention(subject)} ${body}` : body,
        files,
        projectId,
        visibility: "participants",
      });
      if (submittedView === viewRevision.current) show(created.id);
    }
  };
  const morphs = (name: string) => ({ viewTransitionName: name });
  const chatsLabel = pending.length
    ? `Chats, ${pending.length} loaded chats unread or awaiting answers`
    : "Chats";
  const failure = sendMessage.error ?? newChat.error;
  return (
    <div className="relative h-10">
      <div
        className={cn(
          "pointer-events-auto absolute left-1/2 flex -translate-x-1/2",
          expanded
            ? "-bottom-1 w-[calc(100%+--spacing(2))] max-w-[calc(var(--container-3xl)+--spacing(2))]"
            : "bottom-0 w-full max-w-[28.125rem]",
        )}
      >
        <div
          role="dialog"
          aria-label="Chat"
          style={morphs("floating-chat")}
          className={cn(
            "flex min-w-0 flex-1 flex-col rounded-xl backdrop-blur-2xl backdrop-saturate-150",
            expanded &&
              "dark bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10",
            "pointer-events-auto",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape" && expanded)
              change({ expanded: false, listing: false });
          }}
        >
          {expanded && (
            <div className="flex max-h-[min(30rem,55vh)] flex-col">
              <header className="flex h-10 shrink-0 items-center justify-between gap-1 p-1">
                {listing ? (
                  <h2 className="truncate pl-3 text-sm font-medium">Chats</h2>
                ) : chat ? (
                  <Switcher chat={chat} onPick={show} />
                ) : (
                  <h2 className="truncate pl-3 text-sm font-medium">
                    {chatId ? "Loading chat" : "New chat"}
                  </h2>
                )}
                <div className="flex items-center gap-1">
                  {!listing && (
                    <Action
                      label={chatsLabel}
                      icon={RiInboxLine}
                      dot={pending.length > 0}
                      onClick={list}
                    />
                  )}
                  <Action
                    label="New chat"
                    icon={RiEditBoxLine}
                    onClick={() => {
                      newChat.reset();
                      change({ chatId: undefined, listing: false });
                    }}
                  />
                  <Action
                    label="Minimize"
                    icon={RiSubtractLine}
                    onClick={() => change({ expanded: false, listing: false })}
                  />
                  {chat && !listing && (
                    <Action
                      label="Open as a page"
                      icon={RiExpandDiagonalLine}
                      onClick={() => {
                        change({ expanded: false });
                        void navigate({
                          to: "/chats/$chatId",
                          params: { chatId: chat.id },
                        });
                      }}
                    />
                  )}
                  <Action
                    label="Close"
                    icon={RiCloseLine}
                    onClick={() => {
                      newChat.reset();
                      change({
                        chatId: undefined,
                        listing: false,
                        expanded: false,
                      });
                    }}
                  />
                </div>
              </header>
              {listing ? (
                <>
                  <QueryState
                    pending={
                      chats.isPending ||
                      attention.isPending ||
                      questionRuns.isPending
                    }
                    error={chats.error ?? attention.error ?? questionRuns.error}
                    retry={() => {
                      void chats.refetch();
                      void attention.refetch();
                      void questionRuns.refetch();
                    }}
                  />
                  {!chats.error && !attention.error && !questionRuns.error && (
                    <ul className="no-scrollbar flex min-h-0 scroll-fade-y flex-col gap-0.5 overflow-y-auto px-2 pb-2">
                      {pending.map((item) => (
                        <ListRow
                          key={item.id}
                          media={<RiChat1Line />}
                          title={item.title}
                          onClick={() => show(item.id)}
                        />
                      ))}
                      {!pending.length && (
                        <li className="px-2 pb-2">
                          No unread chats or questions in this page.
                        </li>
                      )}
                    </ul>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      change({ expanded: false });
                      void navigate({ to: "/chats" });
                    }}
                  >
                    Browse all chats
                  </Button>
                  {chats.hasNextPage && (
                    <Button
                      variant="ghost"
                      disabled={chats.isFetchingNextPage}
                      onClick={() => chats.fetchNextPage()}
                    >
                      More chats
                    </Button>
                  )}
                  {(attention.data?.next || attention.data?.questions.next) && (
                    <p className="px-4 pb-2">
                      More unread items or questions are available in Inbox.
                    </p>
                  )}
                </>
              ) : chatId ? (
                <>
                  <QueryState
                    pending={current.isPending || messages.isPending}
                    error={current.error ?? messages.error}
                    retry={() => {
                      void current.refetch();
                      void messages.refetch();
                    }}
                  />
                  {chat && !messages.error && (
                    <ChatThread
                      chatId={chat.id}
                      messages={messages.data ?? []}
                      className="px-4 pt-3 pb-4"
                    >
                      <ChatPresence chatId={chat.id} />
                      <ChatRunFeed
                        chatId={chat.id}
                        canWrite={permissions.canWrite}
                      />
                    </ChatThread>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1 px-2 pt-3 pb-1">
                  <WithPicker
                    value={withIds}
                    onChange={setWithIds}
                    projectId={projectId}
                  />
                </div>
              )}
            </div>
          )}
          {!(expanded && listing) && (
            <div
              style={morphs("floating-composer")}
              className={cn(expanded && "p-1 pt-0")}
            >
              {newChat.createdChat && newChat.error && (
                <p className="px-3">
                  Chat saved; setup needs retry.{" "}
                  <Link
                    to="/chats/$chatId"
                    params={{ chatId: newChat.createdChat.id }}
                  >
                    Open saved chat
                  </Link>
                </p>
              )}
              {failure && (
                <p role="alert" className="px-3">
                  {failure.message} Your draft is retained.
                </p>
              )}
              {chatId && current.error && (
                <QueryState error={current.error} retry={current.refetch} />
              )}
              {chat ? (
                <ChatComposer
                  chat={chat}
                  composerRef={setComposer}
                  onSend={send}
                  sending={sendMessage.isPending}
                  disabled={!permissions.canWrite}
                  compact={!expanded}
                  embedded={expanded}
                  tools={
                    !expanded ? (
                      <Resume chat={chat} onOpen={() => show(chat.id)} />
                    ) : undefined
                  }
                  idle={
                    pending.length > 0 ? (
                      <Action
                        label={chatsLabel}
                        icon={RiInboxLine}
                        dot
                        onClick={list}
                      />
                    ) : undefined
                  }
                />
              ) : (
                <Composer
                  projectId={projectId}
                  upload={upload.upload}
                  ref={setComposer}
                  compact={!expanded}
                  embedded={expanded}
                  placeholder={`Message about ${about}`}
                  onSend={send}
                  pending={newChat.isPending}
                  disabled={Boolean(chatId) || workspace.role === "viewer"}
                  idle={
                    pending.length > 0 ? (
                      <Action
                        label={chatsLabel}
                        icon={RiInboxLine}
                        dot
                        onClick={list}
                      />
                    ) : undefined
                  }
                />
              )}
              {chatId && !permissions.canWrite && (
                <p className="px-3">This chat is read-only for you.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Resume({ chat, onOpen }: { chat: LiveChat; onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="plain"
      size="compact"
      aria-label={`Open ${chat.title}`}
      className="max-w-40"
      onClick={onOpen}
    >
      <RiChat1Line />
      <span className="truncate">{chat.title}</span>
      <RiArrowUpSLine data-icon="inline-end" />
    </Button>
  );
}
function Switcher({
  chat,
  onPick,
}: {
  chat: LiveChat;
  onPick: (chatId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const chats = useChats({ archived: "false", query: query || undefined });
  const items = chats.error
    ? []
    : (chats.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        className="min-w-0 pl-1.25"
        aria-label={`Chat: ${chat.title}`}
        onClick={() => setOpen(true)}
      >
        <RiChat1Line />
        <span className="truncate">{chat.title}</span>
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <Combobox
        items={items}
        value={chat}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(item: LiveChat) => item.title}
        isItemEqualToValue={(a: LiveChat, b: LiveChat) => a.id === b.id}
        onValueChange={(next: LiveChat | null) => {
          if (next) {
            setOpen(false);
            onPick(next.id);
          }
        }}
      >
        <ComboboxContent anchor={anchor} className="w-80">
          <ComboboxSearch
            placeholder="Search titles (whole words)"
            onChange={(event) => setQuery(event.target.value)}
          />
          <QueryState
            pending={chats.isPending}
            error={chats.error}
            retry={chats.refetch}
          />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(item: LiveChat) => (
              <ComboboxItem key={item.id} value={item}>
                <RiChat1Line />
                {item.title}
              </ComboboxItem>
            )}
          </ComboboxList>
          {chats.hasNextPage && (
            <Button
              variant="ghost"
              disabled={chats.isFetchingNextPage}
              onClick={() => chats.fetchNextPage()}
            >
              More chats
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
    </>
  );
}
function Action({
  label,
  icon: Icon,
  dot,
  onClick,
}: {
  label: string;
  icon: RemixiconComponentType;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="relative"
            onClick={onClick}
          />
        }
      >
        <Icon />
        {dot && (
          <span className="absolute top-[calc(50%-11px)] right-[calc(50%-11px)] size-2 rounded-full bg-destructive" />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
