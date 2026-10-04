import { RiInboxLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useReducer } from "react";
import { EmptyPage } from "@/components/empty-page";
import { FloatingChat } from "@/components/floating-chat";
import { Page } from "@/components/page";
import {
  ActorAvatar,
  actorOf,
  byUrgency,
  ChatIcon,
  Count,
  chatState,
  chatStatus,
  needsYou,
} from "@/components/task-meta";
import {
  type Chat,
  chats,
  currentUserId,
  type Notification,
  notifications,
  type Schedule,
  schedules,
  type TaskStatus,
  tasks,
  users,
} from "@/mock/tasks";
import { ago, ChatMenuItems } from "@/routes/chats";
import { ScheduleRow } from "@/routes/schedules";
import { TaskRow } from "@/routes/tasks";

const isToday = (at: string) =>
  new Date(at).toDateString() === new Date().toDateString();

// "9:00", "18:30": the clock, as next runs show it.
const time = (at: string) => {
  const date = new Date(at);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
};

// Tasks that need you first: in review, then doing, then to do.
const taskOrder: TaskStatus[] = ["review", "doing", "todo"];

// Home ("/"), like Notion's: your day under a centered greeting, in one
// section per kind, each row the same as on its own page. Tasks: what you
// own or are assigned, still open, review first. Notifications: mentions,
// assignments, review requests and shares today. Chats: those waiting on you
// (a question, a review, a failed run) or unread. Schedules: today's runs,
// done ("Ran 9:00") and still to come ("Today 18:00"). Empty sections don't
// show; with nothing at all, the empty page.
export function InboxPage() {
  // Organizing a chat (done, snooze…) changes the mock; this redraws.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const myTasks = tasks
    .filter(
      (task) =>
        (task.ownerId === currentUserId ||
          task.assigneeUserId === currentUserId) &&
        taskOrder.includes(task.status),
    )
    .sort(
      (a, b) =>
        taskOrder.indexOf(a.status) - taskOrder.indexOf(b.status) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const today = notifications.filter(({ createdAt }) => isToday(createdAt));
  const myChats = chats
    .filter((chat) => {
      const state = chatState(chat);
      return (
        !chat.archived &&
        !chat.parentId &&
        !chat.done &&
        (needsYou(state) || state === "unread")
      );
    })
    .sort(byUrgency);
  const runs = todaysRuns();

  if (myTasks.length + today.length + myChats.length + runs.length === 0) {
    return (
      <EmptyPage
        icon={RiInboxLine}
        title="Nothing needs you"
        description="Tasks, mentions and reviews waiting on you show up here."
        ask={{
          about: "this page",
          action: "New task",
          start: "Add a task to ",
        }}
      />
    );
  }

  return (
    <Page
      title={greeting()}
      centered
      floating={<FloatingChat about="your day" />}
    >
      <div className="flex flex-col gap-10 pt-5">
        <Section title="Tasks" count={myTasks.length}>
          {myTasks.map((task) => (
            <TaskRow key={task.id} task={task} showProject grouped={false} />
          ))}
        </Section>
        <Section title="Notifications" count={today.length}>
          {today.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
            />
          ))}
        </Section>
        <Section title="Chats" count={myChats.length}>
          {myChats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} onChange={redraw} />
          ))}
        </Section>
        <Section title="Schedules" count={runs.length}>
          {runs.map(({ schedule, when }) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              when={when}
              grouped={false}
            />
          ))}
        </Section>
      </div>
    </Page>
  );
}

// "Good afternoon, Johan": the hour picks the word.
function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${users[currentUserId].name.split(" ")[0]}`;
}

// Each schedule with a run today, by time: its last run today if it ran
// ("Ran 9:00", "Failed 9:00"), else its next run if that is today.
function todaysRuns() {
  return schedules
    .flatMap(
      (schedule): { schedule: Schedule; at: string; when?: string }[] => {
        if (schedule.status !== "active") return [];
        const ran = schedule.activity.findLast(
          (item) => item.run && isToday(item.createdAt),
        );
        if (ran)
          return [
            {
              schedule,
              at: ran.createdAt,
              when: `${ran.run === "failed" ? "Failed" : "Ran"} ${time(ran.createdAt)}`,
            },
          ];
        return schedule.nextAt && isToday(schedule.nextAt)
          ? [{ schedule, at: schedule.nextAt }]
          : [];
      },
    )
    .sort((a, b) => a.at.localeCompare(b.at));
}

// A section of the day: its heading (an h2 with its count, like Activity's)
// and its rows, pulled out by the rows' 1px border and 8px padding so their
// icons line up with the heading. Empty, it doesn't show.
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-base font-medium">
        {title}
        <Count>{count}</Count>
      </h2>
      <ul className="-mx-[9px] flex flex-col">{children}</ul>
    </section>
  );
}

// "Forge mentioned you in Fix sign-in…": who (their avatar and name), what
// they did, and on what (it opens); then how long ago. Read ones are muted.
function NotificationRow({ notification }: { notification: Notification }) {
  const { actorId, body, target, createdAt, read } = notification;
  return (
    <li>
      <Item
        size="xs"
        render={
          target.type === "task" ? (
            <Link to="/tasks/$taskId" params={{ taskId: target.id }} />
          ) : (
            <Link
              to="/documents/$documentId"
              params={{ documentId: target.id }}
            />
          )
        }
      >
        <ItemMedia>
          <ActorAvatar actorId={actorId} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className={cn(read && "text-muted-foreground")}>
            {actorOf(actorId).name}
            <span className="font-normal text-muted-foreground">{body}</span>
            {target.title}
          </ItemTitle>
        </ItemContent>
        <ItemActions>
          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
            {ago(createdAt)}
          </span>
        </ItemActions>
      </Item>
    </li>
  );
}

// A chat, as a task's row: why it is here (its status icon, where a task's
// status sits; none when just unread), its title and icon, then what it
// wants and how long ago. Right-click opens the chat's menu, as in the Chats
// sidebar.
function ChatRow({ chat, onChange }: { chat: Chat; onChange: () => void }) {
  const status = chatStatus(chat);
  const last = chat.messages.at(-1);
  const change = (update: Partial<Chat>) => {
    Object.assign(chat, update);
    onChange();
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <Item
          size="xs"
          render={<Link to="/chats/$chatId" params={{ chatId: chat.id }} />}
        >
          <ItemMedia>
            <ChatIcon chat={chat} />
          </ItemMedia>
          <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-2">
            <ItemTitle>{chat.title}</ItemTitle>
          </ItemContent>
          <ItemActions>
            {status && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <status.icon className={cn("size-3.5", status.className)} />
                {status.label}
              </span>
            )}
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {ago(last?.createdAt)}
            </span>
          </ItemActions>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ChatMenuItems chat={chat} onChange={change} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
