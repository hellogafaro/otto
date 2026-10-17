import * as NodeCrypto from "node:crypto";

import { type AgentSignalInput, signalToXmlMarkup } from "@mastra/core/agent";
import { type MastraDBMessage } from "@mastra/core/agent-controller";
import {
  type ComputeStateSignalArgs,
  type Processor,
  type ProcessorStateSignal,
} from "@mastra/core/processors";
import { type BotId, type TaskWake, type ThreadId } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { activeTaskTools, type TaskToolRuntimeShape } from "../../tasks/task-tool-runtime.ts";
import { commentText } from "../../tasks/task-work-reactor.ts";
import { chatTimeZone } from "../otto-agent-instructions.ts";

const DESCRIPTION_LIMIT = 4_000;

const ACTIVITY_LIMIT = 10;

const COMMENT_LIMIT = 500;

/** After this many deltas the next change is sent as a fresh snapshot. */
const DELTA_LIMIT = 10;

const TRUNCATED = "… (truncated, task_read has the rest)";

/** What a bot is shown of the task that woke it: bounded, plain text, ready to render. */
const TaskState = Schema.Struct({
  taskId: Schema.String,
  title: Schema.String,
  status: Schema.String,
  project: Schema.NullOr(Schema.String),
  due: Schema.NullOr(Schema.String),
  owner: Schema.NullOr(Schema.String),
  assignees: Schema.Array(Schema.String),
  links: Schema.Array(Schema.String),
  description: Schema.String,
  activity: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      /** Local time in the chat's timezone, as YYYY-MM-DD HH:mm. */
      at: Schema.String,
      by: Schema.String,
      /** The bot's own comment or change, which it already knows. */
      mine: Schema.Boolean,
      text: Schema.String,
    }),
  ),
});

export type TaskState = typeof TaskState.Type;

type TaskRead = Exclude<
  Effect.Success<ReturnType<TaskToolRuntimeShape["read"]>>,
  { readonly error: string }
>;

const capped = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}${TRUNCATED}` : text;

const person = (participant: {
  readonly key: string;
  readonly name: string;
  readonly you?: boolean;
}) => `${participant.name} (${participant.you ? "you, " : ""}${participant.key})`;

/** An instant as YYYY-MM-DD HH:mm in the given timezone, or in UTC when it is unknown. */
const localTime = (iso: string, timeZone: string) => {
  const instant = DateTime.makeUnsafe(iso);

  const zoned = Option.getOrElse(DateTime.makeZoned(instant, { timeZone }), () =>
    DateTime.toUtc(instant),
  );

  return DateTime.formatIsoOffset(zoned).slice(0, 16).replace("T", " ");
};

export function taskState(
  read: TaskRead,
  botName: string | undefined,
  timeZone: string,
): TaskState {
  return {
    taskId: read.taskId,
    title: read.title,
    status: read.status,
    project: read.project,
    due: read.dueDate,
    owner: read.owner ? person(read.owner) : null,
    assignees: read.assignees.map(person),
    links: read.resources.map((resource) =>
      resource.type === "link"
        ? `${resource.title} ${resource.url}`
        : `${resource.type} ${resource.id}`,
    ),
    description: capped(read.description, DESCRIPTION_LIMIT),
    activity: read.activity.slice(-ACTIVITY_LIMIT).map((entry) => ({
      id: entry.id,
      at: localTime(entry.at, timeZone),
      by: entry.by ?? "Someone",
      mine: botName !== undefined && entry.by === botName,
      text:
        "content" in entry
          ? `commented (comment ${entry.id}): ${capped(commentText(entry.content), COMMENT_LIMIT)}`
          : "changed" in entry
            ? `changed ${entry.changed.join(", ")}`
            : "minutes" in entry
              ? `logged ${entry.minutes} min`
              : entry.type,
    })),
  };
}

/** The task event as a notification signal, carrying the task's state for the state signal. */
export function taskNotification(wake: TaskWake, task: TaskState | undefined): AgentSignalInput {
  const commented = wake.type === "commented";

  return {
    type: "notification",
    tagName: commented ? "comment" : "assignment",
    author: { id: wake.by.key, name: wake.by.name },
    attributes: commented
      ? {
          author: wake.by.name,
          author_id: wake.by.key,
          comment_id: wake.commentId,
          reason: wake.reason,
          reply_to: wake.replyTo,
          task_id: wake.taskId,
        }
      : { assigned_by: wake.by.name, assigned_by_id: wake.by.key, task_id: wake.taskId },
    contents: wake.text ?? "",
    ...(task ? { metadata: { task } } : {}),
  };
}

/** The task event as the tag a model reads, for providers without signals. */
export function taskWakeText(wake: TaskWake): string {
  return signalToXmlMarkup({ ...taskNotification(wake, undefined), contents: wake.text ?? "" });
}

/** Reads the task as the waking bot sees it and wraps the event around it. */
export const taskWakeSignal = (
  wake: TaskWake,
  threadId: ThreadId,
  bot: {
    readonly botId?: BotId | undefined;
    readonly botName?: string | undefined;
    readonly timezone?: string | undefined;
  },
) =>
  Effect.gen(function* () {
    const tasks = activeTaskTools();
    const { botId } = bot;

    const read =
      tasks && botId ? yield* tasks.read({ threadId, botId }, { taskId: wake.taskId }) : undefined;

    return taskNotification(
      wake,
      read && !("error" in read)
        ? taskState(read, bot.botName, chatTimeZone(bot.timezone))
        : undefined,
    );
  });

const decodeTaskState = Schema.decodeUnknownOption(TaskState);

const decodeSignal = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.String,
    attributes: Schema.optionalKey(
      Schema.Struct({ comment_id: Schema.optionalKey(Schema.String) }),
    ),
    metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

function notificationOf(message: MastraDBMessage) {
  if (message.role !== "signal") return undefined;
  const signal = Option.getOrUndefined(decodeSignal(message.content.metadata?.["signal"]));

  return signal?.type === "notification" ? signal : undefined;
}

const line = (entry: TaskState["activity"][number]) => `- ${entry.at} ${entry.by} ${entry.text}`;

const fields = (task: TaskState): ReadonlyArray<readonly [string, string]> => [
  ["Title", task.title],
  ["Status", task.status],
  ["Project", task.project ?? "none"],
  ["Due", task.due ?? "none"],
  ["Owner", task.owner ?? "none"],
  ["Assignees", task.assignees.join(", ") || "none"],
  ["Links", task.links.join(", ") || "none"],
];

function snapshot(task: TaskState, seen: ReadonlySet<string>): string {
  const activity = task.activity.filter((entry) => !seen.has(entry.id));

  return [
    ...fields(task).map(([name, value]) => `${name}: ${value}`),
    task.description ? `Description:\n${task.description}` : "",
    activity.length > 0 ? ["Activity:", ...activity.map(line)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function delta(before: TaskState, task: TaskState, seen: ReadonlySet<string>): string {
  const previous = new Map(fields(before));
  const known = new Set(before.activity.map((entry) => entry.id));

  const activity = task.activity.filter(
    (entry) => !known.has(entry.id) && !seen.has(entry.id) && !entry.mine,
  );

  return [
    ...fields(task).flatMap(([name, value]) =>
      previous.get(name) === value ? [] : [`${name}: ${previous.get(name)} → ${value}`],
    ),
    before.description === task.description ? "" : `Description:\n${task.description}`,
    activity.length > 0 ? ["New activity:", ...activity.map(line)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Otto: shows a woken bot the task it was woken for, as a state signal: a `<task>` snapshot the
 * first time and `<task-update>` deltas after, so the cached history stays valid. Only a run
 * started or joined by a task event gets one; ordinary turns never do.
 */
export class OttoTaskStateProcessor implements Processor<"otto-task-state"> {
  readonly id = "otto-task-state" as const;
  readonly name = "Otto Task State";
  readonly stateId = "otto-task";

  computeStateSignal(args: ComputeStateSignalArgs): ProcessorStateSignal | undefined {
    const wake = args.messageList.get.input
      .db()
      .flatMap((message) => notificationOf(message)?.metadata?.["task"] ?? [])
      .at(-1);

    const task = Option.getOrUndefined(decodeTaskState(wake));

    if (!task) return undefined;

    // Comments delivered as notifications are already in the conversation.
    const seen = new Set(
      args.messageList.get.all
        .db()
        .flatMap((message) => notificationOf(message)?.attributes?.comment_id ?? []),
    );

    const latest = args.deltasSinceSnapshot.at(-1) ?? args.lastSnapshot;
    const before = Option.getOrUndefined(decodeTaskState(latest?.metadata?.["value"]));

    const hash = NodeCrypto.createHash("sha1").update(JSON.stringify(task)).digest("hex");
    const signal = { id: this.stateId, cacheKey: `task:${task.taskId}:${hash.slice(0, 12)}` };

    if (
      args.contextWindow.hasSnapshot &&
      before?.taskId === task.taskId &&
      args.deltasSinceSnapshot.length < DELTA_LIMIT
    ) {
      const contents = delta(before, task, seen);

      return contents
        ? {
            ...signal,
            mode: "delta",
            tagName: "task-update",
            attributes: { id: task.taskId },
            contents,
            value: task,
          }
        : undefined;
    }

    return {
      ...signal,
      mode: "snapshot",
      tagName: "task",
      attributes: { id: task.taskId },
      contents: snapshot(task, seen),
      value: task,
    };
  }
}
