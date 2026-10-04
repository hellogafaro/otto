import type { InferResponseType } from "hono/client";
import { ApiError, type workspaceApi } from "../lib/api";

type RunState = InferResponseType<
  (typeof workspaceApi.runs)[":id"]["$get"]
>["state"];

/** Non-idempotent creates must not be repeated after a transport or server failure. */
export function hasUncertainMutationOutcome(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** An uncertain Run still holds the execution fence until the server settles it. */
export function isUnsettledScheduleRun(state: RunState) {
  return (
    state === "queued" ||
    state === "launching" ||
    state === "running" ||
    state === "uncertain"
  );
}

/** Denied or missing sources must never render retained query bytes or local drafts. */
export function isDeniedDomainRead(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}
