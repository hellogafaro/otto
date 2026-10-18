import {
  type CachedTask,
  createTaskEnvironmentAtoms,
  taskCacheAtom,
  taskChangesAtom,
} from "@otto/client-runtime/state/tasks";
import {
  type EnvironmentId,
  TaskId,
  type TaskListQuery,
  type TaskListItem,
  type TaskListResult,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Predicate from "effect/Predicate";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef, useState } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useListPages } from "../hooks/use-list-pages";
import { useAtomCommand } from "./use-atom-command";

export const taskEnvironment = createTaskEnvironmentAtoms(connectionAtomRuntime);

// SAFETY: the empty environment ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

const nextTaskCursor = (page: TaskListResult) => page.nextCursor;

/** The tasks this client has read in an environment, by id. */
export function useTaskCache(environmentId: EnvironmentId | null): ReadonlyMap<TaskId, CachedTask> {
  return useAtomValue(taskCacheAtom(environmentId ?? NO_ENVIRONMENT)).tasks;
}

/**
 * Otto: Pages of `tasks.list` for `query`, reloaded in place whenever any task changes; null
 * asks for nothing, as a closed picker does.
 */
export function useTaskPages(environmentId: EnvironmentId | null, query: TaskListQuery | null) {
  const listTasks = useAtomCommand(taskEnvironment.list, { reportFailure: false });
  const changes = useAtomValue(taskChangesAtom(environmentId ?? NO_ENVIRONMENT));

  return useListPages({
    view: query === null ? "" : `${environmentId}:${JSON.stringify(query)}`,
    revision: changes,
    getNextCursor: nextTaskCursor,
    fetchPage: async (cursor) => {
      if (!environmentId || query === null) return null;

      const result = await listTasks({
        environmentId,
        input: cursor === undefined ? query : { ...query, cursor },
      });

      return AsyncResult.isSuccess(result) ? result.value : null;
    },
  });
}

/**
 * Otto: The open tasks a picker offers for what was typed after its trigger, oldest first as the
 * pickers always listed them, matched by title on the server; null while the picker is closed.
 */
export function usePickerTasks(
  environmentId: EnvironmentId | null,
  text: string | null,
  limit?: number,
): ReadonlyArray<TaskListItem> {
  const title = text?.slice(0, 300).trim() ?? "";

  const list = useTaskPages(
    environmentId,
    text === null
      ? null
      : {
          ...(title === "" ? {} : { title }),
          sort: "created",
          order: "asc",
          ...(limit === undefined ? {} : { limit }),
        },
  );

  return list.pages[0]?.tasks ?? NO_TASKS;
}

const NO_TASKS: ReadonlyArray<TaskListItem> = [];

/**
 * Otto: One task with its timesheet, from the cache, read from the server when its timesheet may
 * be out of date. `missing` once the server refuses it or has no such task; until the task is
 * read, any task change, a reconnect included, asks again.
 */
export function useTask(environmentId: EnvironmentId | null, taskId: TaskId) {
  const cache = useAtomValue(taskCacheAtom(environmentId ?? NO_ENVIRONMENT));
  const changes = useAtomValue(taskChangesAtom(environmentId ?? NO_ENVIRONMENT));
  const getTask = useAtomCommand(taskEnvironment.get, { reportFailure: false });
  const [missing, setMissing] = useState<TaskId | null>(null);
  const cached = cache.tasks.get(taskId);
  const unread = environmentId !== null && !cache.current.has(taskId);
  const attempt = unread ? changes : -1;

  const task = useMemo(() => {
    const timeEntries = cached?.timeEntries;

    return cached && timeEntries ? { ...cached, timeEntries } : null;
  }, [cached]);

  useEffect(() => {
    if (!unread || environmentId === null) return;

    let current = true;

    void getTask({ environmentId, input: { taskId } }).then((result) => {
      if (!current || AsyncResult.isSuccess(result)) return;

      const error = Cause.squash(result.cause);

      if (
        Predicate.isTagged(error, "TaskNotFoundError") ||
        Predicate.isTagged(error, "EnvironmentAuthorizationError")
      ) {
        setMissing(taskId);
      }
    });

    return () => {
      current = false;
    };
  }, [attempt, environmentId, getTask, taskId, unread]);

  return { task, missing: task === null && missing === taskId };
}

const NO_TASK_IDS: ReadonlyArray<string> = [];

/** The cached tasks, reading each of `ids` the cache lacks from the server once. */
export function useCachedTasks(
  environmentId: EnvironmentId | null,
  ids: ReadonlyArray<string> = NO_TASK_IDS,
): ReadonlyMap<TaskId, CachedTask> {
  const tasks = useTaskCache(environmentId);
  const getTask = useAtomCommand(taskEnvironment.get, { reportFailure: false });
  const requested = useRef(new Set<string>());
  const unknown = ids.filter((id) => !tasks.has(TaskId.make(id))).join("\n");

  useEffect(() => {
    if (environmentId === null || unknown === "") return;

    for (const id of unknown.split("\n")) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void getTask({ environmentId, input: { taskId: TaskId.make(id) } });
    }
  }, [environmentId, getTask, unknown]);

  return tasks;
}
