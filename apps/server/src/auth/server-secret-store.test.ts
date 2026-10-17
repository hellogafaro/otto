import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import * as ServerSecretStore from "./server-secret-store.ts";

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const makeConfigLayer = () =>
  ServerConfig.layerTest(process.cwd(), { prefix: "otto-secret-store-test-" });

const makeStoreLayer = (configLayer = makeConfigLayer()) =>
  ServerSecretStore.layer.pipe(
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(configLayer),
  );

const environmentKey = (key: Uint8Array) =>
  ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: { OTTO_ENCRYPTION_KEY: Buffer.from(key).toString("base64") } }),
  );

it.layer(NodeServices.layer)("ServerSecretStore.layer", (it) => {
  it.effect("returns none for a secret that was never saved", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      assert.isTrue(Option.isNone(yield* store.get("missing-secret")));
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("keeps values in the secrets table sealed, never as plain text", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;
      const sql = yield* SqlClient.SqlClient;

      yield* store.set("composio-api-key", encoder.encode("ck_live_value"));

      const rows = yield* sql<{ readonly encrypted_value: Uint8Array }>`
        SELECT encrypted_value FROM secrets WHERE name = 'composio-api-key'
      `;

      assert.lengthOf(rows, 1);
      assert.notInclude(Buffer.from(rows[0]!.encrypted_value).toString("latin1"), "ck_live_value");
      assert.equal(
        decoder.decode(Option.getOrThrow(yield* store.get("composio-api-key"))),
        "ck_live_value",
      );
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("replaces a value on set and forgets it on remove", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      yield* store.set("token", encoder.encode("first"));
      yield* store.set("token", encoder.encode("second"));

      assert.equal(decoder.decode(Option.getOrThrow(yield* store.get("token"))), "second");

      yield* store.remove("token");

      assert.isTrue(Option.isNone(yield* store.get("token")));
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("refuses to create a secret that already exists", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      yield* store.create("once", encoder.encode("a"));

      const error = yield* Effect.flip(store.create("once", encoder.encode("b")));

      assert.instanceOf(error, ServerSecretStore.SecretStorePersistError);
      assert.equal(decoder.decode(Option.getOrThrow(yield* store.get("once"))), "a");
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("returns one value when random secrets are created concurrently", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;

      const [first, second] = yield* Effect.all(
        [
          store.getOrCreateRandom("session-signing-key", 32),
          store.getOrCreateRandom("session-signing-key", 32),
        ],
        { concurrency: "unbounded" },
      );

      const again = yield* store.getOrCreateRandom("session-signing-key", 32);

      assert.lengthOf(first, 32);
      assert.deepEqual(Array.from(second), Array.from(first));
      assert.deepEqual(Array.from(again), Array.from(first));
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("binds each sealed value to its name", () =>
    Effect.gen(function* () {
      const store = yield* ServerSecretStore.ServerSecretStore;
      const sql = yield* SqlClient.SqlClient;

      yield* store.set("real", encoder.encode("value"));
      yield* sql`
        INSERT INTO secrets (name, encrypted_value, created_at, updated_at)
        SELECT 'copied', encrypted_value, created_at, updated_at FROM secrets WHERE name = 'real'
      `;

      const error = yield* Effect.flip(store.get("copied"));

      assert.instanceOf(error, ServerSecretStore.SecretStoreDecodeError);
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("creates a private master key file once and reuses it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;

      yield* Effect.service(ServerSecretStore.ServerSecretStore);

      const keyPath = path.join(config.secretsDir, ServerSecretStore.MASTER_KEY_FILE);
      const info = yield* fileSystem.stat(keyPath);
      const key = yield* fileSystem.readFile(keyPath);

      assert.equal(Number(info.mode) & 0o777, 0o600);
      assert.lengthOf(key, 32);
    }).pipe(Effect.provide(makeStoreLayer())),
  );

  it.effect("moves secrets the file store left behind into the table", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const legacyPath = path.join(config.secretsDir, "composio-api-key.bin");

      yield* fileSystem.makeDirectory(config.secretsDir, { recursive: true });
      yield* fileSystem.writeFile(legacyPath, encoder.encode("ck_legacy"));

      const store = yield* ServerSecretStore.make;

      assert.equal(
        decoder.decode(Option.getOrThrow(yield* store.get("composio-api-key"))),
        "ck_legacy",
      );
      assert.isFalse(yield* fileSystem.exists(legacyPath));
    }).pipe(Effect.provide(Layer.merge(Layer.fresh(SqlitePersistenceMemory), makeConfigLayer()))),
  );

  it.effect("uses OTTO_ENCRYPTION_KEY and cannot read values sealed with another key", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const sql = yield* SqlClient.SqlClient;

      const first = yield* ServerSecretStore.make.pipe(
        Effect.provide(environmentKey(new Uint8Array(32).fill(1))),
      );

      yield* first.set("token", encoder.encode("sealed"));

      assert.isFalse(
        yield* fileSystem.exists(path.join(config.secretsDir, ServerSecretStore.MASTER_KEY_FILE)),
      );

      const second = yield* ServerSecretStore.make.pipe(
        Effect.provide(environmentKey(new Uint8Array(32).fill(2))),
      );

      const error = yield* Effect.flip(second.get("token"));

      assert.instanceOf(error, ServerSecretStore.SecretStoreDecodeError);

      const rows = yield* sql<{ readonly name: string }>`SELECT name FROM secrets`;

      assert.deepEqual(
        rows.map((row) => row.name),
        ["token"],
      );
    }).pipe(Effect.provide(Layer.merge(Layer.fresh(SqlitePersistenceMemory), makeConfigLayer()))),
  );
});
