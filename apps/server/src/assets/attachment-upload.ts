import * as NodeCrypto from "node:crypto";

import {
  ATTACHMENT_UPLOAD_URL_TTL_MS,
  type AttachmentCreateUploadUrlInput,
  AttachmentUploadSigningKeyError,
} from "@otto/contracts";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  createPendingAttachmentId,
  inferAttachmentExtension,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
  sweepStalePendingAttachments,
} from "../attachment-store.ts";
import { resolveAttachmentRelativePath } from "../attachment-paths.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/server-secret-store.ts";
import * as ServerConfig from "../config.ts";

export const ATTACHMENT_UPLOAD_ROUTE_PREFIX = "/api/attachments/upload";

// Asset download tokens share this key, but their signed claim kind is different.
const SIGNING_SECRET_NAME = "asset-access-signing-key";

const PENDING_ATTACHMENT_SWEEP_INTERVAL_MS = 15 * 60_000;

const lastPendingSweepByDirectory = new Map<string, number>();

const AttachmentUploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("attachment-upload"),
  attachmentId: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  expiresAt: Schema.Number,
});

export type AttachmentUploadClaims = typeof AttachmentUploadClaims.Type;

const attachmentUploadClaimsJson = Schema.fromJsonString(AttachmentUploadClaims);

const decodeAttachmentUploadClaims = Schema.decodeUnknownOption(attachmentUploadClaimsJson);

const encodeAttachmentUploadClaims = Schema.encodeSync(attachmentUploadClaimsJson);

function decodeClaims(encodedPayload: string): AttachmentUploadClaims | null {
  try {
    return Option.getOrNull(decodeAttachmentUploadClaims(base64UrlDecodeUtf8(encodedPayload)));
  } catch {
    return null;
  }
}

const loadSigningSecret = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore.ServerSecretStore;

  return yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
});

export const issueAttachmentUploadUrl = Effect.fn("AttachmentUpload.issueUrl")(function* (
  input: AttachmentCreateUploadUrlInput,
) {
  const secret = yield* loadSigningSecret.pipe(
    Effect.mapError((cause) => new AttachmentUploadSigningKeyError({ cause })),
  );

  const config = yield* ServerConfig.ServerConfig;
  const nowMs = yield* Clock.currentTimeMillis;
  const previousSweep = lastPendingSweepByDirectory.get(config.attachmentsDir);

  if (
    previousSweep === undefined ||
    nowMs - previousSweep >= PENDING_ATTACHMENT_SWEEP_INTERVAL_MS
  ) {
    lastPendingSweepByDirectory.set(config.attachmentsDir, nowMs);

    const swept = sweepStalePendingAttachments({
      attachmentsDir: config.attachmentsDir,
      nowMs,
    });

    if (swept.deleted > 0) {
      yield* Effect.logInfo("Removed expired attachment uploads.", { deleted: swept.deleted });
    }
  }

  const attachmentId = createPendingAttachmentId();
  const expiresAt = nowMs + ATTACHMENT_UPLOAD_URL_TTL_MS;

  const encodedPayload = base64UrlEncode(
    encodeAttachmentUploadClaims({
      version: 1,
      kind: "attachment-upload",
      attachmentId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresAt,
    }),
  );

  return {
    attachmentId,
    relativeUrl: `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/${encodedPayload}.${signPayload(encodedPayload, secret)}`,
    expiresAt,
  };
});

export const validateAttachmentUploadToken = Effect.fn("AttachmentUpload.validateToken")(function* (
  token: string,
) {
  const [encodedPayload, signature, unexpectedSegment] = token.split(".");

  if (!encodedPayload || !signature || unexpectedSegment) {
    return null;
  }

  const secret = yield* loadSigningSecret.pipe(
    Effect.tapError((cause) =>
      Effect.logError("Failed to load the attachment upload signing key.", { cause }),
    ),
    Effect.orElseSucceed(() => null),
  );

  if (!secret || !timingSafeEqualBase64Url(signature, signPayload(encodedPayload, secret))) {
    return null;
  }

  const claims = decodeClaims(encodedPayload);

  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) {
    return null;
  }

  return claims;
});

export type StoreAttachmentUploadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly detail: string };

class AttachmentUploadBodyError extends Data.TaggedError("AttachmentUploadBodyError")<{
  readonly status: number;
  readonly detail: string;
}> {}

/**
 * Streams an upload body into its pending attachment file, counting bytes as they arrive so a
 * body longer than the signed size stops without ever being held in memory.
 */
export const storeAttachmentUpload = Effect.fn("AttachmentUpload.store")(function* <E>(
  claims: AttachmentUploadClaims,
  body: Stream.Stream<Uint8Array, E>,
) {
  const config = yield* ServerConfig.ServerConfig;
  const extension = inferAttachmentExtension({ mimeType: claims.mimeType, name: claims.name });
  const relativePath = `${claims.attachmentId}${extension}`;

  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath,
  });

  const partPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${relativePath}.${NodeCrypto.randomUUID()}.part`,
  });

  if (!finalPath || !partPath) {
    return { ok: false, status: 500, detail: "Failed to resolve attachment path." };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const removePart = fileSystem.remove(partPath, { force: true }).pipe(Effect.ignore);
  let receivedBytes = 0;

  return yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(finalPath), { recursive: true });

    yield* body.pipe(
      Stream.mapError(
        () =>
          new AttachmentUploadBodyError({ status: 400, detail: "Failed to read the upload body." }),
      ),
      Stream.tap((chunk) => {
        receivedBytes += chunk.byteLength;

        return receivedBytes > claims.sizeBytes
          ? Effect.fail(
              new AttachmentUploadBodyError({
                status: 413,
                detail: `Body exceeded ${claims.sizeBytes} bytes.`,
              }),
            )
          : Effect.void;
      }),
      Stream.run(fileSystem.sink(partPath)),
    );

    if (receivedBytes !== claims.sizeBytes) {
      return yield* new AttachmentUploadBodyError({
        status: 400,
        detail: `Body was ${receivedBytes} bytes, expected ${claims.sizeBytes}.`,
      });
    }

    yield* fileSystem.rename(partPath, finalPath);

    return { ok: true } satisfies StoreAttachmentUploadResult;
  }).pipe(
    Effect.catchTag("AttachmentUploadBodyError", (error) =>
      removePart.pipe(
        Effect.as({
          ok: false,
          status: error.status,
          detail: error.detail,
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
    Effect.catch((cause) =>
      removePart.pipe(
        Effect.andThen(
          Effect.logError("Failed to persist attachment upload.", {
            attachmentId: claims.attachmentId,
            cause,
          }),
        ),
        Effect.as({
          ok: false,
          status: 500,
          detail: "Failed to persist upload.",
        } satisfies StoreAttachmentUploadResult),
      ),
    ),
  );
});

export const deletePendingAttachment = Effect.fn("AttachmentUpload.deletePending")(function* (
  attachmentId: string,
) {
  if (parseThreadSegmentFromAttachmentId(attachmentId) !== PENDING_ATTACHMENT_THREAD_SEGMENT) {
    return;
  }

  const config = yield* ServerConfig.ServerConfig;

  const attachmentPath = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId,
  });

  if (!attachmentPath) {
    return;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.remove(attachmentPath, { force: true }).pipe(Effect.orElseSucceed(() => {}));
});
