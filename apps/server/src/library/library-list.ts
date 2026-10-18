import {
  type AuthSessionId,
  LIST_LIMIT_MAX,
  LibraryListError,
  type LibraryListQuery,
  type LibraryListResult,
  LibraryListView,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { LIST_CURSOR_SECRET_NAME, openListCursor, sealListCursor } from "../list-cursor.ts";
import type { ProjectionLibraryRepository } from "../persistence/services/projection-library.ts";

const encodeView = Schema.encodeSync(Schema.fromJsonString(LibraryListView));

const isLibraryListError = Schema.is(LibraryListError);

/**
 * One page of the Library as this person sees it. The query hides what they can't see before
 * the limit, and a cursor is sealed to the person and view, so a cursor from someone else, another
 * view or another server is refused. Every folder above a listed item is one they see, so the
 * page carries those folders too.
 */
export const listLibrary = (
  query: LibraryListQuery,
  personId: AuthSessionId,
  services: {
    readonly projectionLibrary: ProjectionLibraryRepository["Service"];
    readonly secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom">;
  },
): Effect.Effect<LibraryListResult, LibraryListError> =>
  Effect.gen(function* () {
    const { cursor, limit = LIST_LIMIT_MAX, ...view } = query;
    const viewKey = `${personId}:${encodeView(view)}`;
    const secret = yield* services.secretStore.getOrCreateRandom(LIST_CURSOR_SECRET_NAME, 32);
    const after = cursor === undefined ? null : openListCursor(secret, viewKey, cursor);

    if (after === undefined) {
      return yield* new LibraryListError({ detail: "This list changed. Load it again." });
    }

    const page = yield* services.projectionLibrary.list({ query: view, personId, limit, after });
    const rows = page.slice(0, limit);
    const last = rows.at(-1);
    const items = rows.map((row) => row.item);

    const parentIds = new Set(
      items.flatMap((item) => {
        const parentId = item.kind === "folder" ? item.folder.parentId : item.file.folderId;

        return parentId === null ? [] : [parentId];
      }),
    );

    return {
      items,
      folders: yield* services.projectionLibrary.listFolderPaths([...parentIds]),
      nextCursor: page.length > limit && last ? sealListCursor(secret, viewKey, last.key) : null,
    };
  }).pipe(
    Effect.mapError((error) =>
      isLibraryListError(error)
        ? error
        : new LibraryListError({ detail: "The Library couldn't be loaded." }),
    ),
  );
