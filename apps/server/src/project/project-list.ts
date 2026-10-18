import {
  LIST_LIMIT_MAX,
  ProjectListError,
  type ProjectListQuery,
  type ProjectListResult,
  ProjectListView,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { LIST_CURSOR_SECRET_NAME, openListCursor, sealListCursor } from "../list-cursor.ts";
import type { ProjectionProjectRepository } from "../persistence/services/projection-projects.ts";

const encodeView = Schema.encodeSync(Schema.fromJsonString(ProjectListView));

const isProjectListError = Schema.is(ProjectListError);

/**
 * One page of the project list. Every workspace member reads every project, so a page needs no
 * per-row check; a cursor from another view or another server is refused.
 */
export const listProjects = (
  query: ProjectListQuery,
  services: {
    readonly projectionProjects: ProjectionProjectRepository["Service"];
    readonly secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom">;
  },
): Effect.Effect<ProjectListResult, ProjectListError> =>
  Effect.gen(function* () {
    const { cursor, limit = LIST_LIMIT_MAX, ...view } = query;
    const viewKey = encodeView(view);
    const secret = yield* services.secretStore.getOrCreateRandom(LIST_CURSOR_SECRET_NAME, 32);
    const after = cursor === undefined ? null : openListCursor(secret, viewKey, cursor);

    if (after === undefined) {
      return yield* new ProjectListError({ detail: "This list changed. Load it again." });
    }

    const page = yield* services.projectionProjects.list({ query: view, limit, after });
    const rows = page.slice(0, limit);
    const last = rows.at(-1);

    return {
      projects: rows.map((row) => row.project),
      nextCursor: page.length > limit && last ? sealListCursor(secret, viewKey, last.key) : null,
    };
  }).pipe(
    Effect.mapError((error) =>
      isProjectListError(error)
        ? error
        : new ProjectListError({ detail: "Projects couldn't be loaded." }),
    ),
  );
