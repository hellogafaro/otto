import {
  type OrchestrationProjectShell,
  type OrchestrationTask,
  ProjectListFilter,
  TaskListFilter,
  type WorkStatus,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { BLOB_COLORS, BLOB_SHAPES, DEFAULT_BLOB_SHAPE } from "../roster/rosterAvatar.logic";

/** Linear's order: what is moving first, then what is waiting, then what is done. */
export const WORK_STATUS_ORDER: readonly WorkStatus[] = [
  "in_progress",
  "pending",
  "backlog",
  "completed",
  "cancelled",
  "archived",
];

/** Projects saved before planning fields existed read as active. */
export function projectStatus(project: Pick<OrchestrationProjectShell, "status">): WorkStatus {
  return project.status ?? "in_progress";
}

/** URL search to a task filter; a malformed URL shows the unfiltered list instead of failing. */
export const parseTaskSearch = (search: Parameters<typeof decodeTaskSearch>[0]) =>
  Option.getOrElse(decodeTaskSearch(search), (): TaskListFilter => ({}));

const decodeTaskSearch = Schema.decodeUnknownOption(TaskListFilter);

export const parseProjectSearch = (search: Parameters<typeof decodeProjectSearch>[0]) =>
  Option.getOrElse(decodeProjectSearch(search), (): ProjectListFilter => ({}));

const decodeProjectSearch = Schema.decodeUnknownOption(ProjectListFilter);

/** What is moving first, then what waits, then what is done; recent first within each. */
export function sortTasks(tasks: readonly OrchestrationTask[]): OrchestrationTask[] {
  return tasks.toSorted(
    (left, right) =>
      WORK_STATUS_ORDER.indexOf(left.status) - WORK_STATUS_ORDER.indexOf(right.status) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
}

function hashSeed(seed: string): number {
  let hash = 0;

  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

/** A project's cover is drawn from its id, so it never changes and never needs an upload. */
export function projectCover(seed: string) {
  const hash = hashSeed(seed);

  return {
    color: BLOB_COLORS[hash % (BLOB_COLORS.length - 1)] ?? "#8E8E93",
    shape:
      BLOB_SHAPES[Math.floor(hash / BLOB_COLORS.length) % BLOB_SHAPES.length] ?? DEFAULT_BLOB_SHAPE,
    rotate: (Math.floor(hash / 97) % 7) * 8 - 24,
  };
}
