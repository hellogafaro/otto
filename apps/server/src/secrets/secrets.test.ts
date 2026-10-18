import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerSecretStore from "../auth/server-secret-store.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import * as Secrets from "./secrets.ts";

const makeLayer = () =>
  Secrets.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "otto-secrets-test-" })),
  );

it.layer(NodeServices.layer)("Secrets", (it) => {
  it.effect("lists, reveals and removes one project's secrets, never another's", () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets.Secrets;

      yield* secrets.saveToProject("p1", { API_KEY: "key-one", DATABASE_URL: "postgres://one" });
      yield* secrets.saveToProject("p1-other", { API_KEY: "key-other" });

      assert.deepEqual(
        (yield* secrets.list("p1")).map((secret) => secret.name),
        ["API_KEY", "DATABASE_URL"],
      );
      assert.equal(yield* secrets.reveal("p1", "API_KEY"), "key-one");

      yield* secrets.remove("p1", "API_KEY");

      assert.deepEqual(
        (yield* secrets.list("p1")).map((secret) => secret.name),
        ["DATABASE_URL"],
      );
      assert.equal(
        (yield* Effect.flip(secrets.reveal("p1", "API_KEY"))).detail,
        "There's no secret named API_KEY.",
      );
      assert.equal(yield* secrets.reveal("p1-other", "API_KEY"), "key-other");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("stores project values sealed and keeps chat values out of the database", () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets.Secrets;
      const sql = yield* SqlClient.SqlClient;

      yield* secrets.saveToProject("p1", { API_KEY: "sk_live_project" });
      yield* secrets.saveToChat("t1", { ONE_OFF: "sk_live_chat" });

      const rows = yield* sql<{ readonly name: string; readonly encrypted_value: Uint8Array }>`
        SELECT name, encrypted_value FROM secrets
      `;

      assert.deepEqual(
        rows.map((row) => row.name),
        ["project-p1-API_KEY"],
      );
      assert.notInclude(Buffer.from(rows[0]!.encrypted_value).toString("latin1"), "sk_live");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("gives a chat its project's secrets, overridden by its own", () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets.Secrets;

      yield* secrets.saveToProject("p1", { API_KEY: "project-key", REGION: "eu" });
      yield* secrets.saveToChat("t1", { API_KEY: "chat-key" });

      assert.deepEqual(yield* secrets.environment({ projectId: "p1", threadId: "t1" }), {
        API_KEY: "chat-key",
        REGION: "eu",
      });
      assert.deepEqual(yield* secrets.environment({ projectId: "p1", threadId: "t2" }), {
        API_KEY: "project-key",
        REGION: "eu",
      });
      assert.deepEqual(yield* secrets.environment({ projectId: null, threadId: "t1" }), {
        API_KEY: "chat-key",
      });
    }).pipe(Effect.provide(makeLayer())),
  );
});

it("redacts secret values anywhere in a tool result, skipping short ones", () => {
  const result = Secrets.redactSecrets(
    { stdout: "token=sk_live_123456 ok", lines: ["sk_live_123456"], exitCode: 0, short: "eu" },
    { API_KEY: "sk_live_123456", REGION: "eu" },
  );

  assert.deepEqual(result, {
    stdout: "token=[secret API_KEY] ok",
    lines: ["[secret API_KEY]"],
    exitCode: 0,
    short: "eu",
  });
});
