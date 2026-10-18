import {
  AuthSessionId,
  BotId,
  GENERAL_PROJECT_ID,
  ProjectId,
  type ProjectListQuery,
  type WorkStatus,
} from "@otto/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import { ProjectionProjectRepositoryLive } from "../persistence/layers/projection-projects.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { ProjectionProjectRepository } from "../persistence/services/projection-projects.ts";
import { listProjects } from "./project-list.ts";

const secret = new Uint8Array(32).fill(7);

const secretStore: Pick<ServerSecretStore["Service"], "getOrCreateRandom"> = {
  getOrCreateRandom: () => Effect.succeed(secret),
};

const ada = { kind: "person" as const, personId: AuthSessionId.make("ada"), displayName: "Ada" };

const nova = { kind: "bot" as const, botId: BotId.make("nova") };

const seed = (
  id: string,
  fields: {
    readonly status: WorkStatus | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly owner?: typeof ada | typeof nova;
    readonly title?: string;
    readonly deletedAt?: string;
  },
) =>
  Effect.gen(function* () {
    const projects = yield* ProjectionProjectRepository;

    yield* projects.upsert({
      projectId: ProjectId.make(id),
      title: fields.title ?? id,
      workspaceRoot: `/work/${id}`,
      defaultModelSelection: null,
      defaultThreadEnvMode: null,
      scripts: [],
      owner: fields.owner ?? null,
      status: fields.status,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
      deletedAt: fields.deletedAt ?? null,
    });
  });

const list = (query: ProjectListQuery) =>
  Effect.gen(function* () {
    const projectionProjects = yield* ProjectionProjectRepository;

    return yield* listProjects(query, { projectionProjects, secretStore });
  });

const ids = (result: { readonly projects: ReadonlyArray<{ readonly id: string }> }) =>
  result.projects.map((project) => project.id);

const layer = it.layer(
  ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("listProjects", (it) => {
  it.effect("filters, orders and pages in SQL, never listing deleted or General", () =>
    Effect.gen(function* () {
      yield* seed(GENERAL_PROJECT_ID, {
        status: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
      });
      yield* seed("a", {
        status: "pending",
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        owner: ada,
        title: "Website",
      });
      yield* seed("b", {
        status: null,
        createdAt: "2026-09-03T00:00:00.000Z",
        updatedAt: "2026-10-02T00:00:00.000Z",
        owner: nova,
        title: "ops",
      });
      yield* seed("c", {
        status: "completed",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
        title: "Alpha",
      });
      yield* seed("d", {
        status: "archived",
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
        owner: ada,
      });
      yield* seed("e", {
        status: "in_progress",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-10-05T00:00:00.000Z",
        deletedAt: "2026-10-06T00:00:00.000Z",
      });

      const all = yield* list({});
      assert.deepStrictEqual(ids(all), ["c", "b", "a"]);
      assert.strictEqual(all.nextCursor, null);
      assert.deepStrictEqual(
        all.projects.find((project) => project.id === "b"),
        {
          id: ProjectId.make("b"),
          title: "ops",
          owner: nova,
          status: "in_progress",
          coverFileId: null,
          createdAt: "2026-09-03T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
        },
      );

      assert.deepStrictEqual(ids(yield* list({ status: ["archived"] })), ["d"]);
      assert.deepStrictEqual(ids(yield* list({ status: ["in_progress"] })), ["b"]);
      assert.deepStrictEqual(ids(yield* list({ status: ["pending", "archived"] })), ["d", "a"]);
      assert.deepStrictEqual(ids(yield* list({ owner: "person:ada" })), ["a"]);
      assert.deepStrictEqual(ids(yield* list({ owner: "bot:nova" })), ["b"]);
      assert.deepStrictEqual(ids(yield* list({ owner: "person:ada", status: ["archived"] })), [
        "d",
      ]);
      assert.deepStrictEqual(ids(yield* list({ sort: "updated", order: "asc" })), ["a", "b", "c"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "created" })), ["a", "b", "c"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "title" })), ["c", "b", "a"]);
      assert.deepStrictEqual(ids(yield* list({ sort: "title", order: "desc" })), ["a", "b", "c"]);

      const pages: string[][] = [];
      let cursor: string | undefined;

      do {
        const page = yield* list({ sort: "title", limit: 1, ...(cursor ? { cursor } : {}) });
        pages.push(ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      assert.deepStrictEqual(pages, [["c"], ["b"], ["a"]]);
    }),
  );

  it.effect("refuses a cursor from another view or a forged one", () =>
    Effect.gen(function* () {
      const first = yield* list({ limit: 1 });
      const cursor = first.nextCursor;
      assert.isNotNull(cursor);

      const otherView = yield* Effect.flip(list({ sort: "title", limit: 1, cursor: cursor! }));
      assert.strictEqual(otherView._tag, "ProjectListError");

      const otherFilter = yield* Effect.flip(
        list({ status: ["archived"], limit: 1, cursor: cursor! }),
      );

      assert.strictEqual(otherFilter._tag, "ProjectListError");

      const forged = yield* Effect.flip(list({ limit: 1, cursor: "x".repeat(60) }));
      assert.strictEqual(forged._tag, "ProjectListError");
    }),
  );
});
