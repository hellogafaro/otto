import type { McpServer, McpServerId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type SecretStoreError,
  SecretStoreDecodeError,
  ServerSecretStore,
} from "../auth/server-secret-store.ts";
import {
  type McpOAuthStorage,
  withMcpOAuthStorage,
  withMcpRuntimeHeaders,
} from "./mcp-server-config.ts";

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const StringRecordJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const decodeStringRecord = Schema.decodeUnknownEffect(StringRecordJson);

const encodeStringRecord = Schema.encodeEffect(StringRecordJson);

/** The secret holding a server's request headers, a JSON object of name to value. */
export const mcpServerHeadersSecretName = (mcpServerId: string) =>
  `mcp-server-${mcpServerId}-headers`;

/** The secret holding a server's OAuth state: tokens, client registration and PKCE verifier. */
export const mcpServerOAuthSecretName = (mcpServerId: string) => `mcp-server-${mcpServerId}-oauth`;

const readRecord = (store: ServerSecretStore["Service"], name: string) =>
  store.get(name).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<Readonly<Record<string, string>>>({}),
        onSome: (bytes) =>
          decodeStringRecord(decoder.decode(bytes)).pipe(
            Effect.mapError(
              (cause) => new SecretStoreDecodeError({ resource: `secret ${name}`, cause }),
            ),
          ),
      }),
    ),
  );

const writeRecord = (
  store: ServerSecretStore["Service"],
  name: string,
  record: Readonly<Record<string, string>>,
): Effect.Effect<void, SecretStoreError> =>
  Object.keys(record).length === 0
    ? store.remove(name)
    : encodeStringRecord(record).pipe(
        Effect.mapError(
          (cause) => new SecretStoreDecodeError({ resource: `secret ${name}`, cause }),
        ),
        Effect.flatMap((json) => store.set(name, encoder.encode(json))),
      );

export const readMcpServerHeaders = (mcpServerId: McpServerId) =>
  Effect.gen(function* () {
    const store = yield* ServerSecretStore;

    return yield* readRecord(store, mcpServerHeadersSecretName(mcpServerId));
  });

/**
 * Replaces a server's headers. A null value keeps the saved value for that name, and a
 * name that is left out is dropped. Returns the names that remain.
 */
export const replaceMcpServerHeaders = (
  mcpServerId: McpServerId,
  headers: ReadonlyArray<{ readonly name: string; readonly value: string | null }>,
) =>
  Effect.gen(function* () {
    const store = yield* ServerSecretStore;
    const name = mcpServerHeadersSecretName(mcpServerId);
    const saved = yield* readRecord(store, name);
    const next: Record<string, string> = {};

    for (const header of headers) {
      const value = header.value ?? saved[header.name];

      if (value !== undefined) next[header.name] = value;
    }

    yield* writeRecord(store, name, next);

    return Object.keys(next);
  });

/** OAuth storage over the server's secret, so tokens never touch a file. */
function oauthStorage(
  store: ServerSecretStore["Service"],
  mcpServerId: McpServerId,
): McpOAuthStorage {
  const name = mcpServerOAuthSecretName(mcpServerId);

  const update = (change: (record: Record<string, string>) => void) =>
    Effect.runPromise(
      readRecord(store, name).pipe(
        Effect.flatMap((record) => {
          const next = { ...record };

          change(next);

          return writeRecord(store, name, next);
        }),
      ),
    );

  return {
    get: (key) => Effect.runPromise(readRecord(store, name)).then((record) => record[key]),
    set: (key, value) =>
      update((record) => {
        record[key] = value;
      }),
    delete: (key) =>
      update((record) => {
        delete record[key];
      }),
  };
}

/**
 * Attaches a remote server's saved headers and its OAuth storage for this connection.
 * Neither ever becomes part of the server record or reaches a client.
 */
export const withMcpServerCredentials = <T extends McpServer>(server: T) =>
  Effect.gen(function* () {
    if (server.transport !== "url") return server;
    const store = yield* ServerSecretStore;
    const headers = yield* readRecord(store, mcpServerHeadersSecretName(server.id));

    return withMcpOAuthStorage(
      withMcpRuntimeHeaders(server, headers),
      oauthStorage(store, server.id),
    );
  });
