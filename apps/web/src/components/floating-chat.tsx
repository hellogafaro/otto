import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiEditBoxLine,
  RiExpandDiagonalLine,
  RiInboxLine,
  RiSubtractLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
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
  useReducer,
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
import {
  actorOf,
  ChatIcon,
  chatKind,
  chatOther,
  chatState,
  chatStatus,
} from "@/components/task-meta";
import "@/components/floating-chat.css";
import {
  agents,
  type Chat,
  type ChatMessage,
  chats,
  currentUserId,
} from "@/mock/tasks";
import { ago, ChatThread, chatGroups, WithPicker } from "@/routes/chats";

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
};

const FloatingChatContext = createContext<FloatingChatValue | null>(null);

// The conversation outlives the page: it follows you from page to page.
export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FloatingChatState>({
    expanded: false,
    listing: false,
  });
  const composer = useRef<ComposerHandle>(null);
  // Folding, growing and switching between a chat and the list morph
  // (View Transitions), unless reduced motion is asked for or the browser
  // can't. Only a change of shape morphs; replies just render.
  const change = (next: Partial<FloatingChatState>) => {
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
    <FloatingChatContext value={{ ...state, change, composer }}>
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

// The item a page's conversation is about; it leads the first message as an
// inline link.
type Subject = { type: MentionType; id: string; label: string };

// Mock only: a new chat with them, in the page's project (fixed), with your
// message led by a link to the page's item, and an agent already working.
function startChat(
  memberIds: string[],
  body: string,
  files: FileRef[],
  projectId?: string,
  subject?: Subject,
) {
  const now = new Date().toISOString();
  const agentId = memberIds.find((id) => id in agents);
  const chat: Chat = {
    id: `c_${Date.now()}`,
    title: body.split("\n")[0].slice(0, 48) || "New chat",
    projectId,
    origin: subject && `${subject.type}:${subject.id}`,
    memberIds: [currentUserId, ...memberIds],
    createdAt: now,
    readAt: now,
    messages: [
      {
        id: "m1",
        actorId: currentUserId,
        body: subject ? `${mention(subject)} ${body}` : body,
        files,
        createdAt: now,
      },
      ...(agentId ? [working(agentId, 2)] : []),
    ],
  };
  chats.unshift(chat);
  return chat;
}

// Mock only: the agent's live status while it works on your message.
function working(agentId: string, index: number): ChatMessage {
  return {
    id: `m${index}`,
    actorId: agentId,
    body: "Working on it",
    working: true,
    createdAt: new Date().toISOString(),
  };
}

// The floating chat, on every page but Chats: one row at the bottom, kept
// one line tall so it never covers the page: the compact bar ("Ask Otto
// about this task"), with Chats (a red dot while any need you) before its
// main button while it is empty. Sending grows the bar into a window, the
// conversation rising above it; the window's title switches between all
// your chats; Chats lists the ones that need you; Minimize folds it back to
// the bar, which then shows the chat's status and reopens it; Close ends it.
// Bar and window share the command palette's surface: dark, translucent,
// blurred. The agent sees the page you are on. Page actions (log time)
// prefill it.
export function FloatingChat({
  about,
  projectId,
  subject,
  ref,
}: {
  /** What is open, e.g. "this task". */
  about: string;
  projectId?: string;
  subject?: Subject;
  ref?: Ref<ComposerHandle>;
}) {
  const navigate = useNavigate();
  const { chatId, expanded, listing, change, composer } = useFloatingChat();
  // The composer answers both the page's ref (page actions prefill it) and
  // the shared one (the file viewer's Ask).
  const setComposer = (handle: ComposerHandle | null) => {
    composer.current = handle;
    if (typeof ref === "function") ref(handle);
    else if (ref) ref.current = handle;
  };
  // Messages change the mock in memory; this redraws.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [withIds, setWithIds] = useState(["a_otto"]);
  const chat = chats.find(({ id }) => id === chatId);
  const other = chat && chatOther(chat);
  const name = chat
    ? chat.general
      ? `#${chat.title}`
      : chatKind(chat) === "channel" || !other
        ? chat.title
        : actorOf(other).name
    : withIds.map((id) => actorOf(id).name).join(" and ");
  // Only chats that wait on your input (a question) or are ready for your
  // review, not working or failed ones.
  const pending = chats.filter((item) => {
    const state = chatState(item);
    return (
      !item.archived &&
      !item.parentId &&
      (state === "question" || state === "review")
    );
  });
  const show = (id: string) =>
    change({ chatId: id, listing: false, expanded: true });
  const list = () => change({ listing: true, expanded: true });
  const placeholder = chat
    ? `Reply to ${name}`
    : withIds.length === 1 && withIds[0] === "a_otto"
      ? `Ask Otto about ${about}`
      : `Message ${name} about ${about}`;

  const send = (body: string, files: FileRef[]) => {
    if (chat) {
      const agentId = chat.memberIds.find((id) => id in agents);
      const current = chat.messages.filter((message) => !message.working);
      chat.messages = [
        ...current,
        {
          id: `m${current.length + 1}`,
          actorId: currentUserId,
          body,
          files,
          createdAt: new Date().toISOString(),
        },
        ...(agentId ? [working(agentId, current.length + 2)] : []),
      ];
      redraw();
      change({ expanded: true });
    } else {
      show(startChat(withIds, body, files, projectId, subject).id);
    }
  };

  // Named for the morph (View Transitions).
  const morphs = (name: string) => ({ viewTransitionName: name });
  const chatsLabel = pending.length
    ? `Chats, ${pending.length} need you`
    : "Chats";

  return (
    // The bar's place in the page (40px); the window grows up from it, over
    // the page. Grown: a 12px card, the column plus 4px a side, its bottom
    // 4px below the bar's, so the composer's bottom edge stays put. Inside,
    // the panel's insets: a 40px top bar (buttons 4px in), messages and the
    // composer's text on the same 16px line, the embedded composer 4px in
    // (8px corners), one step lighter. It fits its content, up to 30rem.
    // The Chats list has no composer. Changes morph (floating-chat.css).
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
            // The frost always lives here, on the outermost morph-named
            // element: a named element walls off what is behind it, so a
            // blur inside it (the bar's own) would frost nothing. Folded,
            // this is exactly the bar's box.
            "flex min-w-0 flex-1 flex-col rounded-xl backdrop-blur-2xl backdrop-saturate-150",
            expanded &&
              // The command palette's surface.
              "dark bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10",
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
                    New chat
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
                  {(chat || listing) && (
                    <Action
                      label="New chat"
                      icon={RiEditBoxLine}
                      onClick={() =>
                        change({ chatId: undefined, listing: false })
                      }
                    />
                  )}
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
                        navigate({
                          to: "/chats/$chatId",
                          params: { chatId: chat.id },
                        });
                      }}
                    />
                  )}
                  <Action
                    label="Close"
                    icon={RiCloseLine}
                    onClick={() =>
                      change({
                        chatId: undefined,
                        listing: false,
                        expanded: false,
                      })
                    }
                  />
                </div>
              </header>
              {listing ? (
                pending.length ? (
                  // Rows like the sidebar's, their icons near the 16px line.
                  <ul className="flex min-h-0 flex-col overflow-y-auto px-2 pb-2">
                    {pending.map((item) => {
                      const status = chatStatus(item);
                      return (
                        <ListRow
                          key={item.id}
                          media={<ChatIcon chat={item} />}
                          title={item.title}
                          end={
                            status && (
                              <status.icon
                                aria-label={status.label}
                                className={status.className}
                              />
                            )
                          }
                          onClick={() => show(item.id)}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-4 pb-4 text-sm text-muted-foreground">
                    Nothing needs you
                  </p>
                )
              ) : chat ? (
                <ChatThread
                  messages={chat.messages}
                  onAnswer={(body) => send(body, [])}
                  onOpen={() => {}}
                  className="px-4 pt-3 pb-4"
                />
              ) : (
                // A new chat: who it's with (Otto unless you pick), its
                // icon on the 16px line.
                <div className="flex items-center gap-1 px-2 pt-3 pb-1">
                  <WithPicker value={withIds} onChange={setWithIds} />
                </div>
              )}
            </div>
          )}
          {/* Folded, the one-line bar; grown, the embedded composer; none
              under the Chats list. */}
          {!(expanded && listing) && (
            <div
              style={morphs("floating-composer")}
              className={cn(expanded && "p-1 pt-0")}
            >
              {expanded ? (
                <Composer
                  embedded
                  ref={setComposer}
                  placeholder={placeholder}
                  onSend={send}
                />
              ) : (
                <Composer
                  compact
                  ref={setComposer}
                  placeholder={placeholder}
                  tools={
                    chat ? (
                      <Resume chat={chat} onOpen={() => show(chat.id)} />
                    ) : undefined
                  }
                  idle={
                    <Action
                      label={chatsLabel}
                      icon={RiInboxLine}
                      dot={pending.length > 0}
                      onClick={list}
                    />
                  }
                  onSend={send}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// "Something needs you": an 8px red dot centered on the 14px icon's top
// right corner (7px + 4px from the center), at any button size. No cut-out
// ring: on a translucent surface no solid color would match.
function Dot() {
  return (
    <span className="absolute top-[calc(50%-11px)] right-[calc(50%-11px)] size-2 rounded-full bg-destructive" />
  );
}

// In the folded bar: the chat's status (else its icon) and title; it reopens
// the window.
function Resume({ chat, onOpen }: { chat: Chat; onOpen: () => void }) {
  const status = chatStatus(chat);
  return (
    <Button
      type="button"
      variant="plain"
      size="compact"
      aria-label={`Open ${chat.title}`}
      className="max-w-40"
      onClick={onOpen}
    >
      {status ? (
        <status.icon className={status.className} />
      ) : (
        <ChatIcon chat={chat} />
      )}
      <span className="truncate">{chat.title}</span>
      <RiArrowUpSLine data-icon="inline-end" />
    </Button>
  );
}

// The window's title switches chats: a search over all your chats, grouped
// like the sidebar (Pinned, Waiting, Working, Snoozed, Done; no archived
// ones). One thing at each row's end: its status, else the time since its
// last message; the open chat shows the check instead.
function Switcher({
  chat,
  onPick,
}: {
  chat: Chat;
  onPick: (chatId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const groups = chatGroups()
    .filter((group) => group.chats.length > 0)
    .map((group) => ({ value: group.title, items: group.chats }));
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        // 4px in, like the close button; its 20px icon or avatar 6px inside
        // it on every side (5px + the 1px border), like sidebar rows.
        className="min-w-0 pl-1.25"
        aria-label={`Chat: ${chat.title}`}
        onClick={() => setOpen(true)}
      >
        <ChatIcon chat={chat} />
        <span className="truncate">{chat.title}</span>
        <RiArrowDownSLine data-icon="inline-end" />
      </Button>
      <Combobox
        autoHighlight
        items={groups}
        value={chat}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(item: Chat) => item.title}
        isItemEqualToValue={(a: Chat, b: Chat) => a.id === b.id}
        onValueChange={(next: Chat | null) => {
          if (!next) return;
          setOpen(false);
          onPick(next.id);
        }}
      >
        <ComboboxContent anchor={anchor} className="w-80">
          <ComboboxSearch placeholder="Search chats" />
          <ComboboxEmpty>No matches</ComboboxEmpty>
          <ComboboxList>
            {(group: (typeof groups)[number]) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: Chat) => (
                    <SwitcherItem
                      key={item.id}
                      chat={item}
                      open={item.id === chat.id}
                    />
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}

function SwitcherItem({ chat, open }: { chat: Chat; open: boolean }) {
  const status = chatStatus(chat);
  return (
    <ComboboxItem value={chat}>
      <ChatIcon chat={chat} />
      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      {!open && (
        <span className="pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center text-xs text-muted-foreground">
          {status ? (
            <status.icon
              aria-label={status.label}
              className={status.className}
            />
          ) : (
            ago(chat.messages.at(-1)?.createdAt ?? chat.createdAt)
          )}
        </span>
      )}
    </ComboboxItem>
  );
}

function Action({
  label,
  icon: Icon,
  dot,
  onClick,
}: {
  label: string;
  icon: typeof RiCloseLine;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="relative"
            onClick={onClick}
          />
        }
      >
        <Icon />
        {dot && <Dot />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
