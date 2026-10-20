import { createSignal, MessageList } from "@mastra/core/agent";
import { type MastraDBMessage } from "@mastra/core/agent-controller";
import { type ProcessorActiveStateSignal } from "@mastra/core/processors";
import { ProjectId, type TaskWake, TaskId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  OttoTaskStateProcessor,
  taskNotification,
  taskState,
  type TaskState,
} from "./otto-task-signals.ts";

const TASK = TaskId.make("task-launch");

const task: TaskState = {
  taskId: TASK,
  title: "Draft the launch post",
  status: "backlog",
  project: "Launch",
  due: "2026-10-20",
  owner: "Ada (person:ada)",
  assignees: ["Nova (you, bot:nova)"],
  links: [],
  description: "Cover pricing & the <beta> flag.",
  activity: [
    {
      id: "c-1",
      at: "2026-10-15 10:02",
      by: "Ada",
      mine: false,
      text: "commented (comment c-1): Under 600 words.",
    },
    {
      id: "c-2",
      at: "2026-10-16 09:00",
      by: "Ada",
      mine: false,
      text: "commented (comment c-2): @Nova is this ready?",
    },
  ],
};

const comment = (commentId: string): TaskWake => ({
  type: "commented",
  taskId: TASK,
  by: { key: "person:ada", name: "Ada" },
  commentId,
  reason: "mention",
  text: "@Nova is this ready?",
});

const notification = (wake: TaskWake, value: TaskState | undefined): MastraDBMessage =>
  createSignal(taskNotification(wake, value)).toDBMessage({ threadId: "chat", resourceId: "chat" });

const stateSignal = (value: TaskState, mode: "snapshot" | "delta") =>
  createSignal({
    type: "state",
    tagName: mode === "snapshot" ? "task" : "task-update",
    contents: "",
    metadata: { value, state: { id: "otto-task", threadId: "chat", mode } },
  }) as ProcessorActiveStateSignal;

function compute(input: {
  readonly input: ReadonlyArray<MastraDBMessage>;
  readonly history?: ReadonlyArray<MastraDBMessage>;
  readonly lastSnapshot?: ProcessorActiveStateSignal;
  readonly deltas?: ReadonlyArray<ProcessorActiveStateSignal>;
}) {
  const messageList = new MessageList({ threadId: "chat", resourceId: "chat" });

  for (const message of input.history ?? []) messageList.add(message, "memory");

  for (const message of input.input) messageList.add(message, "input");

  return new OttoTaskStateProcessor().computeStateSignal({
    messages: messageList.get.all.db(),
    messageList,
    abort: () => {
      throw new Error("aborted");
    },
    retryCount: 0,
    stepNumber: 0,
    steps: [],
    state: {},
    resourceId: "chat",
    threadId: "chat",
    activeStateSignals: [],
    contextWindow: { hasSnapshot: input.lastSnapshot !== undefined },
    ...(input.lastSnapshot ? { lastSnapshot: input.lastSnapshot } : {}),
    deltasSinceSnapshot: [...(input.deltas ?? [])],
  });
}

describe("OttoTaskStateProcessor", () => {
  it("leaves ordinary turns without task state", () => {
    expect(compute({ input: [] })).toBeUndefined();
  });

  it("sends a snapshot on the first wake, without the comment that woke the bot", () => {
    const signal = compute({ input: [notification(comment("c-2"), task)] });

    expect(signal).toMatchObject({
      id: "otto-task",
      mode: "snapshot",
      tagName: "task",
      value: task,
    });
    expect(signal?.cacheKey).toMatch(/^task:task-launch:[0-9a-f]{12}$/);
    expect(signal?.contents).toBe(
      [
        "Title: Draft the launch post",
        "Status: backlog",
        "Project: Launch",
        "Due: 2026-10-20",
        "Owner: Ada (person:ada)",
        "Assignees: Nova (you, bot:nova)",
        "Links: none",
        "Description:\nCover pricing & the <beta> flag.",
        "Activity:\n- 2026-10-15 10:02 Ada commented (comment c-1): Under 600 words.",
      ].join("\n"),
    );
  });

  it("sends only what changed once a snapshot is in the conversation", () => {
    const next: TaskState = {
      ...task,
      status: "in_progress",
      activity: [
        ...task.activity,
        {
          id: "c-3",
          at: "2026-10-16 09:10",
          by: "Nova",
          mine: true,
          text: "commented (comment c-3): Yes.",
        },
        {
          id: "c-4",
          at: "2026-10-16 09:40",
          by: "Juno",
          mine: false,
          text: "commented (comment c-4): Image is in the Library.",
        },
        {
          id: "c-5",
          at: "2026-10-16 09:41",
          by: "Ada",
          mine: false,
          text: "commented (comment c-5): And now?",
        },
      ],
    };

    const signal = compute({
      history: [notification(comment("c-2"), task)],
      input: [notification(comment("c-5"), next)],
      lastSnapshot: stateSignal(task, "snapshot"),
    });

    expect(signal).toMatchObject({ mode: "delta", tagName: "task-update", value: next });
    expect(signal?.contents).toBe(
      [
        "Status: backlog → in_progress",
        "New activity:\n- 2026-10-16 09:40 Juno commented (comment c-4): Image is in the Library.",
      ].join("\n"),
    );
  });

  it("sends nothing when the task has not changed", () => {
    expect(
      compute({
        input: [notification(comment("c-2"), task)],
        lastSnapshot: stateSignal(task, "snapshot"),
      }),
    ).toBeUndefined();
  });

  it("starts over with a snapshot after ten deltas", () => {
    const deltas = Array.from({ length: 10 }, () => stateSignal(task, "delta"));

    expect(
      compute({
        input: [notification(comment("c-2"), { ...task, status: "pending" })],
        lastSnapshot: stateSignal(task, "snapshot"),
        deltas,
      }),
    ).toMatchObject({ mode: "snapshot" });
  });
});

describe("taskNotification", () => {
  it("names who acted and where, the way the model reads it", () => {
    expect(createSignal(taskNotification(comment("c-2"), undefined)).toLLMMessage().content).toBe(
      '<comment author="Ada" author_id="person:ada" comment_id="c-2" reason="mention" task_id="task-launch">@Nova is this ready?</comment>',
    );

    expect(
      createSignal(
        taskNotification(
          {
            type: "assigned",
            taskId: TASK,
            by: { key: "bot:juno", name: "Juno" },
            text: "Juno assigned Nova to this task.",
          },
          undefined,
        ),
      ).toLLMMessage().content,
    ).toBe(
      '<assignment assigned_by="Juno" assigned_by_id="bot:juno" task_id="task-launch">Juno assigned Nova to this task.</assignment>',
    );
  });
});

describe("taskState", () => {
  it("bounds the task, reads comments as plain text and dates them in the chat's timezone", () => {
    const state = taskState(
      {
        taskId: TASK,
        title: "Launch",
        status: "backlog",
        project: null,
        projectId: ProjectId.make("project-launch"),
        priority: null,
        owner: null,
        assignees: [{ key: "bot:nova", name: "Nova", you: true }],
        dueDate: null,
        repeat: null,
        completedAt: null,
        completedBy: null,
        updatedAt: "2026-10-16T09:00:00.000Z",
        description: "x".repeat(5_000),
        resources: [{ type: "url", title: "Brief", url: "https://example.test/brief" }],
        createdAt: "2026-10-15T09:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        commentCount: 12,
        comments: Array.from({ length: 12 }, (_, index) => ({
          id: `c-${11 - index}`,
          type: "comment" as const,
          by:
            index === 0
              ? { key: "bot:nova", name: "Nova" }
              : { key: "person:user-ada", name: "Ada" },
          at: "2026-10-16T09:00:00.000Z",
          content: 'Ask <mention type="bot" id="bot:nova">Nova</mention> &amp; me',
          fileIds: [],
        })),
        totalMinutes: 0,
        timeEntries: [],
        history: [],
      },
      "Nova",
      "Europe/Madrid",
    );

    expect(state.description).toHaveLength(4_000 + "… (truncated, task_read has the rest)".length);
    expect(state.assignees).toEqual(["Nova (you, bot:nova)"]);
    expect(state.links).toEqual(["Brief https://example.test/brief"]);
    expect(state.activity).toHaveLength(10);
    expect(state.activity.at(-1)).toMatchObject({
      at: "2026-10-16 11:00",
      mine: true,
      text: "commented (comment c-11): Ask @Nova & me",
    });
  });
});
