import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SecretName, SecretsRequestError } from "@otto/contracts";

import { ServerSecretStore } from "../auth/server-secret-store.ts";

const isSecretName = Schema.is(SecretName);

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** A project secret's key in the server's encrypted secret store. */
const projectKey = (projectId: string, name: string) => `project-${projectId}-${name}`;

const fail = (detail: string) => new SecretsRequestError({ detail });

/** Shorter values would hide ordinary words in command output. */
const REDACT_MIN_CHARS = 6;

/**
 * Replaces every secret value in a tool's result with its name, so the model never reads one.
 * Results are JSON, so each value is matched as JSON escapes it.
 */
export function redactSecrets<A>(value: A, secrets: Readonly<Record<string, string>>): A {
  const json = JSON.stringify(value);

  if (json === undefined) return value;

  const redacted = Object.entries(secrets)
    .filter(([, secret]) => secret.length >= REDACT_MIN_CHARS)
    .sort(([, left], [, right]) => right.length - left.length)
    .reduce(
      (text, [name, secret]) =>
        text.replaceAll(JSON.stringify(secret).slice(1, -1), `[secret ${name}]`),
      json,
    );

  // SAFETY: only text inside JSON strings changed, so the parsed value keeps A's shape.
  return redacted === json ? value : (JSON.parse(redacted) as A);
}

const make = (store: ServerSecretStore["Service"], sql: SqlClient.SqlClient) => {
  // Otto: This-chat-only values live in memory, so a server restart forgets them.
  const chats = new Map<string, Map<string, string>>();

  const list = (projectId: string) => {
    const prefix = projectKey(projectId, "");

    return sql<{ readonly name: string; readonly updated_at: string }>`
      SELECT name, updated_at FROM secrets
      WHERE substr(name, 1, ${prefix.length}) = ${prefix}
      ORDER BY name
    `.pipe(
      Effect.map((rows) =>
        rows.flatMap((row) => {
          const name = row.name.slice(prefix.length);

          return isSecretName(name) ? [{ name, updatedAt: row.updated_at }] : [];
        }),
      ),
      Effect.mapError(() => fail("The project's secrets couldn't be read.")),
    );
  };

  const read = (projectId: string, name: string) =>
    store.get(projectKey(projectId, name)).pipe(
      Effect.map(Option.map((bytes) => decoder.decode(bytes))),
      Effect.mapError(() => fail(`${name} couldn't be read.`)),
    );

  const reveal = (projectId: string, name: string) =>
    read(projectId, name).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail(`There's no secret named ${name}.`)),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

  const saveToProject = (projectId: string, values: Readonly<Record<string, string>>) =>
    Effect.forEach(
      Object.entries(values),
      ([name, value]) => store.set(projectKey(projectId, name), encoder.encode(value)),
      { discard: true },
    ).pipe(Effect.mapError(() => fail("The secrets weren't saved.")));

  const saveToChat = (threadId: string, values: Readonly<Record<string, string>>) =>
    Effect.sync(() => {
      chats.set(threadId, new Map([...(chats.get(threadId) ?? []), ...Object.entries(values)]));
    });

  const remove = (projectId: string, name: string) =>
    store
      .remove(projectKey(projectId, name))
      .pipe(Effect.mapError(() => fail(`${name} wasn't removed.`)));

  /** Every value a chat's commands get: its project's secrets, then its own, which win. */
  const environment = (input: { readonly projectId: string | null; readonly threadId: string }) =>
    Effect.gen(function* () {
      const { projectId } = input;
      const names = projectId === null ? [] : yield* list(projectId);

      const project =
        projectId === null
          ? []
          : yield* Effect.forEach(names, ({ name }) =>
              read(projectId, name).pipe(
                Effect.map(Option.map((value): readonly [string, string] => [name, value])),
              ),
            );

      return Object.fromEntries<string>([
        ...project.flatMap(Option.toArray),
        ...(chats.get(input.threadId) ?? []),
      ]);
    });

  return { list, reveal, saveToProject, saveToChat, remove, environment };
};

export class Secrets extends Context.Service<Secrets, ReturnType<typeof make>>()(
  "@otto/server/secrets/secrets",
) {}

export const layer = Layer.effect(
  Secrets,
  Effect.gen(function* () {
    return make(yield* ServerSecretStore, yield* SqlClient.SqlClient);
  }),
);
