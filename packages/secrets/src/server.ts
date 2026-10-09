import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError, required } from "@otto/shared";
import type { Context } from "@otto/workspaces";
import { eq } from "drizzle-orm";
import { secrets } from "./schema";

function requireKey(key: Uint8Array) {
  if (key.byteLength !== 32)
    throw new DomainError("unavailable", "Encryption key unavailable");
}

export function encryptSecret(value: string, id: string, key: Uint8Array) {
  requireKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}

export function decryptSecret(value: string, id: string, key: Uint8Array) {
  requireKey(key);
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length < 29) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DomainError("unavailable", "Stored credential unavailable");
  }
}

export async function createSecret(
  c: Context,
  title: string,
  value: string,
  key: Uint8Array,
) {
  const id = crypto.randomUUID();
  await c.tx
    .insert(secrets)
    .values({ id, title, value: encryptSecret(value, id, key) });
  return id;
}

export async function readSecret(c: Context, id: string, key: Uint8Array) {
  const row = required(
    (await c.tx.select().from(secrets).where(eq(secrets.id, id)))[0],
  );
  return decryptSecret(row.value, row.id, key);
}

export async function deleteSecret(c: Context, id: string) {
  await c.tx.delete(secrets).where(eq(secrets.id, id));
}
