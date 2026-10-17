import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, GroupId, type GroupMembership, WS_METHODS } from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";

import { defaultThreadId, makeDefaultOrchestrationThreadShell } from "./server-test-fixtures.ts";
import { buildAppUnderTest } from "./server-test-app.ts";
import {
  fetchEffect,
  getAuthenticatedBearerSessionToken,
  getHttpServerUrl,
  getMemberBearerSessionToken,
  getWsServerUrlForBearer,
  withWsRpcClient,
} from "./server-test-clients.ts";

const adminId = AuthSessionId.make("user-test-admin");

const memberId = AuthSessionId.make("user-test-member");

const groupId = GroupId.make("group-attachment-access");

const adminAttachmentId = "thread-1-00000000-0000-4000-8000-000000000001";

const memberAttachmentId = "thread-1-00000000-0000-4000-8000-000000000002";

const pendingAttachmentId = "pending-00000000-0000-4000-8000-000000000003";

const person = (personId: AuthSessionId): GroupMembership => ({
  kind: "person",
  personId,
  displayName: personId,
});

it.layer(NodeServices.layer)("chat attachment access", (it) => {
  it.effect("issues and serves attachments only to their sender and current chat people", () =>
    Effect.gen(function* () {
      let members = [person(adminId), person(memberId)];

      const config = yield* buildAppUnderTest({
        layers: {
          projectionSnapshotQuery: {
            getThreadShellById: () =>
              Effect.succeed(
                Option.some(makeDefaultOrchestrationThreadShell({ groupId, botId: null })),
              ),
          },
          projectionGroups: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  groupId,
                  name: "Team",
                  bossBotId: null,
                  members,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                }),
              ),
          },
          projectionThreadMessages: {
            listAttachmentMessages: ({ attachmentId }) =>
              Effect.succeed(
                attachmentId === adminAttachmentId
                  ? [{ threadId: defaultThreadId, authorPersonId: adminId }]
                  : attachmentId === memberAttachmentId
                    ? [{ threadId: defaultThreadId, authorPersonId: memberId }]
                    : [],
              ),
          },
        },
      });

      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });

      for (const attachmentId of [adminAttachmentId, memberAttachmentId, pendingAttachmentId]) {
        yield* fileSystem.writeFile(
          path.join(config.attachmentsDir, `${attachmentId}.png`),
          new Uint8Array([1, 2, 3]),
        );
      }

      const memberWsUrl = yield* getWsServerUrlForBearer(yield* getMemberBearerSessionToken());

      const adminWsUrl = yield* getWsServerUrlForBearer(
        yield* getAuthenticatedBearerSessionToken(),
      );

      const createUrl = (wsUrl: string, attachmentId: string) =>
        Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.assetsCreateUrl]({
              resource: { _tag: "attachment", attachmentId },
            }),
          ),
        );

      const refusesUrl = (wsUrl: string, attachmentId: string) =>
        createUrl(wsUrl, attachmentId).pipe(
          Effect.flip,
          Effect.map((error) => Predicate.isTagged(error, "AssetAttachmentNotFoundError")),
        );

      const download = (relativeUrl: string) =>
        Effect.gen(function* () {
          const response = yield* fetchEffect(yield* getHttpServerUrl(relativeUrl));

          return response.status;
        });

      const issued = yield* createUrl(memberWsUrl, adminAttachmentId);

      assert.equal(yield* download(issued.relativeUrl), 200);

      members = [person(adminId)];

      assert.equal(yield* download(issued.relativeUrl), 404);
      assert.isTrue(yield* refusesUrl(memberWsUrl, adminAttachmentId));

      const ownAttachment = yield* createUrl(memberWsUrl, memberAttachmentId);

      assert.equal(yield* download(ownAttachment.relativeUrl), 200);

      const adminIssued = yield* createUrl(adminWsUrl, adminAttachmentId);

      assert.equal(yield* download(adminIssued.relativeUrl), 200);
      assert.isTrue(yield* refusesUrl(adminWsUrl, pendingAttachmentId));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
