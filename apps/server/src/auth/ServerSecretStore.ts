import * as Context from "effect/Context";
import * as NodeCrypto from "node:crypto";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";

const secretStoreErrorContext = {
  resource: Schema.String,
  cause: Schema.Defect(),
};

export class SecretStoreSecureError extends Schema.TaggedErrorClass<SecretStoreSecureError>()(
  "SecretStoreSecureError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to secure ${this.resource}.`;
  }
}

export class SecretStoreReadError extends Schema.TaggedErrorClass<SecretStoreReadError>()(
  "SecretStoreReadError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource}.`;
  }
}

export class SecretStorePersistError extends Schema.TaggedErrorClass<SecretStorePersistError>()(
  "SecretStorePersistError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to persist ${this.resource}.`;
  }
}

export class SecretStoreRandomGenerationError extends Schema.TaggedErrorClass<SecretStoreRandomGenerationError>()(
  "SecretStoreRandomGenerationError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to generate random bytes for ${this.resource}.`;
  }
}

export class SecretStoreConcurrentReadError extends Schema.TaggedErrorClass<SecretStoreConcurrentReadError>()(
  "SecretStoreConcurrentReadError",
  {
    resource: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource} after concurrent creation.`;
  }
}

export class SecretStoreRemoveError extends Schema.TaggedErrorClass<SecretStoreRemoveError>()(
  "SecretStoreRemoveError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to remove ${this.resource}.`;
  }
}

export class SecretStoreDecodeError extends Schema.TaggedErrorClass<SecretStoreDecodeError>()(
  "SecretStoreDecodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to decode ${this.resource}.`;
  }
}

export class SecretStoreEncodeError extends Schema.TaggedErrorClass<SecretStoreEncodeError>()(
  "SecretStoreEncodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to encode ${this.resource}.`;
  }
}

export const SecretStoreError = Schema.Union([
  SecretStoreSecureError,
  SecretStoreReadError,
  SecretStorePersistError,
  SecretStoreRandomGenerationError,
  SecretStoreConcurrentReadError,
  SecretStoreRemoveError,
  SecretStoreDecodeError,
  SecretStoreEncodeError,
]);

export type SecretStoreError = typeof SecretStoreError.Type;

export const isSecretStoreError = Schema.is(SecretStoreError);

export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    readonly get: (name: string) => Effect.Effect<Option.Option<Uint8Array>, SecretStoreError>;
    readonly set: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly create: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
    readonly remove: (name: string) => Effect.Effect<void, SecretStoreError>;
  }
>()("@otto/server/auth/ServerSecretStore") {}

/** The master key file, used when `OTTO_SECRETS_KEY` is not set. */
export const MASTER_KEY_FILE = "master.key";

const MASTER_KEY_BYTES = 32;

const ENVELOPE_VERSION = 1;

const IV_BYTES = 12;

const TAG_BYTES = 16;

const masterKeyFromEnvironment = Config.redacted("OTTO_SECRETS_KEY").pipe(Config.option);

/** Seals one value as version, IV, auth tag, then ciphertext, bound to its secret name. */
function seal(key: Uint8Array, name: string, value: Uint8Array): Uint8Array {
  const iv = NodeCrypto.randomBytes(IV_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);

  cipher.setAAD(Buffer.from(name, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);

  return Uint8Array.from(
    Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, cipher.getAuthTag(), ciphertext]),
  );
}

function open(key: Uint8Array, name: string, envelope: Uint8Array): Uint8Array {
  const bytes = Buffer.from(envelope);

  if (bytes[0] !== ENVELOPE_VERSION)
    throw new Error(`Unknown secret envelope version ${bytes[0]}.`);
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(tag);

  return Uint8Array.from(
    Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]),
  );
}

/**
 * Every secret lives in the `secrets` table, sealed with AES-256-GCM. The master key comes
 * from `OTTO_SECRETS_KEY` (base64, 32 bytes) for hosted installs, otherwise from a key file
 * created once in the secrets directory. Secrets the file store kept as `<name>.bin` move
 * into the table the first time the store starts.
 */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const sql = yield* SqlClient.SqlClient;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreSecureError({
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  const keyPath = path.join(serverConfig.secretsDir, MASTER_KEY_FILE);

  const readKeyFile: Effect.Effect<Option.Option<Uint8Array>, SecretStoreReadError> = fileSystem
    .readFile(keyPath)
    .pipe(
      Effect.map((bytes): Option.Option<Uint8Array> => Option.some(Uint8Array.from(bytes))),
      Effect.catch((cause) =>
        Predicate.isTagged(cause.reason, "NotFound")
          ? Effect.succeed(Option.none<Uint8Array>())
          : Effect.fail(new SecretStoreReadError({ resource: "the master key", cause })),
      ),
    );

  const requireKey = (key: Option.Option<Uint8Array>) =>
    Option.isSome(key)
      ? Effect.succeed(key.value)
      : Effect.fail(new SecretStoreConcurrentReadError({ resource: "the master key" }));

  const createKeyFile: Effect.Effect<Uint8Array, SecretStoreError> = Effect.scoped(
    Effect.gen(function* () {
      const generated = Uint8Array.from(NodeCrypto.randomBytes(MASTER_KEY_BYTES));
      const file = yield* fileSystem.open(keyPath, { flag: "wx", mode: 0o600 });

      yield* file.writeAll(generated);
      yield* file.sync;

      return generated;
    }),
  ).pipe(
    Effect.catch(
      (cause): Effect.Effect<Uint8Array, SecretStoreError> =>
        Predicate.isTagged(cause.reason, "AlreadyExists")
          ? readKeyFile.pipe(Effect.flatMap(requireKey))
          : Effect.fail(new SecretStorePersistError({ resource: "the master key", cause })),
    ),
  );

  const environmentKey = yield* masterKeyFromEnvironment.pipe(
    Effect.mapError((cause) => new SecretStoreDecodeError({ resource: "OTTO_SECRETS_KEY", cause })),
  );

  const masterKey: Uint8Array = Option.isSome(environmentKey)
    ? Uint8Array.from(Buffer.from(Redacted.value(environmentKey.value), "base64"))
    : yield* readKeyFile.pipe(
        Effect.flatMap(
          Option.match({
            onSome: (key): Effect.Effect<Uint8Array, SecretStoreError> => Effect.succeed(key),
            onNone: () => createKeyFile,
          }),
        ),
      );

  if (masterKey.length !== MASTER_KEY_BYTES) {
    return yield* new SecretStoreDecodeError({
      resource: "the master key",
      cause: new Error(`The master key must be ${MASTER_KEY_BYTES} bytes.`),
    });
  }

  const sealValue = (name: string, value: Uint8Array) =>
    Effect.try({
      try: () => seal(masterKey, name, value),
      catch: (cause) => new SecretStoreEncodeError({ resource: `secret ${name}`, cause }),
    });

  const upsert = (name: string, value: Uint8Array) =>
    sealValue(name, value).pipe(
      Effect.flatMap(
        (sealed) => sql`
          INSERT INTO secrets (name, encrypted_value, created_at, updated_at)
          VALUES (
            ${name},
            ${sealed},
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
          ON CONFLICT (name) DO UPDATE SET
            encrypted_value = excluded.encrypted_value,
            updated_at = excluded.updated_at
        `,
      ),
      Effect.asVoid,
    );

  const insertIfMissing = (name: string, value: Uint8Array) =>
    sealValue(name, value).pipe(
      Effect.flatMap(
        (sealed) => sql<{ readonly name: string }>`
          INSERT INTO secrets (name, encrypted_value, created_at, updated_at)
          VALUES (
            ${name},
            ${sealed},
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
          ON CONFLICT (name) DO NOTHING
          RETURNING name
        `,
      ),
      Effect.map((rows) => rows.length > 0),
    );

  const get: ServerSecretStore["Service"]["get"] = (name) =>
    sql<{ readonly encrypted_value: Uint8Array }>`
      SELECT encrypted_value FROM secrets WHERE name = ${name}
    `.pipe(
      Effect.mapError((cause) => new SecretStoreReadError({ resource: `secret ${name}`, cause })),
      Effect.flatMap((rows) => {
        const row = rows[0];

        if (!row) return Effect.succeed(Option.none<Uint8Array>());

        return Effect.try({
          try: () => Option.some(open(masterKey, name, row.encrypted_value)),
          catch: (cause) => new SecretStoreDecodeError({ resource: `secret ${name}`, cause }),
        });
      }),
      Effect.withSpan("ServerSecretStore.get"),
    );

  const set: ServerSecretStore["Service"]["set"] = (name, value) =>
    upsert(name, value).pipe(
      Effect.mapError((cause) =>
        isSecretStoreError(cause)
          ? cause
          : new SecretStorePersistError({ resource: `secret ${name}`, cause }),
      ),
      Effect.withSpan("ServerSecretStore.set"),
    );

  const create: ServerSecretStore["Service"]["create"] = (name, value) =>
    insertIfMissing(name, value).pipe(
      Effect.mapError((cause) =>
        isSecretStoreError(cause)
          ? cause
          : new SecretStorePersistError({ resource: `secret ${name}`, cause }),
      ),
      Effect.flatMap((inserted) =>
        inserted
          ? Effect.void
          : Effect.fail(
              new SecretStorePersistError({
                resource: `secret ${name}`,
                cause: new Error("The secret already exists."),
              }),
            ),
      ),
      Effect.withSpan("ServerSecretStore.create"),
    );

  const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            Effect.try({
              try: () => Uint8Array.from(NodeCrypto.randomBytes(bytes)),
              catch: (cause) =>
                new SecretStoreRandomGenerationError({ resource: `secret ${name}`, cause }),
            }).pipe(
              Effect.flatMap((generated) =>
                insertIfMissing(name, generated).pipe(
                  Effect.mapError((cause) =>
                    isSecretStoreError(cause)
                      ? cause
                      : new SecretStorePersistError({ resource: `secret ${name}`, cause }),
                  ),
                ),
              ),
              Effect.flatMap(() => get(name)),
              Effect.flatMap(
                Option.match({
                  onSome: Effect.succeed,
                  onNone: () =>
                    Effect.fail(new SecretStoreConcurrentReadError({ resource: `secret ${name}` })),
                }),
              ),
            ),
        }),
      ),
      Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
    );

  const remove: ServerSecretStore["Service"]["remove"] = (name) =>
    sql`DELETE FROM secrets WHERE name = ${name}`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new SecretStoreRemoveError({ resource: `secret ${name}`, cause })),
      Effect.withSpan("ServerSecretStore.remove"),
    );

  const legacyFiles = yield* fileSystem.readDirectory(serverConfig.secretsDir).pipe(
    Effect.map((entries) => entries.filter((entry) => entry.endsWith(".bin"))),
    Effect.mapError(
      (cause) =>
        new SecretStoreReadError({
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  yield* Effect.forEach(
    legacyFiles,
    (entry) => {
      const name = entry.slice(0, -".bin".length);
      const filePath = path.join(serverConfig.secretsDir, entry);

      return fileSystem.readFile(filePath).pipe(
        Effect.mapError((cause) => new SecretStoreReadError({ resource: `secret ${name}`, cause })),
        Effect.flatMap((bytes) =>
          insertIfMissing(name, Uint8Array.from(bytes)).pipe(
            Effect.mapError((cause) =>
              isSecretStoreError(cause)
                ? cause
                : new SecretStorePersistError({ resource: `secret ${name}`, cause }),
            ),
          ),
        ),
        Effect.flatMap(() =>
          fileSystem
            .remove(filePath)
            .pipe(
              Effect.mapError(
                (cause) => new SecretStoreRemoveError({ resource: `secret ${name}`, cause }),
              ),
            ),
        ),
      );
    },
    { discard: true },
  );

  return ServerSecretStore.of({
    get,
    set,
    create,
    getOrCreateRandom,
    remove,
  });
});

export const layer = Layer.effect(ServerSecretStore, make);
