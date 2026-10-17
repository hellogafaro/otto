import * as Predicate from "effect/Predicate";
import {
  AuthSessionId,
  type AssetResource,
  type LibraryFile,
  libraryContentType,
  libraryDownloadName,
  libraryFileDisplaysInline,
} from "@otto/contracts";
import {
  AssetAttachmentNotFoundError,
  AssetPreviewTypeValidationError,
  AssetSigningKeyLoadError,
  AssetWorkspaceAssetInspectionError,
  AssetWorkspaceAssetNotFoundError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspacePathValidationError,
  AssetWorkspaceResolutionError,
  AssetWorkspaceRootNormalizationError,
} from "@otto/contracts";
import {
  isWorkspaceImagePreviewPath,
  isWorkspacePreviewEntryPath,
  WORKSPACE_BROWSER_PREVIEW_EXTENSIONS,
  WORKSPACE_IMAGE_PREVIEW_EXTENSIONS,
} from "@otto/shared/filePreview";
import {
  IMAGE_DIMENSIONS_HEADER_BYTES,
  readImageDimensions,
  type ImageDimensions,
} from "@otto/shared/imageDimensions";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/server-secret-store.ts";
import { resolveAttachmentPathById } from "../attachment-store.ts";
import { libraryFilePath } from "../library/library-paths.ts";
import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/workspace-paths.ts";

export const ASSET_ROUTE_PREFIX = "/api/assets";

const SIGNING_SECRET_NAME = "asset-access-signing-key";

const ASSET_TOKEN_TTL_MS = 60 * 60 * 1000;

const PREVIEW_ASSET_EXTENSIONS = new Set([
  ...WORKSPACE_BROWSER_PREVIEW_EXTENSIONS,
  ...WORKSPACE_IMAGE_PREVIEW_EXTENSIONS,
  ".css",
  ".js",
  ".mjs",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);

const AssetClaimsSchema = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    sessionId: Schema.optional(AuthSessionId),
    kind: Schema.Literal("workspace-file"),
    workspaceRoot: Schema.String,
    baseRelativePath: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    sessionId: Schema.optional(AuthSessionId),
    kind: Schema.Literal("workspace-file-exact"),
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    sessionId: Schema.optional(AuthSessionId),
    kind: Schema.Literal("attachment"),
    attachmentId: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    version: Schema.Literal(1),
    sessionId: Schema.optional(AuthSessionId),
    kind: Schema.Literal("library-file"),
    fileId: Schema.String,
    contentType: Schema.String,
    inline: Schema.Boolean,
    downloadName: Schema.String,
    expiresAt: Schema.Number,
  }),
]);

type AssetClaims = typeof AssetClaimsSchema.Type;

const AssetClaimsJson = Schema.fromJsonString(AssetClaimsSchema);

const decodeAssetClaims = Schema.decodeUnknownOption(AssetClaimsJson);

const encodeAssetClaims = Schema.encodeSync(AssetClaimsJson);

export type ResolvedAsset = {
  readonly kind: "file";
  readonly path: string;
  readonly sessionId?: AuthSessionId;
  /** Set for chat attachments, whose reader is checked again on every download. */
  readonly attachmentId?: string;
  /** Set for Library files, which carry their own type and download name. */
  readonly headers?: Readonly<Record<string, string>>;
};

const LIBRARY_SVG_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * A signed URL for one Library file. Only images and PDFs open in the browser; everything
 * else, and any file asked for as a download, saves under its Library title.
 */
export const issueLibraryFileUrl = Effect.fn("AssetAccess.issueLibraryFileUrl")(function* (input: {
  readonly file: LibraryFile;
  readonly download: boolean;
  readonly sessionId: AuthSessionId;
}) {
  const expiresAt = (yield* Clock.currentTimeMillis) + ASSET_TOKEN_TTL_MS;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const signingSecret = yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
  const downloadName = libraryDownloadName(input.file);

  const encodedPayload = base64UrlEncode(
    encodeAssetClaims({
      version: 1,
      sessionId: input.sessionId,
      kind: "library-file",
      fileId: input.file.id,
      contentType: libraryContentType(input.file),
      inline: !input.download && libraryFileDisplaysInline(input.file),
      downloadName,
      expiresAt,
    }),
  );

  const token = `${encodedPayload}.${signPayload(encodedPayload, signingSecret)}`;

  return {
    relativeUrl: `${ASSET_ROUTE_PREFIX}/${token}/${encodeURIComponent(downloadName)}`,
    expiresAt,
  };
});

function decodeClaims(encodedPayload: string): AssetClaims | null {
  try {
    return Option.getOrNull(decodeAssetClaims(base64UrlDecodeUtf8(encodedPayload)));
  } catch {
    return null;
  }
}

function decodeRelativePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

const optionOnNotFound = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<Option.Option<A>, PlatformError.PlatformError, R> =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (error) =>
        Predicate.isTagged(error.reason, "NotFound")
          ? Effect.succeed(Option.none<A>())
          : Effect.fail(error),
    }),
  );

const resolveCanonicalWorkspaceFile = Effect.fn("AssetAccess.resolveCanonicalWorkspaceFile")(
  function* (input: { readonly workspaceRoot: string; readonly relativePath: string }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

    const resolved = yield* workspacePaths.resolveRelativePathWithinRoot(input).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        WorkspacePathOutsideRootError: () => Effect.succeed(Option.none()),
      }),
    );

    if (Option.isNone(resolved)) return null;

    const [canonicalRoot, canonicalFile] = yield* Effect.all([
      optionOnNotFound(fileSystem.realPath(input.workspaceRoot)),
      optionOnNotFound(fileSystem.realPath(resolved.value.absolutePath)),
    ]);

    if (Option.isNone(canonicalRoot) || Option.isNone(canonicalFile)) return null;

    const path = yield* Path.Path;
    const relative = path.relative(canonicalRoot.value, canonicalFile.value);

    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;

    const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value));

    return Option.isSome(info) && info.value.type === "File" ? canonicalFile.value : null;
  },
);

const resolveCanonicalWorkspaceFileForRequest = (input: {
  readonly workspaceRoot: string;
  readonly relativePath: string;
}) =>
  resolveCanonicalWorkspaceFile(input).pipe(
    Effect.tapError((cause) =>
      Effect.logError("Failed to resolve canonical asset path.", {
        workspaceRoot: input.workspaceRoot,
        relativePath: input.relativePath,
        cause,
      }),
    ),
    Effect.orElseSucceed(() => null),
  );

const HEADER_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/**
 * Reads pixel dimensions from an image's header so clients can reserve the
 * exact box before the bytes arrive. Best effort: an unreadable or unsupported
 * file just leaves the field out, and the client measures after decode.
 */
const readImageDimensionsFromHeader = (filePath: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    if (!HEADER_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      return null;
    }

    const fileSystem = yield* FileSystem.FileSystem;

    const bytes = yield* fileSystem.open(filePath).pipe(
      Effect.flatMap((file) => file.readAlloc(IMAGE_DIMENSIONS_HEADER_BYTES)),
      Effect.scoped,
      Effect.map((chunk) => Option.getOrElse(chunk, () => new Uint8Array())),
    );

    return readImageDimensions(bytes);
  }).pipe(Effect.orElseSucceed((): ImageDimensions | null => null));

export const issueAssetUrl = Effect.fn("AssetAccess.issueAssetUrl")(function* (input: {
  readonly resource: AssetResource;
  readonly workspaceRoot?: string;
  readonly sessionId?: AuthSessionId;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const expiresAt = (yield* Clock.currentTimeMillis) + ASSET_TOKEN_TTL_MS;
  let claims: AssetClaims;
  let fileName: string;
  let imageDimensions: ImageDimensions | null = null;

  if (Predicate.isTagged(input.resource, "workspace-file")) {
    if (!input.workspaceRoot) {
      return yield* new AssetWorkspaceContextNotFoundError({
        resource: input.resource,
      });
    }

    const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.workspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new AssetWorkspaceRootNormalizationError({
            resource: input.resource,
            cause,
          }),
      ),
    );

    const relativePath = path.isAbsolute(input.resource.path)
      ? path.relative(workspaceRoot, input.resource.path)
      : input.resource.path;

    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot, relativePath })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AssetWorkspacePathValidationError({
              resource: input.resource,
              cause,
            }),
        ),
      );

    if (!isWorkspacePreviewEntryPath(resolved.relativePath)) {
      return yield* new AssetPreviewTypeValidationError({
        resource: input.resource,
      });
    }

    const canonicalFile = yield* resolveCanonicalWorkspaceFile({
      workspaceRoot,
      relativePath: resolved.relativePath,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AssetWorkspaceAssetInspectionError({
            resource: input.resource,
            cause,
          }),
      ),
    );

    if (!canonicalFile) {
      return yield* new AssetWorkspaceAssetNotFoundError({
        resource: input.resource,
      });
    }

    imageDimensions = yield* readImageDimensionsFromHeader(canonicalFile);

    const canonicalWorkspaceRoot = yield* fileSystem.realPath(workspaceRoot).pipe(
      Effect.mapError(
        (cause) =>
          new AssetWorkspaceResolutionError({
            resource: input.resource,
            cause,
          }),
      ),
    );

    claims = isWorkspaceImagePreviewPath(resolved.relativePath)
      ? {
          version: 1,
          kind: "workspace-file-exact",
          workspaceRoot: canonicalWorkspaceRoot,
          relativePath: resolved.relativePath,
          expiresAt,
        }
      : {
          version: 1,
          kind: "workspace-file",
          workspaceRoot: canonicalWorkspaceRoot,
          baseRelativePath: path.dirname(resolved.relativePath),
          expiresAt,
        };
    fileName = path.basename(resolved.relativePath);
  } else {
    const config = yield* ServerConfig.ServerConfig;

    const attachmentPath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: input.resource.attachmentId,
    });

    if (!attachmentPath) {
      return yield* new AssetAttachmentNotFoundError({
        resource: input.resource,
      });
    }

    imageDimensions = yield* readImageDimensionsFromHeader(attachmentPath);
    claims = {
      version: 1,
      kind: "attachment",
      attachmentId: input.resource.attachmentId,
      expiresAt,
    };
    fileName = path.basename(attachmentPath);
  }

  const secretStore = yield* ServerSecretStore.ServerSecretStore;

  const signingSecret = yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32).pipe(
    Effect.mapError(
      (cause) =>
        new AssetSigningKeyLoadError({
          resource: input.resource,
          cause,
        }),
    ),
  );

  const encodedPayload = base64UrlEncode(
    encodeAssetClaims({ ...claims, ...(input.sessionId ? { sessionId: input.sessionId } : {}) }),
  );

  const token = `${encodedPayload}.${signPayload(encodedPayload, signingSecret)}`;

  return {
    relativeUrl: `${ASSET_ROUTE_PREFIX}/${token}/${encodeURIComponent(fileName)}`,
    expiresAt,
    ...(imageDimensions !== null ? { imageDimensions } : {}),
  };
});

export const resolveAsset = Effect.fn("AssetAccess.resolveAsset")(function* (
  token: string,
  relativePath: string,
) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) return null;

  const secretStore = yield* ServerSecretStore.ServerSecretStore;

  const signingSecret = yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32).pipe(
    Effect.tapError((cause) => Effect.logError("Failed to load the asset signing key.", { cause })),
    Effect.orElseSucceed(() => null),
  );

  if (!signingSecret) return null;

  if (!timingSafeEqualBase64Url(signature, signPayload(encodedPayload, signingSecret))) return null;

  const claims = decodeClaims(encodedPayload);

  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;

  if (claims.kind === "library-file") {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const filePath = libraryFilePath(path, config.attachmentsDir, claims.fileId);

    if (filePath === null) return null;
    const fileSystem = yield* FileSystem.FileSystem;

    const info = yield* optionOnNotFound(fileSystem.stat(filePath)).pipe(
      Effect.orElseSucceed(() => Option.none()),
    );

    if (Option.isNone(info) || info.value.type !== "File") return null;

    return {
      kind: "file",
      path: filePath,
      ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
      headers: {
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": claims.contentType,
        "Content-Disposition": `${claims.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(claims.downloadName)}`,
        ...(claims.contentType.startsWith("image/svg")
          ? { "Content-Security-Policy": LIBRARY_SVG_CONTENT_SECURITY_POLICY }
          : {}),
      },
    } satisfies ResolvedAsset;
  }

  if (claims.kind === "attachment") {
    const config = yield* ServerConfig.ServerConfig;

    const attachmentPath = resolveAttachmentPathById({
      attachmentsDir: config.attachmentsDir,
      attachmentId: claims.attachmentId,
    });

    if (!attachmentPath) return null;
    const fileSystem = yield* FileSystem.FileSystem;

    const info = yield* optionOnNotFound(fileSystem.stat(attachmentPath)).pipe(
      Effect.tapError((cause) =>
        Effect.logError("Failed to inspect attachment asset.", {
          attachmentId: claims.attachmentId,
          path: attachmentPath,
          cause,
        }),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );

    return Option.isSome(info) && info.value.type === "File"
      ? ({
          kind: "file",
          path: attachmentPath,
          attachmentId: claims.attachmentId,
          ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
        } satisfies ResolvedAsset)
      : null;
  }

  const decodedPath = decodeRelativePath(relativePath);

  if (decodedPath === null) return null;
  const path = yield* Path.Path;

  if (claims.kind === "workspace-file-exact") {
    if (decodedPath !== path.basename(claims.relativePath)) return null;

    const exactWorkspaceFile = yield* resolveCanonicalWorkspaceFileForRequest({
      workspaceRoot: claims.workspaceRoot,
      relativePath: claims.relativePath,
    });

    return exactWorkspaceFile
      ? ({
          kind: "file",
          path: exactWorkspaceFile,
          ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
        } satisfies ResolvedAsset)
      : null;
  }

  const segments = decodedPath.split(/[\\/]/);

  if (
    decodedPath.length === 0 ||
    decodedPath.includes("\0") ||
    segments.some((segment) => segment === "." || segment === ".." || segment.startsWith(".")) ||
    !PREVIEW_ASSET_EXTENSIONS.has(path.extname(decodedPath).toLowerCase())
  ) {
    return null;
  }

  const joinedRelativePath =
    claims.baseRelativePath === "." ? decodedPath : path.join(claims.baseRelativePath, decodedPath);

  const workspaceFile = yield* resolveCanonicalWorkspaceFileForRequest({
    workspaceRoot: claims.workspaceRoot,
    relativePath: joinedRelativePath,
  });

  return workspaceFile
    ? ({
        kind: "file",
        path: workspaceFile,
        ...(claims.sessionId ? { sessionId: claims.sessionId } : {}),
      } satisfies ResolvedAsset)
    : null;
});
