import type { RpcApp } from "@otto/server/api";
import { hc } from "hono/client";

// Hono owns the request and response types; no browser domain model copy.
export const client = hc<RpcApp>(new URL("/api", window.location.origin).href, {
  init: { credentials: "include" },
});
export const workspaceApi = client.workspaces[":workspaceId"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(
      status === 401
        ? "Sign in to continue."
        : status === 403
          ? "You do not have permission to do this."
          : status === 404
            ? "This item is no longer available."
            : status === 409
              ? "This item changed, reload before trying again."
              : status === 503
                ? "This service is unavailable, try again later."
                : "The request failed, check your input and try again.",
    );
    this.status = status;
    this.code = code;
  }
}

/** Decode a typed Hono response only after its HTTP outcome is checked. */
export async function read<T>(response: {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}): Promise<T> {
  if (!response.ok) {
    const payload: unknown = await response.json();
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "request_failed";
    throw new ApiError(response.status, code);
  }
  return response.json();
}
