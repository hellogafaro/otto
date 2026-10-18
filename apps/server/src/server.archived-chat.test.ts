import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ORCHESTRATION_WS_METHODS,
  ProviderInstanceId,
  ThreadId,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  asMessageId,
  asProjectId,
  createOrchestrationSystem,
  now,
} from "./orchestration/layers/test-support/orchestration-system.ts";
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

const threadId = ThreadId.make("thread-archived-private");

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

/** A private chat the admin started and archived, projected by the real engine. */
const archivedPrivateChat = Effect.acquireRelease(
  Effect.promise(async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();

    await system.run(
      system.engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-archived-private"),
        projectId: asProjectId("project-archived-private"),
        title: "Project",
        workspaceRoot: "/tmp/project-archived-private",
        defaultModelSelection: modelSelection,
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-archived-private"),
        threadId,
        projectId: asProjectId("project-archived-private"),
        title: "Private archived chat",
        createdBy: adminId,
        visibility: "user",
        modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-archived-private"),
        threadId,
        message: {
          messageId: asMessageId("msg-archived-private"),
          role: "user",
          text: "Kept after archive",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("cmd-thread-archived-private-archive"),
        threadId,
      }),
    );

    return system;
  }),
  (system) => Effect.promise(() => system.dispose()),
);

it.layer(NodeServices.layer)("archived chat reads", (it) => {
  it.effect("serves an archived chat read-only to the people who could see it", () =>
    Effect.gen(function* () {
      const system = yield* archivedPrivateChat;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: system.engine,
          projectionSnapshotQuery: system.snapshotQuery,
        },
      });

      const adminToken = yield* getAuthenticatedBearerSessionToken();
      const memberToken = yield* getMemberBearerSessionToken();

      const subscribe = (token: string) =>
        Effect.gen(function* () {
          const wsUrl = yield* getWsServerUrlForBearer(token);

          return yield* Effect.scoped(
            withWsRpcClient(wsUrl, (client) =>
              client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }).pipe(Stream.runHead),
            ),
          );
        });

      const snapshotStatus = (token: string) =>
        Effect.gen(function* () {
          const response = yield* fetchEffect(
            yield* getHttpServerUrl(`/api/orchestration/threads/${threadId}`),
            { headers: { authorization: `Bearer ${token}` } },
          );

          return { status: response.status, body: yield* response.json };
        });

      const first = Option.getOrThrow(yield* subscribe(adminToken));

      assert.equal(first.kind, "snapshot");

      if (first.kind === "snapshot") {
        assert.isNotNull(first.snapshot.thread.archivedAt);
        assert.deepEqual(
          first.snapshot.thread.messages.map((message) => message.text),
          ["Kept after archive"],
        );
      }

      const adminSnapshot = yield* snapshotStatus(adminToken);

      assert.equal(adminSnapshot.status, 200);

      // Another member could not see this private chat before it was archived, and still cannot.
      const memberRefusal = yield* subscribe(memberToken).pipe(Effect.flip);

      assert.include(String(memberRefusal), "This chat is private.");
      assert.equal((yield* snapshotStatus(memberToken)).status, 404);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
