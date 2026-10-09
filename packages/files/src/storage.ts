import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { withCleanup } from "@otto/shared";
import { MAX_FILE_BYTES, SMALL_FILE_BYTES } from "./limits";
/** A complete, already digest-verified local file (the server's private spool). */
export interface FileSource {
  path: string;
  byteLength: number;
}
export interface FileStorage {
  /** Immutable put; a File source streams from disk and never enters memory. */
  put(
    key: string,
    body: Uint8Array | FileSource,
    sha256: string,
  ): Promise<void>;
  /** Bounded in-memory read for model, preview and Skill consumers only. */
  get(key: string): Promise<Uint8Array>;
  /** Streamed read for downloads; callers verify length and digest before disclosing bytes. */
  open(
    key: string,
    /** Bounds the whole read in milliseconds; an idle timer applies in any case. */
    deadlineMs?: number,
  ): Promise<{ byteLength: number; stream: ReadableStream<Uint8Array> }>;
}
const MAX_BYTES = SMALL_FILE_BYTES;
const IDLE_MS = 30000;
// One whole-request attempt per call: a consumed file stream cannot be replayed by the SDK.
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
  const options = (maxAttempts: number) =>
    ({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts,
      // Garage supports ordinary signed single-part requests; avoid optional AWS streaming checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }) as const;
  const client = new S3Client(options(2));
  const uploadClient = new S3Client(options(1));
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
      // Observe rejection immediately and propagate it during file cleanup.
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
  /**
   * Streamed read for downloads. The idle timer aborts when no byte arrives for 30 seconds and the optional
   * total deadline bounds the whole read; both also cancel the underlying SDK stream.
   */
  async function open(key: string, deadlineMs?: number) {
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), IDLE_MS);
    const total =
      deadlineMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(), deadlineMs);
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), IDLE_MS);
    };
    const clear = () => {
      clearTimeout(idle);
      clearTimeout(total);
    };
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: controller.signal },
      );
      const byteLength = response.ContentLength;
      if (
        !response.Body ||
        byteLength === undefined ||
        byteLength < 0 ||
        byteLength > MAX_FILE_BYTES
      )
        throw new Error("Invalid object size");
      const reader = response.Body.transformToWebStream().getReader();
      let size = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(output) {
          touch();
          try {
            const { value, done } = await reader.read();
            if (done) {
              clear();
              if (size !== byteLength)
                throw new Error("Object integrity failure");
              output.close();
              return;
            }
            size += value.byteLength;
            if (size > byteLength) throw new Error("Object integrity failure");
            output.enqueue(value);
          } catch (error) {
            clear();
            controller.abort();
            throw error;
          }
        },
        async cancel(reason) {
          clear();
          controller.abort();
          await reader.cancel(reason).catch(() => undefined);
        },
      });
      return { byteLength, stream };
    } catch (error) {
      clear();
      controller.abort();
      throw error;
    }
  }
  /** Stored bytes, not metadata: stream the object through SHA-256 and discard it. Null when absent. */
  async function readBack(key: string, expectedBytes: number) {
    let opened: Awaited<ReturnType<typeof open>>;
    try {
      opened = await open(key, IDLE_MS + Math.ceil(expectedBytes / 500));
    } catch (error) {
      if (
        error instanceof Error &&
        ["NoSuchKey", "NotFound"].includes(error.name)
      )
        return null;
      throw error;
    }
    const hash = createHash("sha256");
    let size = 0;
    const reader = opened.stream.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        hash.update(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return { size, sha256: hash.digest("hex") };
  }
  async function putSource(
    key: string,
    source: FileSource,
    sha256: string,
  ): Promise<void> {
    if (
      !Number.isInteger(source.byteLength) ||
      source.byteLength < 0 ||
      source.byteLength > MAX_FILE_BYTES
    )
      throw new Error("Invalid object bytes");
    const identical = (found: Awaited<ReturnType<typeof readBack>>): boolean =>
      found !== null &&
      found.size === source.byteLength &&
      found.sha256 === sha256;
    // A retry or lost acknowledgement is reconciled by the stored bytes themselves, never by metadata.
    const existing = await readBack(key, source.byteLength);
    if (existing) {
      if (identical(existing)) return;
      throw new Error("Immutable object conflict");
    }
    if (!key.endsWith(`/${sha256}`))
      throw new Error("Legacy object missing; operator recovery required");
    const body = createReadStream(source.path);
    try {
      await uploadClient.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentLength: source.byteLength,
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
          Metadata: { sha256 },
        }),
        // Deadline scales with size (about 500 kB/s floor) instead of cutting large uploads at 30 seconds.
        {
          abortSignal: AbortSignal.timeout(
            IDLE_MS + Math.ceil(source.byteLength / 500),
          ),
        },
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "PreconditionFailed")
        throw error;
    } finally {
      // The SDK does not close a body it did not finish reading; close and join it on every outcome.
      await new Promise<void>((resolve) => {
        if (body.closed) resolve();
        else {
          body.once("close", () => resolve());
          body.destroy();
        }
      });
    }
    if (!identical(await readBack(key, source.byteLength)))
      throw new Error("Immutable object conflict");
  }
  return {
    async put(key: string, body: Uint8Array | FileSource, sha256: string) {
      if (!(body instanceof Uint8Array)) return putSource(key, body, sha256);
      const bytes = body;
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
    open,
    async check() {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
        abortSignal: AbortSignal.timeout(3000),
      });
    },
    close() {
      client.destroy();
      uploadClient.destroy();
    },
  } satisfies FileStorage & { check(): Promise<void>; close(): void };
}
