import type { BotId, OttoToolInputSchemas, ThreadId } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { activeLibraryTools } from "../../../library/library-tool-runtime.ts";
import {
  canSeeRoutine,
  chatPeople,
  chatsSeenByAll,
} from "../../../orchestration/group-visibility.ts";
import { activeTaskTools } from "../../../tasks/task-tool-runtime.ts";
import type { SessionLifecycleDependencies } from "./session-lifecycle-dependencies.ts";

type SearchInput = (typeof OttoToolInputSchemas.search)["Type"];

type SearchType = NonNullable<SearchInput["type"]>;

interface SearchHit {
  readonly type: SearchType;
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly updatedAt: string;
  readonly dueDate?: string | null;
  /** The fields this type adds to its result, such as a task's status or a file's folder. */
  readonly details: object;
}

const MESSAGES_MAX = 200;

const TERMS_MAX = 10;

const DEFAULT_LIMIT = 20;

const SNIPPET_CHARS = 200;

/** Task filters mean tasks and a folder means files; a mismatch names the fix. */
const resolveType = (
  input: SearchInput,
): { readonly type?: SearchType } | { readonly error: string } => {
  const taskFilter =
    input.status !== undefined ||
    input.priority !== undefined ||
    input.assignee !== undefined ||
    input.projectId !== undefined ||
    input.due !== undefined;

  if (taskFilter && input.folderId !== undefined) {
    return { error: "Task filters and folderId can't be combined: search tasks or files." };
  }

  const implied = taskFilter ? "task" : input.folderId !== undefined ? "file" : undefined;

  if (implied !== undefined && input.type !== undefined && input.type !== implied) {
    return {
      error: `${implied === "task" ? "status, priority, assignee, projectId and due" : "folderId"} only apply to type ${implied}.`,
    };
  }

  const type = input.type ?? implied;

  if (type === undefined && input.query === undefined) {
    return { error: "Pass a query, a type, or both." };
  }

  return type === undefined ? {} : { type };
};

/** Title hits count 3, text hits 1, and holding every word 2 more. */
const score = (hit: SearchHit, terms: ReadonlyArray<string>) => {
  const title = hit.title.toLowerCase();
  const text = hit.text.toLowerCase();
  const inTitle = terms.filter((term) => title.includes(term)).length;
  const inText = terms.filter((term) => text.includes(term)).length;
  const all = terms.every((term) => title.includes(term) || text.includes(term));

  return inTitle * 3 + inText + (all && terms.length > 0 ? 2 : 0);
};

const snippet = (text: string, terms: ReadonlyArray<string>) => {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();

  const at = Math.min(
    ...terms.flatMap((term) => {
      const index = lower.indexOf(term);

      return index >= 0 ? [index] : [];
    }),
    flat.length,
  );

  const start = Math.max(0, Math.min(at - 60, flat.length - SNIPPET_CHARS));
  const end = start + SNIPPET_CHARS;

  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
};

/** Today in the organization's time zone, and the Sunday that ends this week, as YYYY-MM-DD. */
const organizationWeek = (timezone: string) => {
  const now = DateTime.nowUnsafe();
  const zoned = Option.getOrElse(DateTime.setZoneNamed(now, timezone), () => now);

  return {
    today: DateTime.formatIsoDate(zoned),
    weekEnd: DateTime.formatIsoDate(DateTime.endOf(zoned, "week", { weekStartsOn: 1 })),
  };
};

/**
 * The search tool for one bot chat: a thin fan-out over each domain's own query. Every result
 * is something the bot and every person in this chat may see, checked before ranking.
 */
export function createSessionSearch(
  deps: Pick<
    SessionLifecycleDependencies,
    | "runPromise"
    | "projectionSnapshotQuery"
    | "routineRepository"
    | "projectionMessages"
    | "sessions"
  >,
  input: { readonly threadId: ThreadId; readonly botId: BotId },
) {
  const { threadId, botId } = input;
  const caller = { threadId, botId };

  return async (request: SearchInput) => {
    const resolved = resolveType(request);

    if ("error" in resolved) return { error: resolved.error };
    const snapshotQuery = Option.getOrUndefined(deps.projectionSnapshotQuery);

    if (snapshotQuery === undefined) return { error: "Search is unavailable right now." };
    const snapshot = await deps.runPromise(snapshotQuery.getShellSnapshot());
    let chat = snapshot.threads.find((thread) => thread.id === threadId);

    while (chat?.parentThreadId != null) {
      const parentId = chat.parentThreadId;
      chat = snapshot.threads.find((thread) => thread.id === parentId);
    }

    if (chat === undefined) return { error: "This chat is unavailable, so search is too." };
    const people = chatPeople(chat, snapshot.groups);

    const terms = [
      ...new Set(request.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []),
    ].slice(0, TERMS_MAX);

    const wants = (type: SearchType) => resolved.type === undefined || resolved.type === type;

    const taskHits = async (): Promise<ReadonlyArray<SearchHit> | { readonly error: string }> => {
      const tasks = activeTaskTools();

      if (!wants("task") || tasks === undefined) return [];

      const found = await deps.runPromise(
        tasks.search(caller, {
          terms,
          status: request.status,
          priority: request.priority,
          assignee: request.assignee,
          projectId: request.projectId,
          due: request.due,
          // Otto: due dates are the organization's days, whoever's chat asks.
          ...organizationWeek(tasks.timeZone()),
        }),
      );

      if ("error" in found) return found;

      return found.map(({ taskId, title, description, updatedAt, ...details }) => ({
        type: "task",
        id: taskId,
        title,
        text: description,
        updatedAt,
        dueDate: details.dueDate,
        details,
      }));
    };

    const fileHits = async (): Promise<ReadonlyArray<SearchHit> | { readonly error: string }> => {
      const library = activeLibraryTools();

      if (!wants("file") || library === undefined) return [];

      const found = await deps.runPromise(
        library.search(caller, people, { terms, folderId: request.folderId }),
      );

      if ("error" in found) return found;

      return found.map((file) => ({
        type: "file",
        id: file.fileId,
        title: file.title,
        text: file.content,
        updatedAt: file.updatedAt,
        details: {
          fileType: file.type,
          extension: file.extension,
          folderId: file.folderId,
          folder: file.folderPath,
        },
      }));
    };

    const messageHits = async (): Promise<ReadonlyArray<SearchHit>> => {
      const messages = Option.getOrUndefined(deps.projectionMessages);

      if (!wants("message") || messages === undefined) return [];
      const chats = chatsSeenByAll(snapshot, botId, people, chat.id);

      const rows = await deps.runPromise(
        messages.search({
          threadIds: chats.map((candidate) => candidate.id),
          terms,
          limit: MESSAGES_MAX,
        }),
      );

      return rows.map((row) => ({
        type: "message",
        id: row.messageId,
        title: chats.find((candidate) => candidate.id === row.threadId)?.title ?? "Chat",
        text: row.text,
        updatedAt: row.createdAt,
        details: {
          chatId: row.threadId,
          author:
            row.role === "user"
              ? (row.authorDisplayName ?? "Someone")
              : (snapshot.bots.find((bot) => bot.id === row.respondingBotId)?.name ?? "A bot"),
        },
      }));
    };

    const routineHits = async (): Promise<ReadonlyArray<SearchHit>> => {
      const routines = Option.getOrUndefined(deps.routineRepository);

      if (!wants("routine") || routines === undefined) return [];

      return (await deps.runPromise(routines.listAll)).flatMap((routine) => {
        const text = `${routine.job}\n${routine.procedure}`.toLowerCase();

        return routine.botId === botId &&
          routine.deletedAt === null &&
          routine.lifecycle !== "deleted" &&
          people.every((personId) => canSeeRoutine(routine, personId)) &&
          (terms.length === 0 || terms.some((term) => text.includes(term)))
          ? [
              {
                type: "routine" as const,
                id: routine.id,
                title: routine.job,
                text: routine.procedure,
                updatedAt: routine.updatedAt,
                details: {
                  schedule: routine.schedule,
                  paused: !routine.enabled,
                  nextRunAt: routine.nextRunAt,
                },
              },
            ]
          : [];
      });
    };

    const hits: SearchHit[] = [...(await routineHits())];

    for (const found of await Promise.all([taskHits(), fileHits(), messageHits()])) {
      if ("error" in found) return found;
      hits.push(...found);
    }

    const byDue = terms.length === 0 && request.due !== undefined;

    const ranked = hits
      .map((hit) => ({ hit, score: score(hit, terms) }))
      .toSorted(
        (left, right) =>
          right.score - left.score ||
          (byDue ? (left.hit.dueDate ?? "").localeCompare(right.hit.dueDate ?? "") : 0) ||
          right.hit.updatedAt.localeCompare(left.hit.updatedAt),
      );

    const limit = request.limit ?? DEFAULT_LIMIT;

    return {
      results: ranked.slice(0, limit).map(({ hit }) => ({
        type: hit.type,
        id: hit.id,
        title: hit.title,
        snippet: snippet(hit.text, terms),
        updatedAt: hit.updatedAt,
        ...hit.details,
      })),
      total: ranked.length,
      truncated: ranked.length > limit,
    };
  };
}
