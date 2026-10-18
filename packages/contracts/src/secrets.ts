import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId } from "./base-schemas.ts";

/** An environment variable name; it never contains "-", so a stored key splits unambiguously. */
export const SecretName = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/));

export type SecretName = typeof SecretName.Type;

export const SECRET_VALUE_MAX_CHARS = 16 * 1024;

export const SecretValue = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(SECRET_VALUE_MAX_CHARS),
  Schema.makeFilter((value) => !value.includes("\0") || "A secret can't contain a NUL character."),
);

/** A secret request's answers; the values themselves are saved separately through secrets.save. */
export const SECRET_SAVE_TO_PROJECT = "Save to project";

export const SECRET_SAVE_TO_CHAT = "This chat only";

/** One value the agent asks for in a secret request. */
export const SecretRequestField = Schema.Struct({
  name: SecretName,
  description: Schema.optional(Schema.String),
});

export type SecretRequestField = typeof SecretRequestField.Type;

/**
 * Where a saved value lives: every chat in a project, or only one chat, held in the server's
 * memory until it restarts.
 */
export const SecretTarget = Schema.Union([
  Schema.Struct({ scope: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ scope: Schema.Literal("chat"), threadId: ThreadId }),
]);

export type SecretTarget = typeof SecretTarget.Type;

export const SecretsListInput = Schema.Struct({ projectId: ProjectId });

export const ProjectSecret = Schema.Struct({ name: SecretName, updatedAt: IsoDateTime });

export type ProjectSecret = typeof ProjectSecret.Type;

export const SecretsListResult = Schema.Struct({ secrets: Schema.Array(ProjectSecret) });

export const SecretsRevealInput = Schema.Struct({ projectId: ProjectId, name: SecretName });

export const SecretsRevealResult = Schema.Struct({ value: Schema.String });

export const SecretsSaveInput = Schema.Struct({
  target: SecretTarget,
  values: Schema.Record(SecretName, SecretValue),
});

export type SecretsSaveInput = typeof SecretsSaveInput.Type;

export const SecretsRemoveInput = Schema.Struct({ projectId: ProjectId, name: SecretName });

export class SecretsRequestError extends Schema.TaggedErrorClass<SecretsRequestError>()(
  "SecretsRequestError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
