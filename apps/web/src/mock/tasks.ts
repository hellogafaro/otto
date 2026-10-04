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

// color: an index into the name colors, assigned once like Slack's.
export const users = {
  u_johan: { name: "Johan Gafaro", initials: "JG", color: 3 },
  u_maya: { name: "Maya Lind", initials: "ML", color: 5 },
} as const;

export const agents = {
  // Otto orchestrates: asked with @Otto, it hands work to the other agents.
  a_otto: { title: "Otto", color: 4 },
  a_forge: { title: "Forge", color: 1 },
  a_scout: { title: "Scout", color: 2 },
  a_quill: { title: "Quill", color: 0 },
} as const;

// Projects follow a lifecycle like tasks; a project's chat is the chat with
// its projectId. cover is an optional image for its card and its page.
// UI-only for now: the backend Project has no status, priority or cover yet.
export type ProjectStatus = "planned" | "active" | "paused" | "completed";

export type Project = {
  title: string;
  description?: string;
  ownerId?: string;
  memberIds?: string[];
  status?: ProjectStatus;
  priority?: TaskPriority;
  cover?: string;
};

export const projects: Record<string, Project> = {
  p_web: {
    title: "Otto web",
    description:
      "The Otto web app: tasks, projects, chats and the composer, on the shared design system.",
    ownerId: "u_johan",
    memberIds: ["u_maya", "a_forge", "a_otto"],
    status: "active",
    priority: "high",
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

// Chats: a project's chat (shared with its people and agents) or a direct chat
// with a person or an agent. UI-only for now; the backend model is
// Conversation, being renamed to Chat.
export type ChatQuestion = {
  name: string;
  prompt: string;
  description?: string;
  choices: { value: string; label: string }[];
};

// The work an agent did before replying: how long it ran and its steps.
export type ChatRun = {
  seconds: number;
  steps: string[];
  failed?: boolean;
};

export type ChatMessage = {
  id: string;
  actorId: string;
  body: string;
  files?: FileRef[];
  run?: ChatRun;
  /** An agent asking the chat to pick (answered as a reply). */
  question?: ChatQuestion;
  /** An agent still working on this; shown as live status. */
  working?: boolean;
  createdAt: string;
};

export type Chat = {
  id: string;
  title: string;
  type: "project" | "direct";
  projectId?: string;
  /** The person or agent on the other side of a direct chat. */
  withId?: string;
  /** People and agents in the chat; agents always need membership. */
  memberIds: string[];
  messages: ChatMessage[];
};

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

export const chats: Chat[] = [
  {
    id: "c_launch",
    title: "launch",
    type: "project",
    projectId: "p_launch",
    memberIds: ["u_maya", "u_johan", "a_otto", "a_scout", "a_quill"],
    messages: [
      // Six days ago: kickoff, task setup, pricing research.
      {
        id: "k1",
        actorId: "u_maya",
        body: "Kicking off the launch site chat. Goal: landing page, pricing and FAQ live by the end of the month.",
        createdAt: minutesAgo(8760),
      },
      {
        id: "k2",
        actorId: "u_maya",
        body: "@[Otto](agent:a_otto) can you set up the tasks?",
        createdAt: minutesAgo(8759),
      },
      {
        id: "k3",
        actorId: "a_otto",
        body: "Done. I created four tasks:\n- @[Write welcome copy for the landing page](task:t4)\n- @[Compare pricing pages of five competitors](task:t2)\n- @[Draft FAQ from support conversations](task:t7)\n- @[Plan onboarding email sequence](task:t8)\nQuill has the copy, Scout the pricing research.",
        run: {
          seconds: 21,
          steps: [
            "Read the Launch site brief",
            "Created 4 tasks",
            "Assigned Quill and Scout",
          ],
        },
        createdAt: minutesAgo(8757),
      },
      {
        id: "k4",
        actorId: "u_johan",
        body: "Nice. I'll own the pricing one.",
        createdAt: minutesAgo(8700),
      },
      {
        id: "k5",
        actorId: "u_johan",
        body: "Brand notes for reference.",
        files: [
          {
            id: "f_brand",
            name: "brand-notes.md",
            type: "text/markdown",
            size: 4_200,
            url: "/mock/brand-notes.md",
          },
        ],
        createdAt: minutesAgo(8699),
      },
      {
        id: "k6",
        actorId: "a_scout",
        body: "First pass on competitor pricing is in. Three of the five use a free tier capped by seats; two cap by usage instead.\n\nThe clearest page has three plans, one comparison table and the annual toggle on top. The weakest hides its prices behind a contact form.\n\nFull table attached.",
        run: {
          seconds: 192,
          steps: [
            "Found the five pricing pages",
            "Read plans, limits and prices",
            "Built the comparison table",
          ],
        },
        files: [
          {
            id: "f_table",
            name: "competitor-pricing.pdf",
            type: "application/pdf",
            size: 860_000,
            url: "/mock/pricing-comparison.pdf",
          },
        ],
        createdAt: minutesAgo(8620),
      },
      {
        id: "k7",
        actorId: "u_maya",
        body: "This is great. Can we see it as a chart?",
        createdAt: minutesAgo(8600),
      },
      {
        id: "k8",
        actorId: "a_scout",
        body: "I couldn't draw the chart: two plans have no public price. I'll leave those out and try again.",
        run: {
          seconds: 41,
          steps: ["Read the comparison table", "Drew the chart"],
          failed: true,
        },
        createdAt: minutesAgo(8598),
      },
      {
        id: "k9",
        actorId: "a_scout",
        body: "Here it is without the two hidden plans.",
        run: { seconds: 18, steps: ["Drew the chart"] },
        files: [
          {
            id: "f_chart",
            name: "pricing-chart.png",
            type: "image/png",
            size: 96_000,
            url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=900&auto=format&fit=crop&q=60",
          },
        ],
        createdAt: minutesAgo(8590),
      },
      // Three days ago: copy review, a burst of short replies, a voiceover.
      {
        id: "k10",
        actorId: "a_quill",
        body: 'Draft welcome copy is ready for review in @[Write welcome copy for the landing page](task:t4). Headline: "Your team, plus agents that get work done."',
        run: {
          seconds: 65,
          steps: [
            "Read the brand notes",
            "Wrote three headline options",
            "Picked the strongest",
          ],
        },
        createdAt: minutesAgo(4500),
      },
      {
        id: "k11",
        actorId: "u_maya",
        body: "Love the headline",
        createdAt: minutesAgo(4470),
      },
      {
        id: "k12",
        actorId: "u_maya",
        body: "Maybe a shorter subhead?",
        createdAt: minutesAgo(4469),
      },
      {
        id: "k13",
        actorId: "u_maya",
        body: "Also the hero image feels too dark",
        files: [
          {
            id: "f_hero",
            name: "landing-hero.png",
            type: "image/png",
            size: 412_000,
            url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=60",
          },
        ],
        createdAt: minutesAgo(4468),
      },
      {
        id: "k14",
        actorId: "u_johan",
        body: "Agree on the subhead. For the hero, what if we use a product screenshot instead of a photo? It shows what Otto actually does, and we can crop it to the composer so it still reads at small sizes. I can grab a clean one once the chat view settles.",
        createdAt: minutesAgo(4440),
      },
      {
        id: "k15",
        actorId: "a_quill",
        body: "Shorter subhead options:\n1. Plan, delegate and ship in one place.\n2. Tasks, chats and agents, together.\n3. Work with agents like teammates.",
        createdAt: minutesAgo(4436),
      },
      {
        id: "k16",
        actorId: "u_maya",
        body: "2 for me",
        createdAt: minutesAgo(4420),
      },
      {
        id: "k17",
        actorId: "u_johan",
        body: "Same, 2.",
        createdAt: minutesAgo(4415),
      },
      {
        id: "k18",
        actorId: "a_quill",
        body: "I recorded a first take of the launch voiceover: 42 seconds, friendly tone.",
        run: {
          seconds: 130,
          steps: ["Wrote the script", "Recorded the voiceover"],
        },
        files: [
          {
            id: "f_voice",
            name: "launch-voiceover.mp3",
            type: "audio/mpeg",
            size: 680_000,
            url: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
          },
        ],
        createdAt: minutesAgo(4300),
      },
      {
        id: "m1",
        actorId: "u_maya",
        body: "Can someone draft the FAQ from last month's support conversations? Here's the export and the dashboard.",
        files: [
          {
            id: "f_support",
            name: "support-dashboard.png",
            type: "image/png",
            size: 248_000,
            url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&auto=format&fit=crop&q=60",
          },
          {
            id: "f_pricing",
            name: "pricing-comparison.pdf",
            type: "application/pdf",
            size: 1_240_000,
            url: "/mock/pricing-comparison.pdf",
          },
        ],
        createdAt: minutesAgo(26 * 60),
      },
      {
        id: "m2",
        actorId: "a_otto",
        body: "On it. Scout is pulling the ten most common questions and Quill will draft short answers. I'll post the draft here.",
        run: {
          seconds: 14,
          steps: [
            "Read the support export",
            "Found 214 conversations from last month",
            "Asked Scout and Quill to help",
          ],
        },
        createdAt: minutesAgo(26 * 60 - 4),
      },
      {
        id: "k19",
        actorId: "a_scout",
        body: "Pulled 214 conversations. The top three themes: billing changes, inviting teammates, and what agents can access.",
        run: {
          seconds: 400,
          steps: [
            "Read 214 support conversations",
            "Grouped them by question",
            "Ranked the ten most common",
          ],
        },
        createdAt: minutesAgo(1500),
      },
      {
        id: "k20",
        actorId: "u_maya",
        body: "@[Johan Gafaro](user:u_johan) can you sanity check the access answer? That one's sensitive.",
        createdAt: minutesAgo(1440),
      },
      {
        id: "k21",
        actorId: "u_johan",
        body: "Yes, I'll review it in @[Draft FAQ from support conversations](task:t7) before it goes out.",
        createdAt: minutesAgo(1380),
      },
      {
        id: "k22",
        actorId: "u_johan",
        body: "Screen recording of the new composer, for the hero.",
        files: [
          {
            id: "f_loop",
            name: "composer-demo.mp4",
            type: "video/mp4",
            size: 3_400_000,
            url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          },
        ],
        createdAt: minutesAgo(1379),
      },
      {
        id: "m3",
        actorId: "u_johan",
        body: "Keep each answer under 60 words, please.",
        createdAt: minutesAgo(150),
      },
      {
        id: "m3b",
        actorId: "u_johan",
        body: "And link the pricing page where it helps.",
        createdAt: minutesAgo(149),
      },
      {
        id: "m3c",
        actorId: "a_otto",
        body: "Got it: under 60 words, with pricing links where they help.",
        run: { seconds: 9, steps: ["Updated the FAQ task brief"] },
        question: {
          name: "tone",
          prompt: "Which tone should the answers use?",
          description: "Quill will match it across the whole FAQ.",
          choices: [
            { value: "friendly", label: "Friendly" },
            { value: "concise", label: "Concise" },
            { value: "formal", label: "Formal" },
          ],
        },
        createdAt: minutesAgo(148),
      },
      {
        id: "m3d",
        actorId: "a_quill",
        body: "Drafting answers for the ten questions",
        working: true,
        createdAt: minutesAgo(5),
      },
    ],
  },
  {
    id: "c_web",
    title: "otto-web",
    type: "project",
    projectId: "p_web",
    memberIds: ["u_johan", "u_maya", "a_forge", "a_otto"],
    messages: [
      {
        id: "m4",
        actorId: "a_forge",
        body: "The preview deploy failed: the build ran out of memory. I'll retry on a larger machine.",
        run: {
          seconds: 161,
          steps: ["Built the web app", "Deployed the preview"],
          failed: true,
        },
        createdAt: minutesAgo(26 * 60),
      },
      {
        id: "m4b",
        actorId: "a_forge",
        body: "The Safari redirect loop fix is ready for review: the guard now refreshes the session cookie before checking it.",
        run: {
          seconds: 52,
          steps: [
            "Reproduced the loop on Safari 17.4",
            "Fixed the redirect guard",
            "Ran 38 tests",
          ],
        },
        files: [
          {
            id: "f_safari",
            name: "safari-login.png",
            type: "image/png",
            size: 182_000,
            url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=60",
          },
        ],
        createdAt: minutesAgo(90),
      },
      {
        id: "m5",
        actorId: "u_johan",
        body: "Nice, I'll look after lunch.",
        createdAt: minutesAgo(60),
      },
    ],
  },
  {
    id: "c_otto",
    title: "Otto",
    type: "direct",
    withId: "a_otto",
    memberIds: ["u_johan", "a_otto"],
    messages: [
      {
        id: "m6",
        actorId: "u_johan",
        body: "What's left for the launch site?",
        createdAt: minutesAgo(40),
      },
      {
        id: "m7",
        actorId: "a_otto",
        body: "Four tasks are open: the FAQ draft, the pricing comparison (in review), the welcome copy (in review) and the onboarding email sequence.",
        createdAt: minutesAgo(39),
      },
    ],
  },
  {
    id: "c_maya",
    title: "Maya Lind",
    type: "direct",
    withId: "u_maya",
    memberIds: ["u_johan", "u_maya"],
    messages: [
      {
        id: "m8",
        actorId: "u_maya",
        body: "Do we need a dark-mode wordmark?",
        createdAt: minutesAgo(300),
      },
    ],
  },
];
