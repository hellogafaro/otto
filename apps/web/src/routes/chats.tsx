import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowRightSLine,
  RiChat1Line,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiHashtag,
} from "@remixicon/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { AttachmentGroup } from "@workspace/ui/components/attachment";
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
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment, useEffect, useState } from "react";
import { Composer, FileAttachment, type FileRef } from "@/components/composer";
import { NewItem, PanelToggle, Section, WithPanel } from "@/components/detail";
import { NotFound } from "@/components/empty-page";
import { FileItems, fileResource, Lightbox } from "@/components/files";
import { IconAction } from "@/components/icon-action";
import { MentionText } from "@/components/mentions";
import { SectionSidebar } from "@/components/section-sidebar";
import {
  ActorAvatar,
  actorOf,
  nameColors,
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
  type Resource,
} from "@/mock/tasks";

const groups: { title: string; type: Chat["type"] }[] = [
  { title: "Projects", type: "project" },
  { title: "Direct", type: "direct" },
];

// The Chats list: project chats (#name) then direct chats (avatar and name).
export function ChatsSidebar() {
  const matchRoute = useMatchRoute();
  return (
    <SectionSidebar
      title="Chats"
      actions={<IconAction label="New chat" icon={RiAddLine} />}
    >
      {groups.map((group) => (
        <div key={group.type}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarMenu>
            {chats
              .filter((chat) => chat.type === group.type)
              .map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    isActive={Boolean(
                      matchRoute({
                        to: "/chats/$chatId",
                        params: { chatId: chat.id },
                      }),
                    )}
                    render={
                      <Link to="/chats/$chatId" params={{ chatId: chat.id }} />
                    }
                  >
                    <ChatIcon chat={chat} />
                    <span>{chat.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </div>
      ))}
    </SectionSidebar>
  );
}

function ChatIcon({ chat }: { chat: Chat }) {
  return chat.withId ? (
    <ActorAvatar actorId={chat.withId} />
  ) : (
    <RiHashtag className="text-muted-foreground" />
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
  const name = chat.type === "project" ? `#${chat.title}` : chat.title;
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
      panel={<ChatPanel chat={chat} shared={shared} onOpen={setOpenId} />}
    >
      <Lightbox resources={shared} openId={openId} onOpen={setOpenId} />
      <Topbar actions={<PanelToggle />}>
        <Button variant="ghost" size="sm" aria-current="page">
          <ChatIcon chat={chat} />
          {chat.title}
        </Button>
      </Topbar>
      <MessageScrollerProvider defaultScrollPosition="end" autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end gap-3.5 px-5 pt-5 pb-6">
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
                    <Turn messages={turn} onAnswer={send} onOpen={setOpenId} />
                  </MessageScrollerItem>
                </Fragment>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* Shown once you scroll up: a labelled 32px outline button,
              16px above the composer. The list fades out under it
              (the viewport's scroll-fade-y). */}
          <MessageScrollerButton variant="outline" size="sm">
            <RiArrowDownLine data-icon="inline-start" />
            Scroll to end
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl px-5 pb-5">
        <Composer placeholder={`Message ${name}, @ to tag`} onSend={send} />
      </div>
    </WithPanel>
  );
}

// What the chat is about and who and what is in it: its project (project
// chats), its members (people, then agents) and the resources shared in it,
// newest first. Resources hide until something is shared.
function ChatPanel({
  chat,
  shared,
  onOpen,
}: {
  chat: Chat;
  shared: Resource[];
  onOpen: (id: string) => void;
}) {
  const members = [...chat.memberIds].sort(
    (a, b) => Number(a in agents) - Number(b in agents),
  );
  const project = chat.projectId && projectLooks[chat.projectId];

  return (
    <>
      {chat.projectId && project && (
        <Section title="Project">
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: chat.projectId }}
                />
              }
            >
              <project.icon className={project.className} />
              <span>{project.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </Section>
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
    </div>
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
