import {
  type RemixiconComponentType,
  RiBox3Line,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiFileLine,
  RiFileTextLine,
  RiImageLine,
  RiLockLine,
  RiLoopRightLine,
  RiMusic2Line,
  RiPauseCircleLine,
  RiProgress4Line,
  RiProgress6Line,
  RiRobot3Line,
  RiTeamLine,
  RiUserLine,
  RiVideoLine,
} from "@remixicon/react";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import type { ComponentType } from "react";
import { RRule } from "rrule";
import {
  agents,
  type DocumentVisibility,
  type ProjectStatus,
  projects,
  type ResourceKind,
  type TaskPriority,
  type TaskRecurrence,
  type TaskStatus,
  users,
} from "@/mock/tasks";

// Shared task display: property looks and order, assignee lookup, short dates.
export type Look = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  className?: string;
};

// Lifecycle order, also the number keys: 1 todo … 4 done.
export const statuses: Record<TaskStatus, Look> = {
  todo: { label: "Todo", icon: RiCircleLine, className: "text-status-todo" },
  doing: {
    label: "In progress",
    icon: RiProgress4Line,
    className: "text-status-doing",
  },
  review: {
    label: "In review",
    icon: RiProgress6Line,
    className: "text-status-review",
  },
  done: {
    label: "Done",
    icon: RiCheckboxCircleFill,
    className: "text-status-done",
  },
};

export const statusOrder = Object.keys(statuses) as TaskStatus[];

// Priority glyphs (16px, currentColor): dashes, 1–3 signal bars, urgent "!".
function NoPriorityIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className={className}
      aria-hidden
    >
      {[2, 6.5, 11].map((x) => (
        <rect
          key={x}
          x={x}
          y={7.25}
          width={3}
          height={1.5}
          rx={0.75}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

function bars(level: number) {
  return function BarsIcon({ className }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        className={className}
        aria-hidden
      >
        {[6, 9, 12].map((height, index) => (
          <rect
            key={height}
            x={2 + index * 4.5}
            y={14 - height}
            width={3}
            height={height}
            rx={1}
            fill="currentColor"
            opacity={index < level ? 1 : 0.3}
          />
        ))}
      </svg>
    );
  };
}

function UrgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className={className}
      aria-hidden
    >
      <rect x={1.5} y={1.5} width={13} height={13} rx={3} fill="currentColor" />
      <rect
        x={7.25}
        y={4}
        width={1.5}
        height={5.5}
        rx={0.75}
        className="fill-background"
      />
      <circle cx={8} cy={11.5} r={0.9} className="fill-background" />
    </svg>
  );
}

// Menu order matches the number keys: 0 none, 1 urgent … 4 low.
export const priorities: Record<TaskPriority, Look> = {
  none: {
    label: "No priority",
    icon: NoPriorityIcon,
    className: "text-muted-foreground",
  },
  urgent: { label: "Urgent", icon: UrgentIcon, className: "text-destructive" },
  high: { label: "High", icon: bars(3) },
  medium: { label: "Medium", icon: bars(2) },
  low: { label: "Low", icon: bars(1) },
};

// Repeat rules are iCalendar RRULEs, so any schedule fits. These presets cover
// the common ones (number keys 0 … 4); Otto writes custom rules from a
// sentence, and any rule reads back in plain words.
export const repeatPresets: Record<TaskRecurrence, Look> = {
  none: {
    label: "Doesn't repeat",
    icon: RiLoopRightLine,
    className: "text-muted-foreground",
  },
  "FREQ=DAILY": { label: "Every day", icon: RiLoopRightLine },
  "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR": {
    label: "Every weekday",
    icon: RiLoopRightLine,
  },
  "FREQ=WEEKLY": { label: "Every week", icon: RiLoopRightLine },
  "FREQ=MONTHLY": { label: "Every month", icon: RiLoopRightLine },
};

// Compact plain words that fit a sidebar row: "Monthly, 1st Monday",
// "Every 4 hours", "Every 2 weeks, Tue, Thu".
export function repeatLook(rule: TaskRecurrence): Look {
  const preset = repeatPresets[rule];
  if (preset) return preset;
  let text = RRule.fromString(rule)
    .toText()
    .replace(/^every (day|week|month|year)\b/, (_, unit: string) =>
      unit === "day" ? "daily" : `${unit}ly`,
    )
    .replace(/ on (the )?/, ", ");
  // Several weekdays read shorter as "Tue, Thu".
  if (text.split(/,|\band\b/).length > 2)
    text = text.replace(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g,
      (day) => day.slice(0, 3),
    );
  return {
    label: text.charAt(0).toUpperCase() + text.slice(1),
    icon: RiLoopRightLine,
  };
}

// Project lifecycle, also the number keys: 1 planned … 4 completed.
export const projectStatuses: Record<ProjectStatus, Look> = {
  planned: {
    label: "Planned",
    icon: RiCircleLine,
    className: "text-status-todo",
  },
  active: {
    label: "In progress",
    icon: RiProgress4Line,
    className: "text-status-doing",
  },
  paused: {
    label: "Paused",
    icon: RiPauseCircleLine,
    className: "text-status-review",
  },
  completed: {
    label: "Completed",
    icon: RiCheckboxCircleFill,
    className: "text-status-done",
  },
};

// Every project, for the project picker.
export const projectLooks: Record<string, Look> = Object.fromEntries(
  Object.entries(projects).map(([id, project]) => [
    id,
    { label: project.title, icon: RiBox3Line },
  ]),
);

// People show their initials; agents always show the robot; "none" (nobody
// assigned) is an empty avatar with a person outline.
export function ActorAvatar({
  actorId,
  size = "sm",
}: {
  actorId: string;
  size?: "sm" | "md" | "default";
}) {
  const actor = actorId === "none" ? null : actorOf(actorId);
  return (
    <Avatar size={size}>
      <AvatarFallback>
        {!actor ? (
          <RiUserLine />
        ) : actor.agent ? (
          <RiRobot3Line />
        ) : (
          actor.initials
        )}
      </AvatarFallback>
    </Avatar>
  );
}

// An avatar as a menu option's icon (lists with avatars use 20px icon slots).
function avatarIcon(actorId: string) {
  return function AvatarIcon() {
    return <ActorAvatar actorId={actorId} />;
  };
}

// Owner picker: people only (every task has a human owner).
export const ownerLooks: Record<string, Look> = Object.fromEntries(
  Object.entries(users).map(([id, user]) => [
    id,
    { label: user.name, icon: avatarIcon(id) },
  ]),
);

// Assignee picker: unassigned, then people, then agents.
export const assigneeLooks: Record<string, Look> = {
  none: { label: "Unassigned", icon: avatarIcon("none") },
  ...ownerLooks,
  ...Object.fromEntries(
    Object.entries(agents).map(([id, agent]) => [
      id,
      { label: agent.title, icon: avatarIcon(id) },
    ]),
  ),
};

// People and agents: a name, initials, and whether it is an agent.
export function actorOf(actorId: string) {
  if (actorId in agents) {
    const { title, color } = agents[actorId as keyof typeof agents];
    return {
      id: actorId,
      name: title,
      initials: title.charAt(0),
      agent: true,
      color,
    };
  }
  const user = users[actorId as keyof typeof users];
  return {
    id: actorId,
    name: user.name,
    initials: user.initials,
    agent: false,
    color: user.color,
  };
}

// Name colors, one per person or agent (assigned, like Slack's), so a chat's
// senders group at a glance. Six hues, each tuned per theme; none is the
// primary blue, so a name never reads as an @tag.
export const nameColors = [
  "text-[oklch(0.55_0.18_25)] dark:text-[oklch(0.74_0.14_25)]", // red
  "text-[oklch(0.58_0.15_60)] dark:text-[oklch(0.78_0.13_65)]", // orange
  "text-[oklch(0.52_0.14_150)] dark:text-[oklch(0.77_0.14_150)]", // green
  "text-[oklch(0.53_0.1_195)] dark:text-[oklch(0.77_0.1_195)]", // teal
  "text-[oklch(0.52_0.18_300)] dark:text-[oklch(0.75_0.14_300)]", // purple
  "text-[oklch(0.56_0.19_350)] dark:text-[oklch(0.75_0.15_350)]", // pink
];

export const shortDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

// Time tracking: whole minutes shown as "2h", "45m" or "1h 30m".
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  return hours ? `${hours}h` : `${rest}m`;
}

// A resource's type: its icon in lists, its name in hover details.
export const resourceIcons: Record<ResourceKind, RemixiconComponentType> = {
  video: RiVideoLine,
  audio: RiMusic2Line,
  image: RiImageLine,
  document: RiFileTextLine,
  file: RiFileLine,
};

// A file's type from its MIME type.
export function resourceKindOf(type: string): ResourceKind {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/") || type === "application/pdf") return "document";
  return "file";
}

export const resourceTypes: Record<ResourceKind, string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  document: "Document",
  file: "File",
};

// Who can see a document: only its creator, or the whole workspace.
export const visibilityLooks: Record<DocumentVisibility, Look> = {
  user: { label: "Only me", icon: RiLockLine },
  workspace: { label: "Workspace", icon: RiTeamLine },
};
