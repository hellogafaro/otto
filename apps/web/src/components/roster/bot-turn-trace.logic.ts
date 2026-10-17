import type { MessageKey } from "@otto/client-runtime/i18n";
import type { OrchestrationMessage, OrchestrationThreadActivity } from "@otto/contracts";
import { Option, Predicate, Schema } from "effect";

import { recordLookup } from "../record-lookup";
import {
  type BotActivitySubject,
  botToolActivity,
  TASK_LIST_TOOLS,
  toolCallId,
  toolName,
} from "./bot-activity-status.logic";

/** What a finished step reads as, keyed by its live label. */
const DONE_LABELS = {
  "Adding a connection": "Added a connection",
  "Adding a routine": "Added a routine",
  "Browsing the library": "Browsed the library",
  "Checking connections": "Checked connections",
  "Checking on a helper": "Checked on a helper",
  "Checking routines": "Checked routines",
  "Checking skills": "Checked skills",
  "Editing a document": "Edited a document",
  "Editing files": "Edited files",
  "Installing a plugin": "Installed a plugin",
  "Looking at a plugin": "Looked at a plugin",
  "Looking at an image": "Looked at an image",
  "Looking for the right app": "Looked for the right app",
  "Making an image": "Made an image",
  "Messaging a helper": "Messaged a helper",
  Reacting: "Reacted",
  "Reading a skill": "Read a skill",
  "Reading a web page": "Read a web page",
  "Reading files": "Read files",
  "Reading memory": "Read memory",
  "Reading the library": "Read the library",
  Reconnecting: "Reconnected",
  "Removing a connection": "Removed a connection",
  "Removing a plugin": "Removed a plugin",
  "Removing routines": "Removed routines",
  "Restarting connections": "Restarted connections",
  "Running a command": "Ran a command",
  "Saving to memory": "Saved to memory",
  "Saving to the library": "Saved to the library",
  "Searching plugins": "Searched plugins",
  "Searching the web": "Searched the web",
  "Sending a message": "Sent a message",
  "Setting up a channel": "Set up a channel",
  "Signing in to a connection": "Signed in to a connection",
  "Starting a helper": "Started a helper",
  "Stopping a helper": "Stopped a helper",
  "Testing a connection": "Tested a connection",
  "Updating a channel": "Updated a channel",
  "Updating a routine": "Updated a routine",
  "Updating profile": "Updated profile",
  "Using a tool": "Used a tool",
  "Using an app": "Used an app",
  "Using the browser": "Used the browser",
  "Using the computer": "Used the computer",
  "Waiting for your answer": "Asked you a question",
} satisfies Readonly<Record<string, MessageKey>>;

/** A gap between steps shorter than this is just the hand-off, not thinking. */
const THOUGHT_MIN_MS = 1_500;

export type BotTraceStep =
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly label: MessageKey;
      /** Names the app or MCP server, shown as "Used {name}" once the view knows it. */
      readonly subject: BotActivitySubject | null;
      /** What the step worked on: a search query, a web address, a command or a file. */
      readonly detail: string | null;
      readonly durationMs: number | null;
      readonly failed: boolean;
      /** A command and the start of its output, shown as a small terminal block. */
      readonly terminal: string | null;
    }
  | { readonly kind: "thought"; readonly id: string; readonly durationMs: number };

export interface BotTurnTrace {
  readonly workedMs: number;
  readonly steps: ReadonlyArray<BotTraceStep>;
}

const decodeToolPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    status: Schema.optionalKey(Schema.Unknown),
    data: Schema.optionalKey(
      Schema.Struct({
        detail: Schema.optionalKey(Schema.Unknown),
        command: Schema.optionalKey(Schema.Unknown),
        output: Schema.optionalKey(Schema.Unknown),
      }),
    ),
  }),
);

/** The server's client projection of a tool call: what it worked on and how it ended. */
function toolPayload(activity: OrchestrationThreadActivity | undefined) {
  return activity ? Option.getOrNull(decodeToolPayload(activity.payload)) : null;
}

/** A web address reads as its site and path, without the scheme or query. */
function readableDetail(detail: string) {
  if (!/^https?:\/\//.test(detail)) return detail;

  try {
    const url = new URL(detail);

    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return detail;
  }
}

/**
 * What each finished bot turn did, keyed by turn: its tool calls in order with what they worked
 * on, the thinking between them, and how long the whole turn took (from the message that opened
 * it to the reply). A message sent while the bot worked joins its turn, so the turn opens with
 * the last message before its first tool call. Turns that only thought and answered have no trace.
 */
export function buildBotTurnTraces(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyMap<string, BotTurnTrace> {
  const byTurn = new Map<string, OrchestrationThreadActivity[]>();

  for (const activity of activities) {
    if (
      !activity.turnId ||
      (activity.kind !== "tool.started" && activity.kind !== "tool.completed")
    ) {
      continue;
    }

    const turn = byTurn.get(activity.turnId);

    if (turn) turn.push(activity);
    else byTurn.set(activity.turnId, [activity]);
  }

  const traces = new Map<string, BotTurnTrace>();

  messages.forEach((message, index) => {
    const turnActivities = message.turnId ? byTurn.get(message.turnId) : undefined;
    const previous = messages[index - 1];

    if (message.role !== "assistant" || !message.turnId || !turnActivities || !previous) return;

    const completedById = new Map(
      turnActivities
        .filter((activity) => activity.kind === "tool.completed")
        .map((activity) => [toolCallId(activity), activity]),
    );

    const started = turnActivities.filter(
      (activity) => activity.kind === "tool.started" && !TASK_LIST_TOOLS.has(toolName(activity)),
    );

    const first = started[0];

    if (!first) return;
    const firstAt = Date.parse(first.createdAt);

    const opener =
      messages
        .slice(0, index)
        .findLast(
          (candidate) =>
            candidate.turnId !== message.turnId && Date.parse(candidate.createdAt) <= firstAt,
        ) ?? previous;

    const startAt = Date.parse(opener.createdAt);
    const endAt = Date.parse(message.createdAt);
    const steps: BotTraceStep[] = [];
    let cursor = startAt;

    const thought = (until: number, id: string) => {
      if (until - cursor >= THOUGHT_MIN_MS) {
        steps.push({ kind: "thought", id: `thought:${id}`, durationMs: until - cursor });
      }
    };

    for (const activity of started) {
      const id = toolCallId(activity);
      const completed = completedById.get(id);
      const at = Date.parse(activity.createdAt);
      const doneAt = completed ? Date.parse(completed.createdAt) : null;
      const live = botToolActivity(activity);
      const call = toolPayload(activity)?.data;
      const done = toolPayload(completed);
      const command = Predicate.isString(call?.command) ? call.command : null;
      const detail = Predicate.isString(call?.detail) ? call.detail : command;
      const output = Predicate.isString(done?.data?.output) ? done.data.output : null;

      thought(at, id);
      steps.push({
        kind: "tool",
        id,
        label: recordLookup(DONE_LABELS, live.label) ?? "Used a tool",
        subject: live.subject ?? null,
        detail: detail ? readableDetail(detail) : null,
        durationMs: doneAt === null ? null : doneAt - at,
        failed: done?.status === "failed",
        terminal: command ? [`$ ${command}`, output].filter(Boolean).join("\n") : null,
      });
      cursor = Math.max(cursor, doneAt ?? at);
    }

    thought(endAt, "reply");
    traces.set(message.turnId, { workedMs: Math.max(0, endAt - startAt), steps });
  });

  return traces;
}
