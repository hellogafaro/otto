import type { FileRef } from "@/components/composer";
// Static fixtures for the unwired UI. Field names mirror the server schema
// (packages/tasks, projects, agents) so wiring swaps the source, not the screens.

// "review" is UI-only for now; the backend enum is todo | doing | done.
export type TaskStatus = "todo" | "doing" | "review" | "done";

// UI-only for now: the backend Task has no priority or recurrence.
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
// "none" or an iCalendar rule (RRULE), so any schedule fits: "FREQ=HOURLY;
// INTERVAL=4", "FREQ=MONTHLY;BYDAY=+1MO" (first Monday of every month)…
export type TaskRecurrence = string;

export type Task = {
  id: string;
  projectId: string;
  title: string;
  notes: string;
  ownerId: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  recurrence: TaskRecurrence;
  updatedAt: string;
};

export const currentUserId = "u_johan";

export const users = {
  u_johan: { name: "Johan Gafaro", initials: "JG" },
  u_maya: { name: "Maya Lind", initials: "ML" },
} as const;

export const agents = {
  // Otto orchestrates: asked with @Otto, it hands work to the other agents.
  a_otto: { title: "Otto" },
  a_forge: { title: "Forge" },
  a_scout: { title: "Scout" },
  a_quill: { title: "Quill" },
} as const;

export const projects = {
  p_web: { title: "Otto web" },
  p_launch: { title: "Launch site" },
  p_onboarding: { title: "Onboarding" },
} as const;

const notes: Record<string, string> = {
  t1: "Users on Safari 17 bounce between /login and /callback after the session cookie expires. Reproduce with a stale cookie, then fix the redirect guard.",
  t2: "Compare pricing structure, plan names and free tier limits for five direct competitors. Summarize in a table with links.",
  t4: "Hero headline, subhead and three short benefit blocks. Friendly, plain language; no jargon.",
  t7: "Pull the ten most common questions from last month's support conversations and draft short answers.",
};

const priorities: Record<string, TaskPriority> = {
  t1: "urgent",
  t2: "medium",
  t4: "high",
  t7: "low",
};

const recurrences: Record<string, TaskRecurrence> = {
  t7: "FREQ=MONTHLY;BYDAY=+1MO",
  t8: "FREQ=WEEKLY;BYDAY=MO",
};

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

const task = (
  id: string,
  status: TaskStatus,
  title: string,
  projectId: keyof typeof projects,
  assignee: string | null,
  updated: number,
  ownerId = currentUserId,
): Task => ({
  id,
  projectId,
  title,
  notes: notes[id] ?? "",
  ownerId,
  assigneeUserId: assignee?.startsWith("u_") ? assignee : null,
  assigneeAgentId: assignee?.startsWith("a_") ? assignee : null,
  status,
  priority: priorities[id] ?? "none",
  recurrence: recurrences[id] ?? "none",
  updatedAt: daysAgo(updated),
});

export const tasks: Task[] = [
  task(
    "t1",
    "doing",
    "Fix sign-in redirect loop on Safari",
    "p_web",
    "a_forge",
    0,
  ),
  task(
    "t2",
    "review",
    "Compare pricing pages of five competitors",
    "p_launch",
    "a_scout",
    1,
  ),
  task(
    "t3",
    "doing",
    "Check onboarding drop-off between steps 2 and 3",
    "p_onboarding",
    "u_johan",
    2,
    "u_maya",
  ),
  task(
    "t4",
    "review",
    "Write welcome copy for the landing page",
    "p_launch",
    "a_quill",
    1,
  ),
  task("t5", "todo", "Add agent glyph to avatars", "p_web", "u_johan", 3),
  task(
    "t6",
    "todo",
    "Move settings into the profile menu",
    "p_web",
    "a_forge",
    4,
    "u_maya",
  ),
  task(
    "t7",
    "todo",
    "Draft FAQ from support conversations",
    "p_launch",
    null,
    6,
  ),
  task(
    "t8",
    "todo",
    "Plan onboarding email sequence",
    "p_onboarding",
    "u_maya",
    8,
    "u_maya",
  ),
  task(
    "t9",
    "done",
    "Send workspace invite emails",
    "p_onboarding",
    "a_forge",
    9,
  ),
  task("t10", "done", "Pick the wordmark weight", "p_launch", "u_maya", 12),
  task("t11", "done", "Set up the Otto web repository", "p_web", "u_johan", 15),
];

// Task activity: events (one muted line) and comments (cards). Actors are
// members (u_*) or agents (a_*).
export type Activity = {
  id: string;
  type: "event" | "comment";
  actorId: string;
  body: string;
  files?: FileRef[];
  createdAt: string;
};

export const activity: Record<string, Activity[]> = {
  t1: [
    {
      id: "e1",
      type: "event",
      actorId: "u_johan",
      body: "created the task",
      createdAt: daysAgo(3),
    },
    {
      id: "e2",
      type: "event",
      actorId: "u_johan",
      body: "assigned to Forge",
      createdAt: daysAgo(3),
    },
    {
      id: "c1",
      type: "comment",
      actorId: "a_forge",
      body: "@[Johan Gafaro](user:u_johan) Reproduced on Safari 17.4. The redirect guard checks the session cookie before refreshing it, so an expired cookie loops between /login and /callback. Fixing the order now.",
      createdAt: daysAgo(1),
    },
    {
      id: "e3",
      type: "event",
      actorId: "a_forge",
      body: "moved to In progress",
      createdAt: daysAgo(1),
    },
  ],
};

// Resources linked to a task: saved outputs, often from an agent's run (the
// backend model is Artifact). Linking never copies files.
export type ResourceKind = "video" | "image" | "document" | "file";

export type TaskResource = {
  id: string;
  title: string;
  kind: ResourceKind;
  createdAt: string;
};

export const taskResources: Record<string, TaskResource[]> = {
  t1: [
    {
      id: "a1",
      title: "redirect-loop-repro.mp4",
      kind: "video",
      createdAt: daysAgo(2),
    },
    {
      id: "a2",
      title: "Fix plan",
      kind: "document",
      createdAt: daysAgo(1),
    },
  ],
  t2: [
    {
      id: "a3",
      title: "pricing-comparison.pdf",
      kind: "file",
      createdAt: daysAgo(1),
    },
  ],
};

// Logged time (UI-only for now: the backend has no time entries).
export type TimeEntry = {
  id: string;
  minutes: number;
  actorId: string;
  note: string;
  // The day the work happened (shown as a date, no time); may be in the past.
  // UI-only for now: the backend keeps the logging timestamp only.
  date: string;
  createdAt: string;
};

export const timeEntries: Record<string, TimeEntry[]> = {
  t1: [
    {
      id: "w1",
      minutes: 120,
      actorId: "u_johan",
      note: "Reproduced the loop and traced it to the redirect guard.",
      date: daysAgo(2),
      createdAt: daysAgo(2),
    },
    {
      id: "w2",
      minutes: 45,
      actorId: "u_maya",
      note: "",
      date: daysAgo(1),
      createdAt: daysAgo(1),
    },
  ],
};
