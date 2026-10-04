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

// Projects follow a lifecycle like tasks. channel names the project's
// Conversation; cover is an optional image for its card and its page. UI-only for now: the
// backend Project has no status, priority or cover yet.
export type ProjectStatus = "planned" | "active" | "paused" | "completed";

export type Project = {
  title: string;
  description?: string;
  ownerId?: string;
  memberIds?: string[];
  status?: ProjectStatus;
  priority?: TaskPriority;
  channel?: string;
  cover?: string;
};

export const projects: Record<string, Project> = {
  p_web: {
    title: "Otto web",
    description:
      "The Otto web app: tasks, projects, conversations and the composer, on the shared design system.",
    ownerId: "u_johan",
    memberIds: ["u_maya", "a_forge", "a_otto"],
    status: "active",
    priority: "high",
    channel: "otto-web",
    cover:
      "https://images.unsplash.com/photo-1557683316-973673baf926?w=900&auto=format&fit=crop&q=60",
  },
  p_launch: {
    title: "Launch site",
    description: "Marketing site for launch: landing page, pricing and FAQ.",
    ownerId: "u_maya",
    memberIds: ["u_johan", "a_quill", "a_scout"],
    status: "planned",
    priority: "medium",
    channel: "launch",
    cover:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=60",
  },
  p_onboarding: { title: "Onboarding" },
  p_brand: { title: "Brand refresh" },
  p_billing: { title: "Billing" },
  p_mobile: { title: "Mobile app" },
};

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

// Documents: Markdown content written by members and agents, optionally in a
// project. Visibility is "user" (only the creator) or "workspace"; image is an
// optional picture from the document, shown as its cover.
export type DocumentVisibility = "user" | "workspace";

export type Doc = {
  id: string;
  title: string;
  content: string;
  image?: string;
  projectId?: string;
  visibility: DocumentVisibility;
  createdBy: string;
  updatedAt: string;
};

export const documents: Doc[] = [
  {
    id: "d1",
    title: "Design system notes",
    content: `Vanilla shadcn on the vega preset. Shared looks change in packages/ui with an Otto comment; instances only set layout. Visible edges sit 9px in, content 16px.

## Sizes

- Controls are 32px; dense bars use 28px.
- Icons are 14px; avatars are at least 20px.
- Radius steps: 2, 6, 8, 10 and 16px. Inner radius is the outer radius minus the gap.

## Color

Primary is blue-600 in light mode and blue-500 in dark mode. Everything else stays neutral.`,
    projectId: "p_web",
    visibility: "workspace",
    createdBy: "u_johan",
    updatedAt: daysAgo(2),
  },
  {
    id: "d2",
    title: "Composer spec",
    content: `One composer for comments and asks. Enter sends, Shift+Enter breaks the line. @ tags people, agents, tasks and projects; files attach by drop or paste.

## Asking Otto

New items start in the composer: the button prefills "@Otto" and the request, and the cursor lands at the end.

## Attachments

- Drop, paste or pick files.
- Uploads show a spinner until they finish.`,
    projectId: "p_web",
    visibility: "workspace",
    createdBy: "a_otto",
    updatedAt: daysAgo(5),
  },
  {
    id: "d3",
    title: "Launch plan",
    content: `Week one: landing page and pricing. Week two: FAQ from support conversations, then the welcome copy.

## Week one

- [ ] Landing page
- [ ] Pricing page

## Week two

- [ ] FAQ
- [ ] Welcome copy`,
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&auto=format&fit=crop&q=60",
    projectId: "p_launch",
    visibility: "workspace",
    createdBy: "u_maya",
    updatedAt: daysAgo(1),
  },
  {
    id: "d4",
    title: "Hiring notes",
    content: `Private notes on the next hires: one designer who codes, one support lead.`,
    visibility: "user",
    createdBy: "u_johan",
    updatedAt: daysAgo(7),
  },
];

// Resources linked to a task: saved outputs, often from an agent's run (the
// backend model is Artifact). Linking never copies files.
export type ResourceKind = "video" | "audio" | "image" | "document" | "file";

export type TaskResource = {
  id: string;
  title: string;
  kind: ResourceKind;
  /** A picture of it (the image itself, a video frame), for galleries. */
  preview?: string;
  /** The file itself, shown read-only in the viewer. */
  url?: string;
  createdAt: string;
};

export const taskResources: Record<string, TaskResource[]> = {
  t1: [
    {
      id: "a1",
      title: "redirect-loop-repro.mp4",
      kind: "video",
      // CC0 sample clip from MDN.
      url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
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
      kind: "document",
      url: "/mock/pricing-comparison.pdf",
      createdAt: daysAgo(1),
    },
    {
      id: "a4",
      title: "landing-hero.png",
      kind: "image",
      preview:
        "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1600&auto=format&fit=crop&q=70",
      createdAt: daysAgo(1),
    },
  ],
  t5: [
    {
      id: "a5",
      title: "avatar-glyphs.png",
      kind: "image",
      preview:
        "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1600&auto=format&fit=crop&q=70",
      createdAt: daysAgo(3),
    },
  ],
  t10: [
    {
      id: "a9",
      title: "launch-voiceover.mp3",
      kind: "audio",
      // CC0 sample sound from MDN.
      url: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
      createdAt: daysAgo(9),
    },
    {
      id: "a6",
      title: "wordmark-weights.png",
      kind: "image",
      preview:
        "https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=1600&auto=format&fit=crop&q=70",
      createdAt: daysAgo(12),
    },
    {
      id: "a7",
      title: "launch-metrics.png",
      kind: "image",
      preview:
        "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&auto=format&fit=crop&q=70",
      createdAt: daysAgo(10),
    },
    {
      id: "a8",
      title: "brand-notes.md",
      kind: "document",
      url: "/mock/brand-notes.md",
      createdAt: daysAgo(11),
    },
  ],
};

// Every resource with the task it came from, latest first.
export type Resource = TaskResource & { taskId?: string };

export const resources: Resource[] = Object.entries(taskResources)
  .flatMap(([taskId, list]) =>
    list.map((resource) => ({ ...resource, taskId })),
  )
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
