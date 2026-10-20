import type {
  EnvironmentId,
  OrchestrationShellStreamItem,
  OrchestrationTask,
  TaskId,
  TaskListItem,
} from "@otto/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

/** A task as this client last read it; a list row has no timesheet until the task itself is read. */
export type CachedTask = TaskListItem & Partial<Pick<OrchestrationTask, "timeEntries">>;

export interface TaskCache {
  readonly tasks: ReadonlyMap<TaskId, CachedTask>;
  /** The tasks read whole or changed since the last snapshot, so their timesheet is current. */
  readonly current: ReadonlySet<TaskId>;
}

const EMPTY_TASK_CACHE: TaskCache = { tasks: new Map(), current: new Set() };

/**
 * Otto: The tasks this client has read, by id. The shell snapshot no longer carries tasks, so
 * `tasks.get` and `tasks.list` results fill this and task events keep it current.
 */
export const taskCacheAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(EMPTY_TASK_CACHE).pipe(Atom.keepAlive, Atom.withLabel(`task-cache:${environmentId}`)),
);

/** Otto: Counts every task event and snapshot, so a task list reloads whenever any task changes. */
export const taskChangesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel(`task-changes:${environmentId}`)),
);

/** Keeps the newer of a cached and an incoming task; a list row keeps the cached timesheet. */
export function cacheTasks(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  tasks: ReadonlyArray<CachedTask>,
) {
  if (tasks.length === 0) return;

  registry.update(taskCacheAtom(environmentId), (cache) => {
    const next = new Map(cache.tasks);
    const current = new Set(cache.current);

    for (const task of tasks) {
      const cached = next.get(task.id);

      if (cached === undefined || cached.updatedAt <= task.updatedAt) {
        next.set(task.id, { ...cached, ...task });
      }

      if (task.timeEntries !== undefined) current.add(task.id);
    }

    return { tasks: next, current };
  });
}

/**
 * Feeds the task cache from the shell: an event replaces its task or drops a deleted one, and a
 * snapshot, which may follow missed events, leaves every cached task to be read again.
 */
export function recordTaskShellItem(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  item: OrchestrationShellStreamItem,
) {
  if (item.kind === "snapshot") {
    registry.update(taskCacheAtom(environmentId), (cache) => ({
      tasks: cache.tasks,
      current: new Set<TaskId>(),
    }));
  } else if (item.kind === "task-upserted") {
    cacheTasks(registry, environmentId, [item.task]);
  } else if (item.kind === "task-deleted") {
    registry.update(taskCacheAtom(environmentId), (cache) => {
      const tasks = new Map(cache.tasks);
      const current = new Set(cache.current);
      tasks.delete(item.taskId);
      current.delete(item.taskId);

      return { tasks, current };
    });
  } else {
    return;
  }

  registry.update(taskChangesAtom(environmentId), (count) => count + 1);
}
