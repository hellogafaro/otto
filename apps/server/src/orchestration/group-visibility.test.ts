import {
  AuthSessionId,
  canSeeBot,
  CommandId,
  ProjectId,
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

import {
  canSeeGroup,
  commandBotIds,
  visibleShellSnapshot,
  withGroupVisibility,
} from "./group-visibility.ts";
import {
  makeBot,
  makeGroup,
  makeGroupThread,
  BOSS_ID,
  SPECIALIST_ID,
} from "./test-support/group-decider-fixtures.ts";

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
  expect(visibleShellSnapshot(snapshotWith(anaGroup), BEN)).toMatchObject({
    groups: [],
    threads: [],
  });
  expect(visibleShellSnapshot(snapshotWith(anaGroup), ANA).threads).toHaveLength(1);
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
      loadLibraryFolders: Effect.succeed([]),
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

const openFolder: LibraryFolder = {
  id: LibraryFolderId.make("open-folder"),
  parentId: null,
  title: "Open",
  visibility: "organization",
  createdBy: ana,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedBy: ana,
  updatedAt: "2026-10-13T00:00:00.000Z",
};

const deliveredTo = (
  personId: AuthSessionId,
  items: ReadonlyArray<OrchestrationShellStreamItem>,
  folders: ReadonlyArray<LibraryFolder> = [chatFolder],
) =>
  withGroupVisibility({
    stream: Stream.fromIterable<OrchestrationShellStreamItem>([
      { kind: "snapshot", snapshot: snapshotWith(anaGroup) },
      ...items,
    ]),
    personId,
    loadSnapshot: Effect.succeed(snapshotWith(anaGroup)),
    loadChatThreads: Effect.succeed(chatThreads),
    loadLibraryFolders: Effect.succeed(folders),
    resuming: false,
  }).pipe(Effect.flatMap(Stream.runCollect));

it.effect("turns a Library file someone can't see into a removal", () =>
  Effect.gen(function* () {
    const hidden = libraryFile({ id: LibraryFileId.make("in-chat"), folderId: chatFolder.id });

    const delivered = yield* deliveredTo(BEN, [
      { kind: "library-file-upserted", sequence: 2, file: hidden },
      { kind: "library-file-upserted", sequence: 3, file: libraryFile({}) },
    ]);

    expect(delivered.map((item) => item.kind)).toEqual([
      "snapshot",
      "library-file-removed",
      "library-file-upserted",
    ]);
    expect(delivered[0]?.kind === "snapshot" && "libraryFiles" in delivered[0].snapshot).toBe(
      false,
    );
  }),
);

it.effect("sends a Library folder only to people who see it, and its removal once they stop", () =>
  Effect.gen(function* () {
    const items: ReadonlyArray<OrchestrationShellStreamItem> = [
      { kind: "library-folder-upserted", sequence: 2, folder: chatFolder },
      { kind: "library-folder-upserted", sequence: 3, folder: openFolder },
      {
        kind: "library-folder-upserted",
        sequence: 4,
        folder: { ...openFolder, visibility: "user" },
      },
      { kind: "library-folder-removed", sequence: 5, folderId: openFolder.id },
    ];

    const kinds = (delivered: ReadonlyArray<OrchestrationShellStreamItem>) =>
      delivered.map((item) => item.kind);

    expect(kinds(yield* deliveredTo(BEN, items))).toEqual([
      "snapshot",
      "library-folder-upserted",
      "library-folder-removed",
      "library-folder-removed",
    ]);
    expect(kinds(yield* deliveredTo(ANA, items))).toEqual([
      "snapshot",
      "library-folder-upserted",
      "library-folder-upserted",
      "library-folder-upserted",
      "library-folder-removed",
    ]);
  }),
);

it.effect("hides a Library file under a folder that just turned private", () =>
  Effect.gen(function* () {
    const delivered = yield* deliveredTo(
      BEN,
      [
        {
          kind: "library-folder-upserted",
          sequence: 2,
          folder: { ...openFolder, visibility: "user" },
        },
        {
          kind: "library-file-upserted",
          sequence: 3,
          file: libraryFile({ folderId: openFolder.id }),
        },
      ],
      [chatFolder, openFolder],
    );

    expect(delivered.map((item) => item.kind)).toEqual([
      "snapshot",
      "library-folder-removed",
      "library-file-removed",
    ]);
  }),
);

const privateBot = {
  ...makeBot({ id: SPECIALIST_ID }),
  owner: ana,
  visibility: "user" as const,
};

const botSnapshot = (groups: ReadonlyArray<OrchestrationGroup>): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [],
  bots: [privateBot],
  groups: [...groups],
  delegations: [],
  threads: [],
  updatedAt: "2026-10-13T00:00:00.000Z",
});

it("shows a private bot only to its owner and the people in its groups", () => {
  expect(canSeeBot(privateBot, [], ANA)).toBe(true);
  expect(canSeeBot(privateBot, [], BEN)).toBe(false);
  expect(canSeeBot({ ...privateBot, visibility: "organization" }, [], BEN)).toBe(true);
  expect(canSeeBot({ ...privateBot, owner: null }, [], BEN)).toBe(true);

  const shared = makeGroup({
    members: [
      { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
      { kind: "person", personId: BEN, displayName: "Ben" },
    ],
  });

  expect(canSeeBot(privateBot, [shared], BEN)).toBe(true);
  expect(visibleShellSnapshot(botSnapshot([]), BEN).bots).toEqual([]);
  expect(visibleShellSnapshot(botSnapshot([]), ANA).bots).toHaveLength(1);
});

it.effect("removes a bot from everyone else's stream when it is made private", () =>
  Effect.gen(function* () {
    const items: ReadonlyArray<OrchestrationShellStreamItem> = [
      { kind: "snapshot", snapshot: { ...botSnapshot([]), bots: [] } },
      { kind: "bot-upserted", sequence: 2, bot: { ...privateBot, visibility: "organization" } },
      { kind: "bot-upserted", sequence: 3, bot: privateBot },
    ];

    const stream = yield* withGroupVisibility({
      stream: Stream.fromIterable(items),
      personId: BEN,
      loadSnapshot: Effect.succeed(botSnapshot([])),
      loadChatThreads: Effect.succeed([]),
      loadLibraryFolders: Effect.succeed([]),
      resuming: false,
    });

    const delivered = yield* Stream.runCollect(stream);

    expect(delivered.map((item) => item.kind)).toEqual(["snapshot", "bot-upserted", "bot-removed"]);
  }),
);

it.effect("hides a private bot that a resuming client still holds", () =>
  Effect.gen(function* () {
    const stream = yield* withGroupVisibility({
      stream: Stream.empty,
      personId: BEN,
      loadSnapshot: Effect.succeed(botSnapshot([])),
      loadChatThreads: Effect.succeed([]),
      loadLibraryFolders: Effect.succeed([]),
      resuming: true,
    });

    const delivered = yield* Stream.runCollect(stream);

    expect(delivered[0]?.kind === "snapshot" && delivered[0].snapshot.bots).toEqual([]);
  }),
);

it("names the bots a command addresses", () => {
  const commandId = CommandId.make("command-1");

  expect(commandBotIds({ type: "bot.update", commandId, botId: SPECIALIST_ID })).toEqual([
    SPECIALIST_ID,
  ]);
  expect(commandBotIds({ type: "bot.archive", commandId, botId: BOSS_ID })).toEqual([BOSS_ID]);
  expect(
    commandBotIds({ type: "project.delete", commandId, projectId: ProjectId.make("project-1") }),
  ).toEqual([]);
});
