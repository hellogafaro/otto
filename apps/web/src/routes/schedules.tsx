import {
  RiAddLine,
  RiCalendarScheduleLine,
  RiChat1Line,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCodeSSlashLine,
  RiPlayLine,
  RiRobot3Line,
  RiSearchLine,
  RiShapesLine,
  RiUserLine,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { toast } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useReducer, useState } from "react";
import { ActivityEvent, Timeline, TimelineItem } from "@/components/activity";
import { useCommandPalette } from "@/components/command-palette";
import {
  ChoiceItem,
  DetailView,
  PersonPicker,
  Section,
} from "@/components/detail";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  NoResults,
  omit,
} from "@/components/filters";
import { FloatingChat, useAskAgent } from "@/components/floating-chat";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { ListGroup } from "@/components/list-group";
import { Page } from "@/components/page";
import {
  ActorAvatar,
  actorOf,
  ChatIcon,
  chatWithLooks,
  type Look,
  nextRunLabel,
  ownerLooks,
  People,
  repeatLook,
  repeatPresets,
  scheduleStatuses,
} from "@/components/task-meta";
import {
  type Activity,
  agents,
  chats,
  currentUserId,
  type Schedule,
  type ScheduleStatus,
  schedules,
} from "@/mock/tasks";

// What a schedule runs: a prompt an agent answers, or code.
const kinds: Record<Schedule["kind"], Look> = {
  prompt: { label: "Prompt", icon: RiChat1Line },
  code: { label: "Code", icon: RiCodeSSlashLine },
};

// Filters live in the URL, like Tasks': its type (prompt or code), the agent
// that answers it and its owner ("me" is you). A missing key means any.
export type SchedulesSearch = {
  type?: Schedule["kind"];
  agent?: string;
  owner?: string;
};

export function validateSchedulesSearch(
  search: Record<string, unknown>,
): SchedulesSearch {
  const pick = (value: unknown, valid: (value: string) => boolean) =>
    typeof value === "string" && valid(value) ? value : undefined;
  return {
    type: pick(search.type, (v) => v in kinds) as Schedule["kind"] | undefined,
    agent: pick(search.agent, (v) => v in agents),
    owner: pick(search.owner, (v) => v === "me" || v in ownerLooks),
  };
}

const agentLooks: Record<string, Look> = Object.fromEntries(
  Object.keys(agents).map((id) => [id, chatWithLooks[id]]),
);

const filters: FilterDef<keyof SchedulesSearch>[] = [
  { key: "type", label: "Type", icon: RiShapesLine, options: kinds },
  {
    key: "agent",
    label: "Agent",
    icon: RiRobot3Line,
    people: true,
    options: agentLooks,
  },
  {
    key: "owner",
    label: "Owner",
    icon: RiUserLine,
    people: true,
    options: {
      me: { ...ownerLooks[currentUserId], label: "Me" },
      ...omit(ownerLooks, currentUserId),
    },
  },
];

const order: ScheduleStatus[] = ["active", "paused", "archived"];

// A new schedule starts as a sentence to an agent, never a form: + (and the
// empty page) start the floating chat with "Every ".
const NEW_SCHEDULE = "Every ";

const lowerFirst = (text: string) =>
  text.replace(/^[A-Z]/, (first) => first.toLowerCase());

// Schedules like Tasks: grouped by state (Active, Paused, then Archived,
// folded), filtered by type, agent and owner. Each row says when it
// runs next.
export function SchedulesPage({ search }: { search: SchedulesSearch }) {
  const navigate = useNavigate({ from: "/schedules" });
  const openPalette = useCommandPalette();
  const ask = useAskAgent();
  const visible = schedules.filter(
    (schedule) =>
      (!search.type || schedule.kind === search.type) &&
      (!search.agent || schedule.agentId === search.agent) &&
      (!search.owner ||
        schedule.ownerId ===
          (search.owner === "me" ? currentUserId : search.owner)),
  );
  const change = (key: keyof SchedulesSearch, value: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, [key]: value }) });
  const clear = () => navigate({ search: {} });

  if (schedules.length === 0) {
    return (
      <EmptyPage
        icon={RiCalendarScheduleLine}
        title="No schedules"
        description="Run a prompt or code on a schedule, and post the result to a chat."
        ask={{
          about: "your schedules",
          action: "New schedule",
          start: NEW_SCHEDULE,
        }}
      />
    );
  }

  return (
    <Page
      title="Schedules"
      width="wide"
      floating={<FloatingChat about="your schedules" />}
      actions={
        <>
          <FilterMenu filters={filters} values={search} onChange={change} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette()}
          />
          <IconAction
            label="New schedule"
            icon={RiAddLine}
            onClick={() => ask(NEW_SCHEDULE)}
          />
        </>
      }
    >
      <FilterBar
        filters={filters}
        values={search}
        onChange={change}
        onClear={clear}
      />
      {visible.length === 0 ? (
        <NoResults what="schedules" onClear={clear} />
      ) : (
        <div className="flex flex-col gap-2">
          {order.map((status) => {
            const group = visible.filter((item) => item.status === status);
            return (
              <ListGroup
                key={status}
                look={scheduleStatuses[status]}
                count={group.length}
                defaultOpen={status !== "archived"}
              >
                {group.map((schedule) => (
                  <ScheduleRow key={schedule.id} schedule={schedule} />
                ))}
              </ListGroup>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// A schedule's row, like a task's: its state, title, owner and agent; then
// when it runs next (or that it is paused). Right-click opens the shared
// item menu; schedules archive, never delete.
export function ScheduleRow({
  schedule,
  grouped = true,
  when,
}: {
  schedule: Schedule;
  /** Under a list group's header (the chevron column); not on Home. */
  grouped?: boolean;
  /** What the right side says instead of the next run (Home: "Ran 9:00"). */
  when?: string;
}) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  const status = scheduleStatuses[schedule.status];
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <Item
          size="xs"
          render={
            <Link
              to="/schedules/$scheduleId"
              params={{ scheduleId: schedule.id }}
            />
          }
        >
          {/* Chevron column, so the state icon sits under the header's. */}
          {grouped && <span className="size-3.5 shrink-0" aria-hidden />}
          <ItemMedia variant="icon">
            <status.icon
              aria-label={status.label}
              className={status.className}
            />
          </ItemMedia>
          <ItemContent className="flex-row items-center group-data-[size=xs]/item:gap-2">
            <ItemTitle
              className={cn(
                schedule.status === "archived" && "text-muted-foreground",
              )}
            >
              {schedule.title}
            </ItemTitle>
            <People
              ids={[schedule.ownerId, schedule.agentId].filter(
                (id): id is string => !!id,
              )}
            />
          </ItemContent>
          <ItemActions>
            <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">
              {when ??
                (schedule.status === "active" && schedule.nextAt
                  ? nextRunLabel(schedule.nextAt)
                  : status.label)}
            </span>
          </ItemActions>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ItemMenuItems
          name={schedule.title}
          onOpen={() =>
            navigate({
              to: "/schedules/$scheduleId",
              params: { scheduleId: schedule.id },
            })
          }
          onAsk={() => ask(`About the schedule “${schedule.title}”, `)}
          link={`/schedules/${schedule.id}`}
          onArchive={
            schedule.status === "archived"
              ? undefined
              : () => {
                  schedule.status = "archived";
                }
          }
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

// One schedule, like a task's page: owner (and, for a prompt, its agent)
// under the title; the prompt (or code) read-only; then its activity:
// created and changes as event lines, runs as cards, then the next run (a
// hollow dot). The panel: state (picking one restores an archived
// schedule), repeat (the tasks' presets; Custom asks) and the chat it posts
// to (an existing one, or a new chat each run). What it says changes by
// asking an agent; Run now runs it at once.
export function SchedulePage({ scheduleId }: { scheduleId: string }) {
  const schedule = schedules.find(({ id }) => id === scheduleId);
  if (!schedule) return null;
  return <ScheduleView key={schedule.id} schedule={schedule} />;
}

function ScheduleView({ schedule }: { schedule: Schedule }) {
  const ask = useAskAgent();
  // Mock only: changes write to the schedule in memory; this redraws.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [ownerId, setOwnerId] = useState(schedule.ownerId);
  // A line in its activity, now.
  const log = (actorId: string, body: string) =>
    schedule.activity.push({
      id: crypto.randomUUID(),
      type: "event",
      actorId,
      body,
      createdAt: new Date().toISOString(),
    });
  // A change, and the line it adds to the activity.
  const update = (change: Partial<Schedule>, body: string) => {
    Object.assign(schedule, change);
    log(currentUserId, body);
    redraw();
  };
  const live = schedule.status !== "archived";
  // Repeats like a task, never "doesn't repeat"; its time joins the label.
  const repeats: Record<string, Look> = Object.fromEntries(
    Object.entries({
      ...repeatPresets,
      [schedule.rule]: repeatLook(schedule.rule),
    })
      .filter(([rule]) => rule !== "none")
      .map(([rule, look]) => [
        rule,
        { ...look, label: `${look.label} at ${schedule.time}` },
      ]),
  );
  // Where it posts: a new chat each run, or any chat (channels show their #
  // icon, never a # in the name).
  const chatLooks: Record<string, Look> = {
    new: { label: "A new chat each run", icon: RiAddLine },
    ...Object.fromEntries(
      chats
        .filter(({ archived, parentId }) => !archived && !parentId)
        .map((chat) => [
          chat.id,
          { label: chat.title, icon: () => <ChatIcon chat={chat} /> },
        ]),
    ),
  };
  // A new chat each run is a setting, not a chat made now.
  const postTo = (chatId: string) =>
    update(
      { chatId },
      chatId === "new"
        ? "now posts to a new chat each run"
        : `now posts to ${chats.find(({ id }) => id === chatId)?.title}`,
    );
  const runNow = () => {
    // Mock only: the run lands at once, done.
    schedule.activity.push({
      id: crypto.randomUUID(),
      type: "comment",
      actorId: schedule.agentId ?? currentUserId,
      body: "Ran on request.",
      createdAt: new Date().toISOString(),
      run: "done",
    });
    redraw();
    toast.success(`“${schedule.title}” ran`);
  };

  return (
    <DetailView
      parent={{
        label: "Schedules",
        icon: RiCalendarScheduleLine,
        link: <Link to="/schedules" search={{}} />,
      }}
      current={scheduleStatuses[schedule.status]}
      title={schedule.title}
      archives
      actions={
        live && (
          <IconAction label="Run now" icon={RiPlayLine} onClick={runNow} />
        )
      }
      ask={<FloatingChat about="this schedule" />}
      people={
        <>
          <PersonPicker
            label="Owner"
            value={ownerId}
            options={ownerLooks}
            onChange={setOwnerId}
            hotkey="o"
          />
          {schedule.kind === "prompt" && schedule.agentId && (
            <PersonPicker
              label="Agent"
              value={schedule.agentId}
              options={agentLooks}
              onChange={(agentId) =>
                update(
                  { agentId },
                  `changed the agent to ${actorOf(agentId).name}`,
                )
              }
              hotkey="a"
            />
          )}
        </>
      }
      panel={
        <>
          <Section title="Properties">
            {/* Archive is in the More menu; picking Active or Paused on an
                archived schedule restores it. */}
            <ChoiceItem<Schedule["status"]>
              label="State"
              value={schedule.status}
              options={
                live
                  ? (omit(
                      scheduleStatuses,
                      "archived",
                    ) as typeof scheduleStatuses)
                  : scheduleStatuses
              }
              onChange={(status) =>
                status !== schedule.status &&
                update(
                  { status },
                  !live
                    ? "restored the schedule"
                    : status === "paused"
                      ? "paused the schedule"
                      : "resumed the schedule",
                )
              }
              hotkey="s"
            />
            <ChoiceItem
              label="Repeat"
              value={schedule.rule}
              options={repeats}
              onChange={(rule) =>
                update(
                  { rule },
                  `now repeats ${lowerFirst(repeatLook(rule).label)}`,
                )
              }
              hotkey="r"
              extra={
                <DropdownMenuItem
                  onClick={() => ask(`Run “${schedule.title}” every `)}
                >
                  Custom
                </DropdownMenuItem>
              }
              plain
            />
          </Section>
          <Section title="Chat">
            <ChoiceItem
              label="Chat"
              value={schedule.chatId}
              options={chatLooks}
              onChange={postTo}
              searchable
            />
          </Section>
        </>
      }
    >
      {schedule.kind === "code" ? (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {schedule.body}
        </pre>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {schedule.body}
        </p>
      )}
      <section className="flex flex-col gap-5">
        <h2 className="text-base font-medium">Activity</h2>
        <Timeline>
          {schedule.activity.map((item) =>
            item.run ? (
              <RunCard key={item.id} run={item} />
            ) : (
              <ActivityEvent
                key={item.id}
                actorId={item.actorId}
                body={item.body}
                createdAt={item.createdAt}
              />
            ),
          )}
          {schedule.status === "active" && schedule.nextAt && (
            <TimelineItem dot="next" className="text-sm text-muted-foreground">
              Next run {lowerFirst(nextRunLabel(schedule.nextAt))}
            </TimelineItem>
          )}
        </Timeline>
      </section>
    </DetailView>
  );
}

// A run, as a card like a comment: who ran it (its agent, or the owner for
// code), when, how it went (a red Failed when it failed), and what it
// posted.
function RunCard({ run }: { run: Activity }) {
  const failed = run.run === "failed";
  return (
    <TimelineItem>
      <Card size="sm">
        <CardContent>
          <div className="flex items-center gap-2">
            <ActorAvatar actorId={run.actorId} />
            <span className="font-medium">{actorOf(run.actorId).name}</span>
            <span className="text-muted-foreground tabular-nums">
              {runTime.format(new Date(run.createdAt))}
            </span>
            <span
              className={cn(
                "ml-auto flex items-center gap-1.5 text-xs",
                failed ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {failed ? (
                <RiCloseCircleLine className="size-3.5" />
              ) : (
                <RiCheckboxCircleLine className="size-3.5 text-status-done" />
              )}
              {failed ? "Failed" : "Ran"}
            </span>
          </div>
          <p className="whitespace-pre-line">{run.body}</p>
        </CardContent>
      </Card>
    </TimelineItem>
  );
}

const runTime = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
