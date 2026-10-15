import * as Predicate from "effect/Predicate";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  OttoMemoryEntityId,
  OttoMemoryId,
  OttoMemoryPartitionId,
  OttoMemoryRootId,
  OttoMemoryTenantId,
  OttoMemoryUserId,
  type OttoMemoryRevision,
  type OttoMemoryThreadAccess,
  BotId,
  ProjectId,
  ThreadId,
  WS_METHODS,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type EntityMemoryRepositoryShape } from "./memory/services/entity-memory-repository.ts";

import { makeDefaultOrchestrationThreadShell } from "./server-test-fixtures.ts";
import { buildAppUnderTest } from "./server-test-app.ts";
import {
  getWsServerUrl,
  withWsRpcClient,
  getMemberBearerSessionToken,
  getWsServerUrlForBearer,
} from "./server-test-clients.ts";

it.layer(NodeServices.layer)("server router seam", (it) => {
  it.effect("memory.facts.list returns current durable facts without chat snapshots", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-facts-list");
      const threadId = ThreadId.make("thread-facts-list");
      const botId = BotId.make("bot-facts-list");
      const now = "2026-01-01T00:00:00.000Z";
      const tenantId = OttoMemoryTenantId.make("local");
      const userId = OttoMemoryUserId.make("owner");
      const workspaceRoot = "/workspace/facts-list";

      const project = {
        id: projectId,
        title: "Facts list",
        workspaceRoot,
        repositoryIdentity: null,
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        faviconPath: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      };

      const thread = makeDefaultOrchestrationThreadShell({
        id: threadId,
        projectId,
        botId,
        respondingBotId: null,
      });

      const access: OttoMemoryThreadAccess = {
        tenantId,
        userId,
        threadId,
        projectId,
        workspaceRoot,
        legacyWorkspaceOwnerProjectId: projectId,
        botId,
        groupId: null,
        respondingBotId: null,
        groupMemberBotIds: [],
      };

      const revision = (id: string): OttoMemoryRevision => ({
        id: OttoMemoryId.make(id),
        rootId: OttoMemoryRootId.make(id),
        revision: 1,
        partition: {
          tenantId,
          scope: "thread",
          partitionId: OttoMemoryPartitionId.make(threadId),
        },
        entityKind: "bot",
        entityId: OttoMemoryEntityId.make(botId),
        kind: "fact",
        value: {},
        fact: `Listed durable fact ${id}`,
        sourceThreadId: threadId,
        sourceMessageId: null,
        authorBotId: botId,
        initiatingUserId: userId,
        createdAt: now,
        confirmedAt: now,
        updatedAt: now,
        confidence: 0.9,
        approvalState: "approved",
        supersedesId: null,
        supersededById: null,
        visibility: "private",
        deletionState: "active",
        pinned: false,
        sensitive: false,
        affectedBotIds: [botId],
      });

      yield* buildAppUnderTest({
        durableMemory: {
          seed: (repository) =>
            Effect.gen(function* () {
              yield* repository.insert({ access, revision: revision("list-fact-a") });
              yield* repository.insert({ access, revision: revision("list-fact-b") });
              // Rejected, forgotten, and edited facts stay listed at their current revision so
              // the user can act on them.
              yield* repository.insert({ access, revision: revision("list-fact-rejected") });
              yield* repository.insert({ access, revision: revision("list-fact-forgotten") });
              yield* repository.applyMutation({
                access,
                mutation: {
                  operation: "fact.decide",
                  memoryId: OttoMemoryRootId.make("list-fact-rejected"),
                  expectedRevision: 1,
                  decision: "reject",
                },
                memoryId: OttoMemoryId.make("list-fact-rejected-2"),
                updatedAt: now,
                sharedProjectApproval: "pending",
              });
              yield* repository.applyMutation({
                access,
                mutation: {
                  operation: "fact.forget",
                  memoryId: OttoMemoryRootId.make("list-fact-forgotten"),
                  expectedRevision: 1,
                },
                memoryId: OttoMemoryId.make("list-fact-forgotten-2"),
                updatedAt: now,
                sharedProjectApproval: "pending",
              });
              yield* repository.applyMutation({
                access,
                mutation: {
                  operation: "fact.edit",
                  memoryId: OttoMemoryRootId.make("list-fact-a"),
                  expectedRevision: 1,
                  fact: "Edited durable fact list-fact-a",
                },
                memoryId: OttoMemoryId.make("list-fact-a-2"),
                updatedAt: now,
                sharedProjectApproval: "pending",
              });
            }),
        },
        layers: {
          projectionSnapshotQuery: {
            getProjectShellById: (id) =>
              Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
            getOriginalProjectIdByWorkspaceRoot: (root) =>
              Effect.succeed(root === workspaceRoot ? Option.some(projectId) : Option.none()),
            getThreadShellById: (id) =>
              Effect.succeed(id === threadId ? Option.some(thread) : Option.none()),
          },
        },
      });

      // Otto: A member's standard client scopes are enough to list durable facts.
      const readWsUrl = yield* getWsServerUrlForBearer(yield* getMemberBearerSessionToken());

      const listed = yield* Effect.scoped(
        withWsRpcClient(readWsUrl, (client) =>
          client[WS_METHODS.memoryFactsList]({ threadId, target: "thread" }),
        ),
      );

      assert.deepEqual(
        listed.facts
          .map((fact) => `${fact.rootId}:${fact.approvalState}:${fact.deletionState}`)
          .sort(),
        [
          "list-fact-a:approved:active",
          "list-fact-b:approved:active",
          "list-fact-forgotten:approved:tombstoned",
          "list-fact-rejected:rejected:active",
        ],
      );
      const edited = listed.facts.find((fact) => fact.rootId === "list-fact-a");
      assert.equal(edited?.fact, "Edited durable fact list-fact-a");
      assert.equal(edited?.supersededFact, "Listed durable fact list-fact-a");
      assert.equal(edited?.revision, 2);
      // The read shape carries only fact metadata: no conversation or
      // observational-memory payloads may cross the wire.
      assert.deepEqual(Object.keys(listed).sort(), ["facts"]);
      assert.isFalse("conversation" in listed);
      assert.isFalse("observations" in listed);
      assert.isFalse("snapshot" in listed);

      const foreign = yield* Effect.flip(
        Effect.scoped(
          withWsRpcClient(readWsUrl, (client) =>
            client[WS_METHODS.memoryFactsList]({
              threadId: ThreadId.make("thread-facts-missing"),
              target: "thread",
            }),
          ),
        ),
      );

      assert.equal(foreign._tag, "OttoMemoryOperationError");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("memory.facts.mutate mutates durable facts with operate scope and ownership", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-facts-mutate");
      const foreignProjectId = ProjectId.make("project-facts-other");
      const threadId = ThreadId.make("thread-facts-mutate");
      const botId = BotId.make("bot-facts-mutate");
      const foreignBotId = BotId.make("bot-facts-other");
      const now = "2026-01-01T00:00:00.000Z";
      const tenantId = OttoMemoryTenantId.make("local");
      const userId = OttoMemoryUserId.make("owner");
      const workspaceRoot = "/workspace/facts-mutate";
      let repositoryRef: EntityMemoryRepositoryShape | undefined;

      const projectShell = (id: ProjectId) => ({
        id,
        title: `Project ${id}`,
        workspaceRoot,
        repositoryIdentity: null,
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        faviconPath: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      });

      const thread = makeDefaultOrchestrationThreadShell({
        id: threadId,
        projectId,
        botId,
        respondingBotId: null,
      });

      const access: OttoMemoryThreadAccess = {
        tenantId,
        userId,
        threadId,
        projectId,
        workspaceRoot,
        legacyWorkspaceOwnerProjectId: projectId,
        botId,
        groupId: null,
        respondingBotId: null,
        groupMemberBotIds: [],
      };

      const revision = (id: string): OttoMemoryRevision => ({
        id: OttoMemoryId.make(id),
        rootId: OttoMemoryRootId.make(id),
        revision: 1,
        partition: {
          tenantId,
          scope: "thread",
          partitionId: OttoMemoryPartitionId.make(threadId),
        },
        entityKind: "bot",
        entityId: OttoMemoryEntityId.make(botId),
        kind: "fact",
        value: {},
        fact: `Mutable durable fact ${id}`,
        sourceThreadId: threadId,
        sourceMessageId: null,
        authorBotId: botId,
        initiatingUserId: userId,
        createdAt: now,
        confirmedAt: now,
        updatedAt: now,
        confidence: 0.9,
        approvalState: "approved",
        supersedesId: null,
        supersededById: null,
        visibility: "private",
        deletionState: "active",
        pinned: false,
        sensitive: false,
        affectedBotIds: [botId],
      });

      const seeded = revision("mutate-fact-1");

      yield* buildAppUnderTest({
        durableMemory: {
          seed: (repository) =>
            Effect.gen(function* () {
              repositoryRef = repository;
              yield* repository.insert({ access, revision: seeded });
            }),
        },
        layers: {
          projectionSnapshotQuery: {
            getProjectShellById: (id) =>
              Effect.succeed(
                id === projectId || id === foreignProjectId
                  ? Option.some(projectShell(id))
                  : Option.none(),
              ),
            getOriginalProjectIdByWorkspaceRoot: (root) =>
              Effect.succeed(root === workspaceRoot ? Option.some(projectId) : Option.none()),
            getThreadShellById: (id) =>
              Effect.succeed(id === threadId ? Option.some(thread) : Option.none()),
          },
        },
      });
      assert.isDefined(repositoryRef);
      const repository = repositoryRef!;
      const wsUrl = yield* getWsServerUrl("/ws");

      const edited = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.edit",
              memoryId: seeded.rootId,
              expectedRevision: 1,
              fact: "Edited over WS",
            },
          }),
        ),
      );

      assert.equal(edited.kind, "revision");

      if (edited.kind !== "revision") return assert.fail("expected a revision result");
      assert.equal(edited.revision.fact, "Edited over WS");
      assert.equal(edited.revision.revision, 2);

      const pinned = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.pin",
              memoryId: seeded.rootId,
              expectedRevision: 2,
              pinned: true,
            },
          }),
        ),
      );

      if (pinned.kind !== "revision") return assert.fail("expected a revision result");
      assert.isTrue(pinned.revision.pinned);

      const forgotten = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.forget",
              memoryId: seeded.rootId,
              expectedRevision: 3,
            },
          }),
        ),
      );

      if (forgotten.kind !== "revision") return assert.fail("expected a revision result");
      assert.equal(forgotten.revision.deletionState, "tombstoned");

      const deleted = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.delete",
              memoryId: seeded.rootId,
              expectedRevision: 4,
            },
          }),
        ),
      );

      assert.equal(deleted.kind, "deleted");

      const missing = yield* repository
        .getCurrent({ access, rootId: seeded.rootId })
        .pipe(Effect.exit);

      assert.isTrue(Predicate.isTagged(missing, "Failure"));

      // A mutation against a thread that is not the owner is rejected before
      // any repository write.
      const wrongOwner = yield* Effect.flip(
        Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.memoryFactMutate]({
              threadId: ThreadId.make("thread-facts-other"),
              mutation: {
                operation: "fact.pin",
                memoryId: seeded.rootId,
                expectedRevision: 1,
                pinned: true,
              },
            }),
          ),
        ),
      );

      assert.equal(wrongOwner._tag, "OttoMemoryOperationError");
      assert.isDefined(foreignBotId);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("shared project memory lands pending approval by default", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-facts-pending");
      const threadId = ThreadId.make("thread-facts-pending");
      const botId = BotId.make("bot-facts-pending");
      const now = "2026-01-01T00:00:00.000Z";
      const tenantId = OttoMemoryTenantId.make("local");
      const userId = OttoMemoryUserId.make("owner");
      const workspaceRoot = "/workspace/facts-pending";
      let repositoryRef: EntityMemoryRepositoryShape | undefined;

      const project = {
        id: projectId,
        title: "Pending defaults",
        workspaceRoot,
        repositoryIdentity: null,
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        faviconPath: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      };

      const thread = makeDefaultOrchestrationThreadShell({
        id: threadId,
        projectId,
        botId,
        respondingBotId: null,
      });

      const access: OttoMemoryThreadAccess = {
        tenantId,
        userId,
        threadId,
        projectId,
        workspaceRoot,
        legacyWorkspaceOwnerProjectId: projectId,
        botId,
        groupId: null,
        respondingBotId: null,
        groupMemberBotIds: [],
      };

      const seeded: OttoMemoryRevision = {
        id: OttoMemoryId.make("pending-fact-1"),
        rootId: OttoMemoryRootId.make("pending-fact-1"),
        revision: 1,
        partition: {
          tenantId,
          scope: "bot",
          partitionId: OttoMemoryPartitionId.make(botId),
        },
        entityKind: "bot",
        entityId: OttoMemoryEntityId.make(botId),
        kind: "fact",
        value: {},
        fact: "A private bot fact",
        sourceThreadId: null,
        sourceMessageId: null,
        authorBotId: botId,
        initiatingUserId: userId,
        createdAt: now,
        confirmedAt: now,
        updatedAt: now,
        confidence: 0.9,
        approvalState: "approved",
        supersedesId: null,
        supersededById: null,
        visibility: "private",
        deletionState: "active",
        pinned: false,
        sensitive: false,
        affectedBotIds: [botId],
      };

      yield* buildAppUnderTest({
        durableMemory: {
          seed: (repository) =>
            Effect.gen(function* () {
              repositoryRef = repository;
              yield* repository.insert({ access, revision: seeded });
            }),
        },
        layers: {
          projectionSnapshotQuery: {
            getProjectShellById: (id) =>
              Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
            getOriginalProjectIdByWorkspaceRoot: (root) =>
              Effect.succeed(root === workspaceRoot ? Option.some(projectId) : Option.none()),
            getThreadShellById: (id) =>
              Effect.succeed(id === threadId ? Option.some(thread) : Option.none()),
          },
        },
      });
      assert.isDefined(repositoryRef);
      const repository = repositoryRef!;
      const wsUrl = yield* getWsServerUrl("/ws");

      // Default settings keep "Shared project memory" at ask-before-saving, so
      // moving a private fact onto the shared project scope lands it pending.
      const moved = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.scope",
              memoryId: seeded.rootId,
              expectedRevision: 1,
              scope: "project",
            },
          }),
        ),
      );

      if (moved.kind !== "revision") return assert.fail("expected a revision result");
      assert.equal(moved.revision.partition.scope, "project");
      assert.equal(moved.revision.visibility, "shared");
      assert.equal(moved.revision.approvalState, "pending");

      // Pending facts are not part of current recall until approved.
      const current = yield* repository.listCurrent({ access });
      assert.isFalse(current.some((revision) => revision.rootId === seeded.rootId));

      const approved = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.memoryFactMutate]({
            threadId,
            mutation: {
              operation: "fact.decide",
              memoryId: seeded.rootId,
              expectedRevision: 2,
              decision: "approve",
            },
          }),
        ),
      );

      if (approved.kind !== "revision") return assert.fail("expected a revision result");
      assert.equal(approved.revision.approvalState, "approved");
      assert.isTrue(
        (yield* repository.listCurrent({ access })).some(
          (revision) => revision.rootId === seeded.rootId,
        ),
      );
    }).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
