import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { DomainError } from "@otto/shared";

export type Order = "asc" | "desc";

/**
 * Longest accepted sealed cursor. The widest supported sort value (a 200-unit title of control characters,
 * 6 JSON bytes each) seals to about 2,000 characters; a larger value is refused, never truncated.
 */
export const MAX_CURSOR_LENGTH = 4096;

/** One AES-256-GCM seal/open pair for sorted list positions; composed once with the server's configuration. */
export interface CursorCodec {
  seal(payload: unknown[], context: string): string;
  open(token: string, context: string): unknown[];
}

/**
 * A sorted position names a scanned row's sort value, which may belong to a row the caller cannot read, so it
 * is never exposed: it is sealed with the caller/request context as authenticated data. The key derives from the
 * configured server secret, so cursors survive restarts and instances and end cleanly when the secret rotates.
 */
export function createCursorCodec(secret: string): CursorCodec {
  if (secret.length < 32) throw new Error("Cursor secret too short");
  const key = Buffer.from(
    hkdfSync("sha256", secret, "", "otto:list-cursor:v1", 32),
  );
  return {
    seal(payload, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context));
      const body = Buffer.concat([
        cipher.update(JSON.stringify(payload), "utf8"),
        cipher.final(),
      ]);
      const token = Buffer.concat([iv, body, cipher.getAuthTag()]).toString(
        "base64url",
      );
      if (token.length > MAX_CURSOR_LENGTH)
        throw new DomainError("unavailable", "Sort value exceeds cursor bound");
      return token;
    },
    /** Every failure is the same `invalid`: tampering, another caller or request, or a rotated secret. */
    open(token, context) {
      try {
        const raw = Buffer.from(token, "base64url");
        if (raw.toString("base64url") !== token || raw.length < 12 + 16)
          throw new Error("shape");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          raw.subarray(0, 12),
        );
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const payload: unknown = JSON.parse(
          Buffer.concat([
            decipher.update(raw.subarray(12, raw.length - 16)),
            decipher.final(),
          ]).toString("utf8"),
        );
        if (!Array.isArray(payload)) throw new Error("shape");
        return payload;
      } catch {
        throw new DomainError("invalid", "Invalid page position or limit");
      }
    },
  };
}

/**
 * Authenticated data for one cursor: format version, owning operation, workspace and actor, plus the sort and
 * every filter field except the paging position. A cursor cannot move to another operation, identity,
 * workspace, filter or sort; `limit` stays free to change between pages.
 */
export function cursorContext(
  operation: string,
  scope: { workspaceId: string; actor: { userId: string; agentId?: string } },
  sort: { sort: string; order: Order },
  input: object,
) {
  const fields = Object.entries(input)
    .filter(
      ([name, value]) =>
        !["after", "limit", "sort", "order"].includes(name) &&
        value !== undefined,
    )
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([
    "otto-list-cursor/1",
    operation,
    scope.workspaceId,
    scope.actor.userId,
    scope.actor.agentId ?? null,
    sort.sort,
    sort.order,
    fields,
  ]);
}

/** `order` only qualifies a `sort`; an unknown sort never reaches SQL. */
export function parseSortInput<Name extends string>(
  input: { sort?: string; order?: string },
  names: readonly Name[],
): { sort: Name; order: Order } | null {
  if (input.sort === undefined) {
    if (input.order !== undefined)
      throw new DomainError("invalid", "Order needs a sort");
    return null;
  }
  const sort = names.find((name) => name === input.sort);
  if (sort === undefined) throw new DomainError("invalid", "Unsupported sort");
  if (
    input.order !== undefined &&
    input.order !== "asc" &&
    input.order !== "desc"
  )
    throw new DomainError("invalid", "Unsupported order");
  return { sort, order: input.order ?? "asc" };
}
