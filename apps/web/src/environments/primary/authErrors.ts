import * as Match from "effect/Match";
import { EnvironmentHttpCommonError } from "@otto/contracts";
import type { EnvironmentHttpCommonError as EnvironmentHttpCommonErrorType } from "@otto/contracts";
import * as Schema from "effect/Schema";
import { HttpClientError } from "effect/unstable/http";

const PrimaryEnvironmentRequestOperation = Schema.Literals([
  "fetch-session-state",
  "exchange-bootstrap-credential",
  "fetch-environment-descriptor",
  "list-client-sessions",
  "revoke-client-session",
  "revoke-other-client-sessions",
]);

type PrimaryEnvironmentRequestOperation = typeof PrimaryEnvironmentRequestOperation.Type;

export class PrimaryEnvironmentRequestError extends Schema.TaggedErrorClass<PrimaryEnvironmentRequestError>()(
  "PrimaryEnvironmentRequestError",
  {
    operation: PrimaryEnvironmentRequestOperation,
    status: Schema.Number,
    sessionId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(input: {
    readonly operation: PrimaryEnvironmentRequestOperation;
    readonly cause: unknown;
    readonly sessionId?: string;
  }): PrimaryEnvironmentRequestError {
    const status = readHttpApiStatus(input.cause) ?? 500;

    return new PrimaryEnvironmentRequestError({
      operation: input.operation,
      status,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      cause: input.cause,
    });
  }

  override get message(): string {
    return `Primary environment request failed during ${this.operation} (HTTP ${this.status}).`;
  }
}

export const isPrimaryEnvironmentRequestError = Schema.is(PrimaryEnvironmentRequestError);

export const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

function readHttpApiStatus(cause: unknown): number | null {
  if (isEnvironmentHttpCommonError(cause)) {
    return readEnvironmentHttpErrorStatus(cause);
  }

  return HttpClientError.isHttpClientError(cause) && cause.response !== undefined
    ? cause.response.status
    : null;
}

function readEnvironmentHttpErrorStatus(error: EnvironmentHttpCommonErrorType): number {
  return Match.value(error).pipe(
    Match.tag("EnvironmentRequestInvalidError", () => 400),
    Match.tag("EnvironmentAuthInvalidError", () => 401),
    Match.tag("EnvironmentScopeRequiredError", () => 403),
    Match.tag("EnvironmentOperationForbiddenError", () => 403),
    Match.tag("EnvironmentResourceNotFoundError", () => 404),
    Match.tag("EnvironmentInternalError", () => 500),
    Match.exhaustive,
  );
}
