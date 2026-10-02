import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { withCleanup } from "@otto/shared";
export interface ArtifactStorage {
  put(key: string, bytes: Uint8Array, sha256: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}
const MAX_BYTES = 8 * 1024 * 1024;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
/** Private immutable objects. Credentials enter only through trusted process configuration. */
export function createS3Storage(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
    // Garage supports ordinary signed single-part requests; avoid optional AWS streaming checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  async function get(key: string) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (!response.Body) throw new Error("Missing object body");
    const reader = response.Body.transformToWebStream().getReader();
    let timedOut = false;
    let cancellation:
      | Promise<{ ok: true } | { ok: false; error: unknown }>
      | undefined;
    const deadline = setTimeout(() => {
      timedOut = true;
      // Observe rejection immediately and propagate it during resource cleanup.
      cancellation = reader.cancel().then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
    }, 30000);
    return withCleanup(
      async () => {
        if (
          response.ContentLength === undefined ||
          response.ContentLength < 0 ||
          response.ContentLength > MAX_BYTES
        )
          throw new Error("Invalid object size");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES || size > response.ContentLength)
            throw new Error("Invalid object size");
          chunks.push(value);
        }
        if (timedOut) throw new Error("Object read deadline exceeded");
        const bytes = Buffer.concat(chunks, size);
        if (
          size !== response.ContentLength ||
          digest(bytes) !== response.Metadata?.sha256
        )
          throw new Error("Object integrity failure");
        return bytes;
      },
      async () => {
        clearTimeout(deadline);
        try {
          if (cancellation) {
            const result = await cancellation;
            if (!result.ok) throw result.error;
          } else await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      },
    );
  }
  return {
    async put(key: string, bytes: Uint8Array, sha256: string) {
      if (bytes.byteLength > MAX_BYTES || digest(bytes) !== sha256)
        throw new Error("Invalid object bytes");
      try {
        const existing = await get(key);
        if (
          existing.byteLength !== bytes.byteLength ||
          digest(existing) !== sha256
        )
          throw new Error("Immutable object conflict");
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["NoSuchKey", "NotFound"].includes(error.name)
        )
          throw error;
      }
      // Garage 2.4.1 ignores If-None-Match on PUT. A digest-bound key plus
      // validated bytes makes concurrent/retried writes byte-identical.
      if (!key.endsWith(`/${sha256}`))
        throw new Error("Legacy object missing; operator recovery required");
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: "application/octet-stream",
            IfNoneMatch: "*",
            Metadata: { sha256 },
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed")
          throw error;
      }
      const stored = await get(key);
      if (stored.byteLength !== bytes.byteLength || digest(stored) !== sha256)
        throw new Error("Immutable object conflict");
    },
    get,
    async check() {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
        abortSignal: AbortSignal.timeout(3000),
      });
    },
    close() {
      client.destroy();
    },
  } satisfies ArtifactStorage & { check(): Promise<void>; close(): void };
}
