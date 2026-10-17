import * as Match from "effect/Match";

import type { ComposerResourceMention } from "./composer-inline-tokens.ts";

/**
 * Composer `@browser` and `@chat:<id>` mentions: which chats the picker
 * offers, and the bounded context a mention adds to the provider input.
 *
 * The composer stores only the token, so the WebSocket payload stays the
 * size of the prompt. The server expands tokens at turn start from its own
 * projection, capped by the budgets below.
 */

/** Recent turns read from a mentioned chat. */
export const THREAD_MENTION_TURN_LIMIT = 3;

/** Character budget for one mentioned chat's excerpt. */
export const THREAD_MENTION_MAX_CHARS = 4_000;

/** Character cap for a single message inside an excerpt. */
export const THREAD_MENTION_MAX_MESSAGE_CHARS = 1_200;

/** Chats expanded per prompt. Further mentions stay as plain references. */
export const THREAD_MENTION_MAX_THREADS = 3;

/** Distinct chat mentions the server looks up per prompt, including hidden or missing ones. */
export const THREAD_MENTION_MAX_LOOKUPS = 12;

/** Skill, app, and MCP server mentions explained per prompt. */
export const RESOURCE_MENTION_MAX = 10;

/** Rows the composer picker shows for chats. */
export const THREAD_MENTION_PICKER_LIMIT = 6;

const DELEGATION_THREAD_ID_PREFIX = "delegation-thread-";

export interface ComposerThreadMentionCandidate {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly updatedAt?: string | undefined;
}

/**
 * Chats a mention never reaches: deleted and archived chats, and background
 * bot-work chats that delegation creates for its own bookkeeping. The picker
 * uses this to filter its rows, and the server applies it again at turn start
 * so a typed or pasted `@chat:<id>` cannot reach a hidden chat.
 */
export function isHiddenComposerThread(thread: {
  readonly id: string;
  readonly archivedAt: string | null;
  readonly deletedAt?: string | null | undefined;
}): boolean {
  return (
    thread.archivedAt !== null ||
    (thread.deletedAt ?? null) !== null ||
    thread.id.startsWith(DELEGATION_THREAD_ID_PREFIX)
  );
}

/**
 * Filters and orders chats for the `@` picker: visible chats other than the
 * current one whose title contains the query (or whose id is in `matchedIds`,
 * from content search), current project first, then most recently updated.
 */
export function rankComposerThreadMentions<T extends ComposerThreadMentionCandidate>(
  threads: ReadonlyArray<T>,
  input: {
    readonly query: string;
    readonly currentThreadId: string | null;
    readonly currentProjectId: string | null;
    readonly matchedIds?: ReadonlySet<string>;
    readonly limit?: number;
  },
): T[] {
  const query = input.query.trim().toLowerCase();

  return [...threads]
    .filter(
      (thread) =>
        thread.id !== input.currentThreadId &&
        !isHiddenComposerThread(thread) &&
        (query.length === 0 ||
          thread.title.toLowerCase().includes(query) ||
          input.matchedIds?.has(thread.id) === true),
    )
    .sort((left, right) => {
      const leftLocal = left.projectId === input.currentProjectId ? 0 : 1;
      const rightLocal = right.projectId === input.currentProjectId ? 0 : 1;

      if (leftLocal !== rightLocal) return leftLocal - rightLocal;

      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
    })
    .slice(0, input.limit ?? THREAD_MENTION_PICKER_LIMIT);
}

export interface ThreadMentionMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
}

export interface ThreadMentionSource {
  readonly id: string;
  readonly title: string;
  readonly messages: ReadonlyArray<ThreadMentionMessage>;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/**
 * Builds one chat excerpt from its newest messages, keeping whole messages
 * until `THREAD_MENTION_MAX_CHARS` is spent. The result never exceeds the
 * budget plus the wrapper tag.
 */
export function buildThreadMentionExcerpt(source: ThreadMentionSource): string {
  const lines: string[] = [];
  let remaining = THREAD_MENTION_MAX_CHARS;

  for (let index = source.messages.length - 1; index >= 0; index--) {
    const message = source.messages[index];

    if (message === undefined) continue;

    if (message.role === "system") continue;
    const body = message.text.trim();

    if (body.length === 0) continue;
    const speaker = message.role === "user" ? "User" : "Bot";
    const line = `${speaker}: ${clip(body, THREAD_MENTION_MAX_MESSAGE_CHARS)}`;

    if (line.length > remaining) {
      if (remaining > 80) lines.push(clip(line, remaining));
      break;
    }

    lines.push(line);
    remaining -= line.length + 1;
  }

  const chronologicalLines: string[] = [];

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];

    if (line !== undefined) chronologicalLines.push(line);
  }

  const body =
    chronologicalLines.length > 0
      ? chronologicalLines.join("\n")
      : "(This chat has no messages yet.)";

  return `<chat_context id="${escapeAttribute(source.id)}" title="${escapeAttribute(source.title)}">\n${body}\n</chat_context>`;
}

/**
 * Appends mention context to the provider input. `threads` holds the chats
 * that could be read, in mention order; unreadable ones are simply absent.
 */
export function appendComposerMentionContext(
  prompt: string,
  input: {
    readonly browser: "enabled" | "disabled" | null;
    readonly threads: ReadonlyArray<ThreadMentionSource>;
    readonly resources?: ReadonlyArray<Pick<ComposerResourceMention, "kind" | "id">>;
  },
): string {
  const sections: string[] = [];

  for (const resource of (input.resources ?? []).slice(0, RESOURCE_MENTION_MAX)) {
    sections.push(
      Match.value(resource.kind).pipe(
        Match.when(
          "skill",
          () =>
            `The user tagged the skill with skillId ${resource.id}. Read its SKILL.md with skill_read and follow it for this request.`,
        ),
        Match.when(
          "app",
          () =>
            `The user tagged the ${resource.id} app. Use their connected ${resource.id} account through your composio-session tools for this request. If you have none, say the app is not connected for you.`,
        ),
        Match.when(
          "mcp",
          () =>
            `The user tagged an MCP server. Use your tools whose names start with "${resource.id}_" for this request. If you have none, say that server is not available to you.`,
        ),
        Match.when(
          "task",
          () =>
            `The user tagged the task with taskId ${resource.id}. Read it with task_read before acting on it.`,
        ),
        Match.when(
          "project",
          () =>
            `The user tagged the project with projectId ${resource.id}. ListTasks with that projectId shows its work.`,
        ),
        Match.exhaustive,
      ),
    );
  }

  if (input.browser === "enabled") {
    sections.push(
      "The user mentioned @browser. Drive a browser in your computer through shell for this request.",
    );
  } else if (input.browser === "disabled") {
    sections.push(
      "The user mentioned @browser, but bot browser access is turned off in Settings. Say so if the request needs a browser.",
    );
  }

  for (const thread of input.threads.slice(0, THREAD_MENTION_MAX_THREADS)) {
    sections.push(buildThreadMentionExcerpt(thread));
  }

  if (sections.length === 0) return prompt;

  return `${prompt}\n\n<mention_context>\n${sections.join("\n")}\n</mention_context>`;
}
