import { assert, it } from "@effect/vitest";
import {
  OttoMemoryEntityId,
  OttoMemoryId,
  OttoMemoryPartitionId,
  OttoMemoryRootId,
  OttoMemoryTenantId,
  OttoMemoryUserId,
  BotId,
  ProjectId,
  ThreadId,
  type OttoMemoryArchive,
  type OttoMemoryRevision,
} from "@otto/contracts";
import * as Effect from "effect/Effect";

import { exportOttoMemory } from "./MemoryExport.ts";
import { previewOttoMemoryImport } from "./MemoryImport.ts";

const access = {
  tenantId: OttoMemoryTenantId.make("local"),
  userId: OttoMemoryUserId.make("owner"),
  threadId: ThreadId.make("thread-import"),
  projectId: ProjectId.make("project-import"),
  workspaceRoot: "/workspace/import",
  botId: BotId.make("bot-import"),
  groupId: null,
  respondingBotId: null,
  groupMemberBotIds: [],
} as const;

const revision = {
  id: OttoMemoryId.make("revision-import"),
  rootId: OttoMemoryRootId.make("root-import"),
  revision: 1,
  partition: {
    tenantId: access.tenantId,
    scope: "bot" as const,
    partitionId: OttoMemoryPartitionId.make(access.botId),
  },
  entityKind: "bot" as const,
  entityId: OttoMemoryEntityId.make(access.botId),
  kind: "fact" as const,
  value: {},
  fact: "The imported bot uses Bun.",
  sourceThreadId: access.threadId,
  sourceMessageId: null,
  authorBotId: access.botId,
  initiatingUserId: access.userId,
  createdAt: "2026-08-30T20:00:00.000Z",
  confirmedAt: "2026-08-30T20:00:00.000Z",
  updatedAt: "2026-08-30T20:00:00.000Z",
  confidence: 1,
  approvalState: "approved" as const,
  supersedesId: null,
  supersededById: null,
  visibility: "private" as const,
  deletionState: "active" as const,
  pinned: false,
  sensitive: false,
  affectedBotIds: [access.botId],
} satisfies OttoMemoryRevision;

const archiveWithRevisions = (
  revisions: ReadonlyArray<OttoMemoryRevision>,
  target: "bot" | "all" = "bot",
  complete = true,
) => {
  const repository = {
    listByPartitions: () => Effect.succeed(revisions),
  };

  return exportOttoMemory({
    repository,
    access,
    target,
    complete,
    createdAt: "2026-08-30T21:00:00.000Z",
    conversations: [],
  });
};

const archive = (target: "bot" | "all", complete: boolean) =>
  archiveWithRevisions([revision], target, complete);

const previewRepository = {
  previewImport: () =>
    Effect.succeed({
      previewHash: "a".repeat(64),
      items: [],
    }),
};

it.effect("rejects readable V1 archives for import", () =>
  Effect.gen(function* () {
    const v1 = {
      schemaVersion: 1,
      threadId: access.threadId,
      complete: true,
      createdAt: "2026-08-30T21:00:00.000Z",
      files: [],
      manifestSha256: "a".repeat(64),
    } satisfies OttoMemoryArchive;

    const failure = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "thread",
      archive: v1,
    }).pipe(Effect.flip);

    assert.match(failure.message, /Version 1/);
  }),
);

it.effect("rejects current-state and all-authority archives", () =>
  Effect.gen(function* () {
    const currentOnly = yield* archive("bot", false);

    const incomplete = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "bot",
      archive: currentOnly,
    }).pipe(Effect.flip);

    assert.match(incomplete.message, /complete revision chain/);

    const all = yield* archive("all", true);

    const allFailure = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "all",
      archive: all,
    }).pipe(Effect.flip);

    assert.match(allFailure.message, /authority domains/);
  }),
);

it.effect("rejects target, checksum, and readable-file mismatches", () =>
  Effect.gen(function* () {
    const valid = yield* archive("bot", true);

    const targetFailure = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "project",
      archive: valid,
    }).pipe(Effect.flip);

    assert.match(targetFailure.message, /does not match/);

    if (valid.schemaVersion !== 2) return assert.fail("Expected a V2 archive.");

    const checksumFailure = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "bot",
      archive: {
        ...valid,
        files: valid.files.map((file) => ({ ...file, content: `${file.content}tampered` })),
      },
    }).pipe(Effect.flip);

    assert.match(checksumFailure.message, /checksum failed/);

    const fileMismatch = {
      ...valid,
      files: [],
    } satisfies OttoMemoryArchive;

    const mismatch = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "bot",
      archive: fileMismatch,
    }).pipe(Effect.flip);

    assert.match(mismatch.message, /manifest is invalid|do not match/);
  }),
);

it.effect("keeps pending and rejected revisions importable", () =>
  Effect.gen(function* () {
    const pendingId = OttoMemoryId.make("revision-import-pending");

    const rejected = yield* archiveWithRevisions([
      { ...revision, id: pendingId, approvalState: "pending", supersededById: revision.id },
      {
        ...revision,
        revision: 2,
        approvalState: "rejected",
        supersedesId: pendingId,
        updatedAt: "2026-08-30T20:01:00.000Z",
      },
    ]);

    const preview = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "bot",
      archive: rejected,
    });

    assert.equal(preview.previewHash, "a".repeat(64));
  }),
);

it.effect("rejects resurrected archive revisions", () =>
  Effect.gen(function* () {
    const tombstoneId = OttoMemoryId.make("revision-import-tombstone");
    const activeId = OttoMemoryId.make("revision-import-resurrected");

    const tombstone = {
      ...revision,
      id: tombstoneId,
      supersededById: activeId,
      deletionState: "tombstoned" as const,
    };

    const resurrected = {
      ...revision,
      id: activeId,
      revision: 2,
      supersedesId: tombstoneId,
      supersededById: null,
      updatedAt: "2026-08-30T20:01:00.000Z",
    };

    const resurrectedArchive = yield* archiveWithRevisions([tombstone, resurrected]);

    const resurrectedFailure = yield* previewOttoMemoryImport({
      repository: previewRepository,
      access,
      target: "bot",
      archive: resurrectedArchive,
    }).pipe(Effect.flip);

    assert.match(resurrectedFailure.message, /terminal archive revision/);
  }),
);
