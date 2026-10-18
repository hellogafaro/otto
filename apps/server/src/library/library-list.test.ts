import {
  AuthSessionId,
  BotId,
  canSeeLibraryItem,
  GroupId,
  type GroupMembership,
  type LibraryFile,
  LibraryFileId,
  type LibraryFileType,
  type LibraryFolder,
  LibraryFolderId,
  type LibraryListQuery,
  type LibraryViewer,
  ThreadId,
  type Visibility,
  type WorkParticipant,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { ProjectionLibraryRepositoryLive } from "../persistence/layers/projection-library.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { ProjectionLibraryRepository } from "../persistence/services/projection-library.ts";
import { listLibrary } from "./library-list.ts";

const secret = new Uint8Array(32).fill(7);

const secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom"> = {
  getOrCreateRandom: () => Effect.succeed(secret),
};

const adaId = AuthSessionId.make("ada");

const bobId = AuthSessionId.make("bob");

const ada: WorkParticipant = { kind: "person", personId: adaId, displayName: "Ada" };

const bob: WorkParticipant = { kind: "person", personId: bobId, displayName: "Bob" };

const nova: WorkParticipant = { kind: "bot", botId: BotId.make("nova") };

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const folder = (
  id: string,
  fields: {
    readonly day: number;
    readonly parent?: string;
    readonly by?: WorkParticipant;
    readonly visibility?: Visibility;
    readonly thread?: string;
  },
): LibraryFolder => ({
  id: LibraryFolderId.make(id),
  parentId: fields.parent === undefined ? null : LibraryFolderId.make(fields.parent),
  ...(fields.thread === undefined ? {} : { threadId: ThreadId.make(fields.thread) }),
  title: id,
  visibility: fields.visibility ?? "organization",
  createdBy: fields.by ?? bob,
  createdAt: at(fields.day),
  updatedBy: fields.by ?? bob,
  updatedAt: at(fields.day),
});

const file = (
  id: string,
  fields: {
    readonly day: number;
    readonly folder?: string;
    readonly type?: LibraryFileType;
    readonly by?: WorkParticipant;
    readonly visibility?: Visibility;
    readonly title?: string;
  },
): LibraryFile => ({
  id: LibraryFileId.make(id),
  folderId: fields.folder === undefined ? null : LibraryFolderId.make(fields.folder),
  type: fields.type ?? "file",
  title: fields.title ?? id,
  extension: "txt",
  sizeBytes: 1,
  visibility: fields.visibility ?? "organization",
  createdBy: fields.by ?? bob,
  createdAt: at(fields.day),
  updatedBy: fields.by ?? bob,
  updatedAt: at(fields.day),
});

const FOLDERS = [
  folder("pub", { day: 1 }),
  folder("mine", { day: 2, by: ada, visibility: "user" }),
  folder("bobs", { day: 3, visibility: "user" }),
  folder("inside-bobs", { day: 4, parent: "bobs" }),
  folder("chats", { day: 5 }),
  folder("dm-private", { day: 6, parent: "chats", thread: "dm-private" }),
  folder("dm-shared", { day: 7, parent: "chats", thread: "dm-shared" }),
  folder("group-without-ada", { day: 8, parent: "chats", thread: "group-without-ada" }),
  folder("group-with-ada", { day: 9, parent: "chats", thread: "group-with-ada" }),
  folder("bots-only-group", { day: 10, parent: "chats", thread: "bots-only-group" }),
  folder("deleted-adas", { day: 11, parent: "chats", thread: "deleted", by: ada }),
  folder("deleted-bobs", { day: 12, parent: "chats", thread: "deleted" }),
  folder("missing-group", { day: 13, parent: "chats", thread: "missing-group" }),
  folder("missing-thread", { day: 14, parent: "chats", thread: "missing-thread" }),
];

const FILES = [
  file("doc", { day: 15, type: "document", title: "Beta" }),
  file("image", { day: 16, type: "image", by: nova, title: "alpha" }),
  file("pdf", { day: 17, type: "pdf", by: ada, title: "Gamma" }),
  file("adas-private", { day: 18, by: ada, visibility: "user" }),
  file("bobs-private", { day: 19, visibility: "user" }),
  file("in-bobs", { day: 20, folder: "inside-bobs" }),
  file("in-pub", { day: 21, folder: "pub", type: "document" }),
  file("in-dm-private", { day: 22, folder: "dm-private" }),
  file("in-group-with-ada", { day: 23, folder: "group-with-ada" }),
];

const THREADS = [
  { id: "dm-private", visibility: "user", createdBy: "bob" },
  { id: "dm-shared", visibility: "organization", createdBy: "bob" },
  { id: "group-without-ada", group: "without-ada" },
  { id: "group-with-ada", group: "with-ada" },
  { id: "bots-only-group", group: "bots-only" },
  { id: "deleted", deletedAt: at(30) },
  { id: "missing-group", group: "gone" },
] as const;

const novaBoss: GroupMembership = { kind: "bot", botId: BotId.make("nova"), role: "boss" };

const GROUPS: ReadonlyArray<{
  readonly id: GroupId;
  readonly members: ReadonlyArray<GroupMembership>;
}> = [
  {
    id: GroupId.make("without-ada"),
    members: [{ kind: "person", personId: bobId, displayName: "Bob" }],
  },
  {
    id: GroupId.make("with-ada"),
    members: [{ kind: "person", personId: adaId, displayName: "Ada" }, novaBoss],
  },
  { id: GroupId.make("bots-only"), members: [novaBoss] },
];

const seed = Effect.gen(function* () {
  const library = yield* ProjectionLibraryRepository;
  const sql = yield* SqlClient.SqlClient;

  for (const item of FOLDERS) yield* library.upsertFolder(item);

  for (const item of FILES) yield* library.upsertFile(item);

  for (const thread of THREADS) {
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, created_at, updated_at, deleted_at, group_id, created_by,
        visibility
      )
      VALUES (
        ${thread.id}, 'launch', ${thread.id}, ${at(1)}, ${at(1)},
        ${"deletedAt" in thread ? thread.deletedAt : null},
        ${"group" in thread ? thread.group : null},
        ${"createdBy" in thread ? thread.createdBy : null},
        ${"visibility" in thread ? thread.visibility : "organization"}
      )
    `;
  }

  for (const group of GROUPS) {
    yield* sql`
      INSERT INTO projection_groups (group_id, name, created_at, updated_at, members_json)
      VALUES (${group.id}, ${group.id}, ${at(1)}, ${at(1)}, ${JSON.stringify(group.members)})
    `;
  }
});

const list = (query: LibraryListQuery, personId = adaId) =>
  Effect.gen(function* () {
    const projectionLibrary = yield* ProjectionLibraryRepository;

    return yield* listLibrary(query, personId, { projectionLibrary, secretStore });
  });

const ids = (result: {
  readonly items: ReadonlyArray<
    | { readonly kind: "folder"; readonly folder: { readonly id: string } }
    | { readonly kind: "file"; readonly file: { readonly id: string } }
  >;
}) => result.items.map((item) => (item.kind === "folder" ? item.folder.id : item.file.id));

const layer = it.layer(
  ProjectionLibraryRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("listLibrary", (it) => {
  it.effect("shows each person exactly what the Library's visibility rules let them see", () =>
    Effect.gen(function* () {
      yield* seed;
      const library = yield* ProjectionLibraryRepository;

      const context = {
        folders: yield* library.listFolders(),
        threads: yield* library.listChatThreads(),
        groups: GROUPS,
      };

      for (const personId of [adaId, bobId]) {
        const viewer: LibraryViewer = { kind: "person", personId };

        const expected = [
          ...context.folders.filter((item) => canSeeLibraryItem(item, context, viewer)),
          ...(yield* library.listFiles()).filter((item) =>
            canSeeLibraryItem(item, context, viewer),
          ),
        ]
          .map((item) => item.id as string)
          .toSorted();

        const everywhere = yield* list({ everywhere: true }, personId);
        assert.deepStrictEqual(ids(everywhere).toSorted(), expected);
      }

      assert.deepStrictEqual(ids(yield* list({ folder: LibraryFolderId.make("chats") })), [
        "deleted-adas",
        "bots-only-group",
        "group-with-ada",
        "dm-shared",
      ]);

      assert.deepStrictEqual(ids(yield* list({ folder: LibraryFolderId.make("bobs") })), []);
      assert.deepStrictEqual(ids(yield* list({ folder: LibraryFolderId.make("inside-bobs") })), []);

      assert.deepStrictEqual(
        ids(yield* list({ folder: LibraryFolderId.make("inside-bobs") }, bobId)),
        ["in-bobs"],
      );
    }),
  );

  it.effect("filters, orders and pages in SQL with folders first", () =>
    Effect.gen(function* () {
      const root = yield* list({});
      assert.deepStrictEqual(ids(root), [
        "chats",
        "mine",
        "pub",
        "adas-private",
        "pdf",
        "image",
        "doc",
      ]);
      assert.strictEqual(root.nextCursor, null);

      assert.deepStrictEqual(ids(yield* list({ type: ["document", "image"] })), ["image", "doc"]);
      assert.deepStrictEqual(ids(yield* list({ type: ["file"] })), ["adas-private", "pdf"]);
      assert.deepStrictEqual(ids(yield* list({ type: ["folder"] })), ["chats", "mine", "pub"]);
      assert.deepStrictEqual(ids(yield* list({ creator: "person:ada" })), [
        "mine",
        "adas-private",
        "pdf",
      ]);
      assert.deepStrictEqual(ids(yield* list({ creator: "bot:nova" })), ["image"]);
      assert.deepStrictEqual(ids(yield* list({ everywhere: true, type: ["document"] })), [
        "in-pub",
        "doc",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "updated", order: "asc" })), [
        "pub",
        "mine",
        "chats",
        "doc",
        "image",
        "pdf",
        "adas-private",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "title" })), [
        "chats",
        "mine",
        "pub",
        "adas-private",
        "image",
        "doc",
        "pdf",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "created", order: "asc" })), [
        "pub",
        "mine",
        "chats",
        "doc",
        "image",
        "pdf",
        "adas-private",
      ]);

      const pages: string[][] = [];
      let cursor: string | undefined;

      do {
        const page = yield* list({ limit: 2, ...(cursor ? { cursor } : {}) });
        pages.push(ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      assert.deepStrictEqual(pages, [
        ["chats", "mine"],
        ["pub", "adas-private"],
        ["pdf", "image"],
        ["doc"],
      ]);
    }),
  );

  it.effect("refuses a cursor from another view, another person or a forged one", () =>
    Effect.gen(function* () {
      const first = yield* list({ limit: 1 });
      const cursor = first.nextCursor;
      assert.isNotNull(cursor);

      const otherView = yield* Effect.flip(list({ sort: "title", limit: 1, cursor: cursor! }));
      assert.strictEqual(otherView._tag, "LibraryListError");

      const otherPerson = yield* Effect.flip(list({ limit: 1, cursor: cursor! }, bobId));
      assert.strictEqual(otherPerson._tag, "LibraryListError");

      const forged = yield* Effect.flip(list({ limit: 1, cursor: "x".repeat(60) }));
      assert.strictEqual(forged._tag, "LibraryListError");
    }),
  );
});
