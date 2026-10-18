import {
  LIST_LIMIT_MAX,
  TaskListError,
  type TaskListQuery,
  type TaskListResult,
  TaskListView,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { LIST_CURSOR_SECRET_NAME, openListCursor, sealListCursor } from "../list-cursor.ts";
import type { ProjectionTaskRepository } from "../persistence/services/projection-tasks.ts";

const encodeView = Schema.encodeSync(Schema.fromJsonString(TaskListView));

/**
 * One page of the task list. Every workspace member reads every task, so a page needs no
 * per-row check; a cursor from another view or another server is refused.
 */
export const listTasks = (
  query: TaskListQuery,
  services: {
    readonly projectionTasks: ProjectionTaskRepository["Service"];
    readonly secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom">;
  },
): Effect.Effect<TaskListResult, TaskListError> =>
  Effect.gen(function* () {
    const { cursor, limit = LIST_LIMIT_MAX, ...view } = query;
    const viewKey = encodeView(view);
    const secret = yield* services.secretStore.getOrCreateRandom(LIST_CURSOR_SECRET_NAME, 32);
    const after = cursor === undefined ? null : openListCursor(secret, viewKey, cursor);

    if (after === undefined) {
      return yield* new TaskListError({ detail: "This list changed. Load it again." });
    }

    const page = yield* services.projectionTasks.list({ query: view, limit, after });
    const rows = page.rows.slice(0, limit);
    const last = rows.at(-1);

    return {
      tasks: rows.map((row) => row.task),
      nextCursor:
        page.rows.length > limit && last ? sealListCursor(secret, viewKey, last.key) : null,
      statusCounts: page.statusCounts,
    };
  }).pipe(
    Effect.mapError((error) =>
      Schema.is(TaskListError)(error)
        ? error
        : new TaskListError({ detail: "Tasks couldn't be loaded." }),
    ),
  );
