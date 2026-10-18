import { LibraryRequestError, WS_METHODS, WsRpcGroup } from "@otto/contracts";
import * as Effect from "effect/Effect";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { issueLibraryFileUrl } from "./assets/asset-access.ts";
import { listLibrary } from "./library/library-list.ts";
import {
  createSkill,
  issueLibraryUploadUrl,
  loadLibraryState,
  readLibraryDocument,
  requireVisibleFile,
  saveLibraryDocument,
  shareLibraryFile,
  storeLibraryFile,
  unshareLibraryFile,
} from "./library/library-store.ts";
import type { WsConnection } from "./ws-connection.ts";

/**
 * Library requests act as the signed-in person: the list shows only what they see, and the
 * decider checks what they may change.
 */
export const createWsLibraryHandlers = ({
  currentSession,
  currentPersonId,
  loadEnvironmentPeople,
  projectionLibrary,
  secretStore,
  observeRpcEffect,
}: Pick<
  WsConnection,
  | "currentSession"
  | "currentPersonId"
  | "loadEnvironmentPeople"
  | "projectionLibrary"
  | "secretStore"
  | "observeRpcEffect"
>) => {
  const viewer = { kind: "person" as const, personId: currentPersonId };

  const person = loadEnvironmentPeople().pipe(
    Effect.map((people) => ({
      kind: "person" as const,
      personId: currentPersonId,
      displayName: people.current.displayName,
    })),
    Effect.mapError(() => new LibraryRequestError({ detail: "Could not identify you." })),
  );

  return {
    [WS_METHODS.libraryList]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryList,
        listLibrary(input, currentPersonId, { projectionLibrary, secretStore }),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryCreateUploadUrl]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryCreateUploadUrl,
        person.pipe(Effect.flatMap((by) => issueLibraryUploadUrl(input, by))),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryCreateDocument]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryCreateDocument,
        Effect.gen(function* () {
          const by = yield* person;
          const title = input.title ?? "Untitled";

          const fileId = yield* storeLibraryFile({
            bytes: new Uint8Array(),
            fileName: `${title}.md`,
            title,
            folderId: input.folderId,
            threadId: input.threadId,
            projectId: input.projectId,
            visibility: input.visibility ?? "organization",
            by,
          });

          return { fileId };
        }),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryCreateSkill]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryCreateSkill,
        person.pipe(Effect.flatMap((by) => createSkill(input, by))),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryReadDocument]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryReadDocument,
        Effect.gen(function* () {
          const state = yield* loadLibraryState;
          const file = yield* requireVisibleFile(state, input.fileId, viewer);

          return { content: yield* readLibraryDocument(file), updatedAt: file.updatedAt };
        }),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.librarySaveDocument]: (input) =>
      observeRpcEffect(
        WS_METHODS.librarySaveDocument,
        person.pipe(
          Effect.flatMap((by) =>
            saveLibraryDocument({
              fileId: input.fileId,
              content: input.content,
              expectedUpdatedAt: input.expectedUpdatedAt,
              by,
            }),
          ),
        ),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryCreateFileUrl]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryCreateFileUrl,
        Effect.gen(function* () {
          const state = yield* loadLibraryState;
          const file = yield* requireVisibleFile(state, input.fileId, viewer);

          return yield* issueLibraryFileUrl({
            file,
            download: input.download === true,
            sessionId: currentSession.sessionId,
          }).pipe(
            Effect.mapError(() => new LibraryRequestError({ detail: "Could not open that file." })),
          );
        }),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryShareFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryShareFile,
        person.pipe(Effect.flatMap((by) => shareLibraryFile({ fileId: input.fileId, by }))),
        { "rpc.aggregate": "library" },
      ),

    [WS_METHODS.libraryUnshareFile]: (input) =>
      observeRpcEffect(
        WS_METHODS.libraryUnshareFile,
        person.pipe(Effect.flatMap((by) => unshareLibraryFile({ fileId: input.fileId, by }))),
        { "rpc.aggregate": "library" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.libraryList
    | typeof WS_METHODS.libraryCreateUploadUrl
    | typeof WS_METHODS.libraryCreateDocument
    | typeof WS_METHODS.libraryCreateSkill
    | typeof WS_METHODS.libraryReadDocument
    | typeof WS_METHODS.librarySaveDocument
    | typeof WS_METHODS.libraryCreateFileUrl
    | typeof WS_METHODS.libraryShareFile
    | typeof WS_METHODS.libraryUnshareFile
  >;
};
