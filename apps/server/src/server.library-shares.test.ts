import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  LIBRARY_SHARED_ROUTE_PREFIX,
  type LibraryFile,
  LibraryFileId,
  type OrchestrationEvent,
  WS_METHODS,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { libraryFilePath } from "./library/library-paths.ts";
import { decideOrchestrationCommand } from "./orchestration/decider.ts";
import { createEmptyReadModel, projectEvent } from "./orchestration/projector.ts";
import { buildAppUnderTest } from "./server-test-app.ts";
import {
  fetchEffect,
  getAuthenticatedBearerSessionToken,
  getHttpServerUrl,
  getMemberBearerSessionToken,
  getWsServerUrlForBearer,
  withWsRpcClient,
  type WsRpcClient,
} from "./server-test-clients.ts";

const AT = "2026-01-01T00:00:00.000Z";

const fileId = LibraryFileId.make("file-report");

it.layer(NodeServices.layer)("public Library links", (it) => {
  it.effect("serve a frozen copy to anyone until the creator removes the link", () =>
    Effect.gen(function* () {
      let files: ReadonlyArray<LibraryFile> = [
        {
          id: fileId,
          folderId: null,
          type: "document",
          title: "Report",
          extension: "md",
          sizeBytes: 9,
          visibility: "organization",
          createdBy: {
            kind: "person",
            personId: AuthSessionId.make("user-test-admin"),
            displayName: "Admin",
          },
          createdAt: AT,
          updatedBy: {
            kind: "person",
            personId: AuthSessionId.make("user-test-admin"),
            displayName: "Admin",
          },
          updatedAt: AT,
        },
      ];

      const config = yield* buildAppUnderTest({
        config: { publicOrigin: "https://otto.example.com" },
        layers: {
          projectionLibrary: { listFiles: () => Effect.sync(() => files) },
          orchestrationEngine: {
            dispatch: (command) =>
              Effect.gen(function* () {
                const readModel = { ...createEmptyReadModel(AT), libraryFiles: files };
                const event = yield* decideOrchestrationCommand({ command, readModel });

                const next = yield* projectEvent(readModel, {
                  ...(Array.isArray(event) ? event[0] : event),
                  sequence: 1,
                } as OrchestrationEvent);

                files = next.libraryFiles ?? [];

                return { sequence: 1 };
              }).pipe(Effect.provide(NodeServices.layer), Effect.orDie),
          },
        },
      });

      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const bytesPath = libraryFilePath(path, config.attachmentsDir, fileId) ?? "";

      yield* fileSystem.makeDirectory(path.dirname(bytesPath), { recursive: true });
      yield* fileSystem.writeFileString(bytesPath, "# First\n");

      const adminWsUrl = yield* getWsServerUrlForBearer(
        yield* getAuthenticatedBearerSessionToken(),
      );

      const memberWsUrl = yield* getWsServerUrlForBearer(yield* getMemberBearerSessionToken());

      const rpc = <A, E>(wsUrl: string, call: (client: WsRpcClient) => Effect.Effect<A, E>) =>
        Effect.scoped(withWsRpcClient(wsUrl, call));

      const share = (wsUrl: string) =>
        rpc(wsUrl, (client) => client[WS_METHODS.libraryShareFile]({ fileId }));

      const fetchShared = (suffix: string) =>
        Effect.gen(function* () {
          const response = yield* fetchEffect(yield* getHttpServerUrl(suffix));
          const body = yield* response.text;

          return { status: response.status, headers: response.headers, body };
        });

      const { url } = yield* share(adminWsUrl);
      const shareId = url.split("/s/")[1] ?? "";

      assert.match(url, /^https:\/\/otto\.example\.com\/s\/[A-Za-z0-9_-]{22}$/);
      assert.include((yield* share(memberWsUrl).pipe(Effect.flip)).message, "creator");

      const details = yield* fetchShared(`${LIBRARY_SHARED_ROUTE_PREFIX}/${shareId}`);

      assert.equal(details.status, 200);
      assert.deepInclude(JSON.parse(details.body), { title: "Report", type: "document" });

      yield* fileSystem.writeFileString(bytesPath, "# Second\n");

      const frozen = yield* fetchShared(`${LIBRARY_SHARED_ROUTE_PREFIX}/${shareId}/content`);

      assert.equal(frozen.body, "# First\n");
      assert.equal(frozen.headers["cache-control"], "no-store");

      assert.equal((yield* share(adminWsUrl)).url, url);
      assert.equal(
        (yield* fetchShared(`${LIBRARY_SHARED_ROUTE_PREFIX}/${shareId}/content`)).body,
        "# Second\n",
      );

      yield* rpc(adminWsUrl, (client) => client[WS_METHODS.libraryUnshareFile]({ fileId }));

      assert.equal(
        (yield* fetchShared(`${LIBRARY_SHARED_ROUTE_PREFIX}/${shareId}/content`)).status,
        404,
      );
      assert.equal((yield* fetchShared(`${LIBRARY_SHARED_ROUTE_PREFIX}/${shareId}`)).status, 404);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
