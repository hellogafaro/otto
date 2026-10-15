import {
  AuthSessionId,
  type LibraryFile,
  LibraryFileId,
  type LibraryFolder,
  LibraryFolderId,
  type OrchestrationGroup,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { canSeeGroup, visibleShellSnapshot, withGroupVisibility } from "./group-visibility.ts";
import { makeGroup, makeGroupThread, BOSS_ID } from "./test-support/group-decider-fixtures.ts";

const ANA = AuthSessionId.make("user-ana");

const BEN = AuthSessionId.make("user-ben");

const anaGroup: OrchestrationGroup = makeGroup({
  members: [
    { kind: "bot", botId: BOSS_ID, role: "boss" },
    { kind: "person", personId: ANA, displayName: "Ana" },
  ],
});

const snapshotWith = (group: OrchestrationGroup): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [],
  bots: [],
  groups: [group],
  delegations: [],
  threads: [{ ...makeGroupThread(), session: null } as never],
  updatedAt: "2026-10-13T00:00:00.000Z",
});

it("shows a group only to its people, and a group with no people to everyone", () => {
  expect(canSeeGroup(anaGroup, ANA)).toBe(true);
  expect(canSeeGroup(anaGroup, BEN)).toBe(false);
  expect(canSeeGroup(makeGroup({ members: [] }), BEN)).toBe(true);
});

it("drops a hidden group's chats from the shell", () => {
  expect(visibleShellSnapshot(snapshotWith(anaGroup), BEN, [])).toMatchObject({
    groups: [],
    threads: [],
  });
  expect(visibleShellSnapshot(snapshotWith(anaGroup), ANA, []).threads).toHaveLength(1);
});

it.effect("sends a fresh shell when a person is added to a group", () =>
  Effect.gen(function* () {
    let current = snapshotWith(anaGroup);

    const withBen = makeGroup({
      members: [...anaGroup.members, { kind: "person", personId: BEN, displayName: "Ben" }],
    });

    const items: ReadonlyArray<OrchestrationShellStreamItem> = [
      { kind: "snapshot", snapshot: current },
      { kind: "thread-upserted", sequence: 2, thread: current.threads[0]! },
      { kind: "group-upserted", sequence: 3, group: withBen },
    ];

    const stream = yield* withGroupVisibility({
      stream: Stream.fromIterable(items).pipe(
        Stream.tap((item) =>
          Effect.sync(() => {
            if (item.kind === "group-upserted") current = snapshotWith(withBen);
          }),
        ),
      ),
      personId: BEN,
      loadSnapshot: Effect.sync(() => current),
      loadChatThreads: Effect.succeed([]),
      resuming: false,
    });

    const delivered = yield* Stream.runCollect(stream);

    expect(delivered.map((item) => item.kind)).toEqual(["snapshot", "snapshot"]);
    expect(delivered[0]?.kind === "snapshot" && delivered[0].snapshot.groups).toEqual([]);
    expect(delivered[1]?.kind === "snapshot" && delivered[1].snapshot.threads).toHaveLength(1);
  }),
);

const ana = { kind: "person" as const, personId: ANA, displayName: "Ana" };

const chatFolder: LibraryFolder = {
  id: LibraryFolderId.make("chat-folder"),
  parentId: null,
  threadId: makeGroupThread().id,
  title: "Crew",
  visibility: "organization",
  createdBy: ana,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedBy: ana,
  updatedAt: "2026-10-13T00:00:00.000Z",
};

const libraryFile = (overrides: Partial<LibraryFile>): LibraryFile => ({
  id: LibraryFileId.make("file"),
  folderId: null,
  type: "image",
  title: "Picture",
  extension: "png",
  sizeBytes: 10,
  visibility: "organization",
  createdBy: ana,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedBy: ana,
  updatedAt: "2026-10-13T00:00:00.000Z",
  ...overrides,
});

const chatThreads = [{ id: makeGroupThread().id, groupId: anaGroup.id, deletedAt: null }];

it("shows Library items only to the people who may see them", () => {
  const snapshot: OrchestrationShellSnapshot = {
    ...snapshotWith(anaGroup),
    libraryFolders: [chatFolder],
    libraryFiles: [
      libraryFile({ id: LibraryFileId.make("open") }),
      libraryFile({ id: LibraryFileId.make("private"), visibility: "user" }),
      libraryFile({ id: LibraryFileId.make("in-chat"), folderId: chatFolder.id }),
    ],
  };

  expect(
    visibleShellSnapshot(snapshot, BEN, chatThreads).libraryFiles?.map((file) => file.id),
  ).toEqual(["open"]);
  expect(visibleShellSnapshot(snapshot, BEN, chatThreads).libraryFolders).toEqual([]);
  expect(visibleShellSnapshot(snapshot, ANA, chatThreads).libraryFiles).toHaveLength(3);
});

it.effect("turns a Library file someone can't see into a removal", () =>
  Effect.gen(function* () {
    const snapshot = { ...snapshotWith(anaGroup), libraryFolders: [chatFolder], libraryFiles: [] };

    const hidden = libraryFile({ id: LibraryFileId.make("in-chat"), folderId: chatFolder.id });

    const stream = yield* withGroupVisibility({
      stream: Stream.fromIterable<OrchestrationShellStreamItem>([
        { kind: "snapshot", snapshot },
        { kind: "library-file-upserted", sequence: 2, file: hidden },
        { kind: "library-file-upserted", sequence: 3, file: libraryFile({}) },
      ]),
      personId: BEN,
      loadSnapshot: Effect.succeed(snapshot),
      loadChatThreads: Effect.succeed(chatThreads),
      resuming: false,
    });

    const delivered = yield* Stream.runCollect(stream);

    expect(delivered.map((item) => item.kind)).toEqual([
      "snapshot",
      "library-file-removed",
      "library-file-upserted",
    ]);
  }),
);
