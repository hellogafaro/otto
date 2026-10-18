import * as NodeCrypto from "node:crypto";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The server secret that seals list cursors. */
export const LIST_CURSOR_SECRET_NAME = "list-cursor-key";

const SortKey = Schema.Array(Schema.Union([Schema.String, Schema.Number]));

const CursorPayload = Schema.Struct({ view: Schema.String, key: SortKey });

const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(CursorPayload));

const encodePayload = Schema.encodeSync(Schema.fromJsonString(CursorPayload));

/**
 * Seals the last row's sort key with the view (filter and order) it belongs to, encrypted and
 * authenticated, so a client can hand it back but can neither read nor forge it.
 */
export function sealListCursor(secret: Uint8Array, view: string, key: typeof SortKey.Type): string {
  const iv = NodeCrypto.randomBytes(12);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", secret, iv);
  const body = Buffer.concat([cipher.update(encodePayload({ view, key })), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The sort key a cursor sealed for this same view, or undefined for any other cursor. */
export function openListCursor(
  secret: Uint8Array,
  view: string,
  cursor: string,
): typeof SortKey.Type | undefined {
  const sealed = Buffer.from(cursor, "base64url");

  if (sealed.length <= 28) return undefined;

  try {
    const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", secret, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const text = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
    const payload = decodePayload(text.toString("utf8"));

    return Option.isSome(payload) && payload.value.view === view ? payload.value.key : undefined;
  } catch {
    return undefined;
  }
}
