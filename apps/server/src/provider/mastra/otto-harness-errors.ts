import * as Schema from "effect/Schema";

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Harness construction failed before it could serve any session. */
export class OttoMastraHarnessError extends Schema.TaggedErrorClass<OttoMastraHarnessError>()(
  "OttoMastraHarnessError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Otto harness ${this.operation} failed: ${errorMessage(this.cause)}`;
  }
}
