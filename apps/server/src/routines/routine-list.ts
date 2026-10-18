import {
  type AuthSessionId,
  LIST_LIMIT_MAX,
  RoutineListError,
  type RoutineListQuery,
  type RoutineListResult,
  RoutineListView,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { LIST_CURSOR_SECRET_NAME, openListCursor, sealListCursor } from "../list-cursor.ts";
import type { RoutineRepository } from "./repository.ts";

const encodeView = Schema.encodeSync(Schema.fromJsonString(RoutineListView));

const isRoutineListError = Schema.is(RoutineListError);

/**
 * One page of the routines the viewer may see. Private routines are filtered in SQL, so
 * neither a page nor its cursor comes from one; a cursor from another view, another viewer or
 * another server is refused.
 */
export const listRoutines = (
  query: RoutineListQuery,
  viewer: AuthSessionId,
  services: {
    readonly routineRepository: RoutineRepository["Service"];
    readonly secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom">;
  },
): Effect.Effect<RoutineListResult, RoutineListError> =>
  Effect.gen(function* () {
    const { cursor, limit = LIST_LIMIT_MAX, ...view } = query;
    const viewKey = `${viewer}:${encodeView(view)}`;
    const secret = yield* services.secretStore.getOrCreateRandom(LIST_CURSOR_SECRET_NAME, 32);
    const after = cursor === undefined ? null : openListCursor(secret, viewKey, cursor);

    if (after === undefined) {
      return yield* new RoutineListError({ detail: "This list changed. Load it again." });
    }

    const page = yield* services.routineRepository.list({ query: view, viewer, limit, after });
    const rows = page.rows.slice(0, limit);
    const last = rows.at(-1);

    return {
      routines: rows.map((row) => row.routine),
      nextCursor:
        page.rows.length > limit && last ? sealListCursor(secret, viewKey, last.key) : null,
      statusCounts: page.statusCounts,
    };
  }).pipe(
    Effect.mapError((error) =>
      isRoutineListError(error)
        ? error
        : new RoutineListError({ detail: "Routines couldn't be loaded." }),
    ),
  );
