import * as Predicate from "effect/Predicate";
import Mime from "@effect/platform-node/Mime";
import * as NodeFS from "node:fs";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentHttpApi,
  LIBRARY_SHARED_ROUTE_PREFIX,
  type LibrarySharedFile,
  libraryContentType,
  libraryDownloadName,
} from "@otto/contracts";
import { isDevProxiedPath } from "@otto/shared/devProxy";
import { decodeOtlpTraceRecords } from "@otto/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
  HttpServerRespondable,
} from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { OtlpTracer } from "effect/unstable/observability";

import * as ServerConfig from "./config.ts";
import { ASSET_ROUTE_PREFIX, resolveAsset } from "./assets/asset-access.ts";
import { OrganizationAccounts } from "./auth/organization-accounts.ts";
import { readableAttachment } from "./orchestration/group-visibility.ts";
import { ProjectionSnapshotQuery } from "./orchestration/services/projection-snapshot-query.ts";
import { ProjectionBotRepository } from "./persistence/services/projection-bots.ts";
import { ProjectionGroupRepository } from "./persistence/services/projection-groups.ts";
import { ProjectionThreadMessageRepository } from "./persistence/services/projection-thread-messages.ts";
import { DESKTOP_RENDERER_ORIGINS } from "./auth/organization-accounts-runtime.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "./assets/attachment-upload.ts";
import {
  findSharedFile,
  LIBRARY_UPLOAD_ROUTE_PREFIX,
  storeLibraryUpload,
  validateLibraryUploadToken,
} from "./library/library-store.ts";
import * as BrowserTraceCollector from "./observability/browser-trace-collector.ts";
import * as EnvironmentAuth from "./auth/environment-auth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentScopeRequired,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
} from "./auth/http.ts";
import * as ServerEnvironment from "./environment/server-environment.ts";
import { browserApiCorsAllowedHeaders, browserApiCorsAllowedMethods } from "./http-cors.ts";

const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const INLINE_ATTACHMENT_TYPES = ["image/", "video/", "audio/", "application/pdf"];

/**
 * A chat attachment saves under the name it was sent with, whatever extension it is stored
 * under: images, video, audio and PDFs show in place, anything else downloads. The type the
 * stored file is served with is unchanged, so an HTML attachment never renders on this origin.
 */
export function attachmentDisposition(attachment: {
  readonly name: string;
  readonly mimeType: string;
}) {
  const inline = INLINE_ATTACHMENT_TYPES.some((type) =>
    attachment.mimeType.toLowerCase().startsWith(type),
  );

  const name = attachment.name.replace(/[/\\:*?"<>|\p{Cc}]/gu, "-");

  return {
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
}

export function assetResponseHeaders(filePath: string) {
  const lowerPath = filePath.toLowerCase();

  return {
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    ...(lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")
      ? { "Content-Type": "text/html; charset=utf-8" }
      : {}),
    ...(lowerPath.endsWith(".svg")
      ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
      : {}),
  };
}

export const httpCompressionLayer = HttpRouter.middleware(HttpMiddleware.compression(), {
  global: true,
});

export const browserApiCorsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const devOrigin = config.devUrl?.origin;

    // Dev uses credentialed requests from Vite or the Electron custom origin, so both must be
    // explicit. Packaged desktop omits credentials and uses Effect's default wildcard origin.
    //
    // OTTO_LEGACY_DEV_ALLOWED_ORIGINS covers dev servers reached from a second
    // origin — a tailnet name, a LAN IP, a phone. Browser dev normally proxies
    // through Vite and is same-origin (no preflight at all), so this is a
    // safety net for the desktop renderer and any direct-to-backend caller.
    return HttpRouter.cors({
      ...(devOrigin
        ? {
            allowedOrigins: [devOrigin, ...DESKTOP_RENDERER_ORIGINS, ...config.devAllowedOrigins],
            credentials: true,
          }
        : {}),
      allowedMethods: browserApiCorsAllowedMethods,
      allowedHeaders: browserApiCorsAllowedHeaders,
      maxAge: 600,
    });
  }),
);

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");

  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;

  return redirectUrl.toString();
}

const authenticateRawRouteWithScope = (
  scope: typeof AuthOrchestrationReadScope | typeof AuthOrchestrationOperateScope,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;

    const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
      Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
        failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
      ),
      Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
        failEnvironmentInternal("internal_error", error),
      ),
    );

    if (!session.scopes.includes(scope)) {
      return yield* failEnvironmentScopeRequired(scope);
    }
  });

export const serverEnvironmentHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "metadata",
  Effect.fnUntraced(function* (handlers) {
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;

    return handlers.handle(
      "descriptor",
      Effect.fn("environment.metadata.descriptor")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);

        return yield* serverEnvironment.getDescriptor;
      }),
    );
  }),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector.BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Trace export failed.", { status: 502 }),
        ),
      );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const assetRouteLayer = HttpRouter.add(
  "GET",
  `${ASSET_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const suffix = url.value.pathname.slice(`${ASSET_ROUTE_PREFIX}/`.length);
    const separatorIndex = suffix.indexOf("/");

    if (separatorIndex <= 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const asset = yield* resolveAsset(
      suffix.slice(0, separatorIndex),
      suffix.slice(separatorIndex + 1),
    );

    const accounts = yield* OrganizationAccounts;

    const principal = asset?.sessionId
      ? yield* accounts.getPrincipal(asset.sessionId).pipe(Effect.orElseSucceed(() => null))
      : null;

    if (!asset || !principal) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const attachment =
      "attachmentId" in asset && asset.attachmentId !== undefined
        ? yield* readableAttachment(
            {
              projectionSnapshotQuery: yield* ProjectionSnapshotQuery,
              projectionGroups: yield* ProjectionGroupRepository,
              projectionThreadMessages: yield* ProjectionThreadMessageRepository,
            },
            asset.attachmentId,
            AuthSessionId.make(principal.userId),
          )
        : undefined;

    if (attachment === null) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(asset.path, {
      status: 200,
      headers:
        "headers" in asset && asset.headers
          ? asset.headers
          : {
              ...assetResponseHeaders(asset.path),
              ...(attachment ? attachmentDisposition(attachment) : {}),
            },
    }).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }),
);

export const attachmentUploadRouteLayer = HttpRouter.add(
  "POST",
  `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const token = url.value.pathname.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);

    if (!token) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const claims = yield* validateAttachmentUploadToken(token);

    if (!claims) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentLengthHeader = request.headers["content-length"];

    if (
      contentLengthHeader !== undefined &&
      (!Number.isInteger(Number(contentLengthHeader)) ||
        Number(contentLengthHeader) !== claims.sizeBytes)
    ) {
      return HttpServerResponse.text("Content-Length must match the upload size.", {
        status: 400,
      });
    }

    const stored = yield* storeAttachmentUpload(claims, request.stream);

    return stored.ok
      ? HttpServerResponse.empty({ status: 204 })
      : HttpServerResponse.text(stored.detail, { status: stored.status });
  }),
);

export const libraryUploadRouteLayer = HttpRouter.add(
  "POST",
  `${LIBRARY_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const claims = yield* validateLibraryUploadToken(
      url.value.pathname.slice(`${LIBRARY_UPLOAD_ROUTE_PREFIX}/`.length),
    );

    if (!claims) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const body = yield* request.arrayBuffer.pipe(
      Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(claims.sizeBytes)),
      Effect.orElseSucceed(() => null),
    );

    if (body === null) {
      return HttpServerResponse.text("Failed to read the upload body.", { status: 400 });
    }

    return yield* storeLibraryUpload(claims, new Uint8Array(body)).pipe(
      Effect.as(HttpServerResponse.empty({ status: 204 })),
      Effect.catchTag("LibraryRequestError", (error) =>
        Effect.succeed(HttpServerResponse.text(error.detail, { status: 400 })),
      ),
    );
  }),
);

const SHARED_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

/**
 * A public link, with no sign-in: `<shareId>` is the shared file's details and
 * `<shareId>/content` its frozen copy (`?download=1` saves it). HTML runs sandboxed in an
 * origin of its own; PDFs keep the browser's viewer; everything else is sandboxed without scripts.
 */
export const librarySharedRouteLayer = HttpRouter.add(
  "GET",
  `${LIBRARY_SHARED_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    const notFound = HttpServerResponse.text("Not Found", {
      status: 404,
      headers: SHARED_RESPONSE_HEADERS,
    });

    if (Option.isNone(url)) return notFound;

    const [shareId, part, extra] = url.value.pathname
      .slice(`${LIBRARY_SHARED_ROUTE_PREFIX}/`.length)
      .split("/");

    if (!shareId || extra !== undefined || (part !== undefined && part !== "content")) {
      return notFound;
    }

    const shared = yield* findSharedFile(shareId);

    if (shared === null) return notFound;

    const { file, share } = shared;

    if (part === undefined) {
      const sharedBy =
        share.sharedBy.kind === "person"
          ? share.sharedBy.displayName
          : yield* (yield* ProjectionBotRepository).getById({ botId: share.sharedBy.botId }).pipe(
              Effect.map((bot) =>
                Option.match(bot, { onNone: () => "A bot", onSome: (row) => row.name }),
              ),
              Effect.orElseSucceed(() => "A bot"),
            );

      return yield* HttpServerResponse.json(
        {
          title: file.title,
          extension: file.extension,
          type: file.type,
          sizeBytes: shared.sizeBytes,
          sharedBy,
          workspace: (yield* OrganizationAccounts).runtime.getOrganization()?.name ?? null,
          sharedAt: share.sharedAt,
        } satisfies LibrarySharedFile,
        { headers: SHARED_RESPONSE_HEADERS },
      );
    }

    const contentType = libraryContentType(file);
    const download = url.value.searchParams.get("download") === "1";

    const policy =
      contentType === "application/pdf"
        ? {}
        : {
            "Content-Security-Policy": contentType.startsWith("text/html")
              ? "sandbox allow-scripts allow-popups"
              : "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          };

    return yield* HttpServerResponse.file(shared.path, {
      status: 200,
      headers: {
        ...SHARED_RESPONSE_HEADERS,
        ...policy,
        "Content-Type": contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(libraryDownloadName(file))}`,
      },
    }).pipe(Effect.orElseSucceed(() => notFound));
  }),
);

const decodeBuildManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        file: Schema.String,
        css: Schema.optional(Schema.Array(Schema.String)),
        assets: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
);

const loadImmutableBuildAssets = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;

  const staticDir =
    config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);

  if (!staticDir) return new Set<string>();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* fileSystem.readFileString(path.join(staticDir, ".vite", "manifest.json")).pipe(
    Effect.flatMap(decodeBuildManifest),
    Effect.map(
      (manifest) =>
        new Set(
          Object.values(manifest).flatMap((entry) => [
            entry.file,
            ...(entry.css ?? []),
            ...(entry.assets ?? []),
          ]),
        ),
    ),
    Effect.orElseSucceed(() => new Set<string>()),
  );
});

const openStaticFile = Effect.fn("openStaticFile")(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  // Reject directories and special files before opening. Response metadata comes from the handle.
  const pathInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));

  if (pathInfo?.type !== "File") return null;
  const file = yield* fileSystem.open(filePath, { flag: "r" });
  const info = yield* file.stat;

  return info.type === "File" ? { file, info } : null;
});

const streamStaticFile = (file: FileSystem.File, size: bigint) =>
  Stream.unfold(
    0n,
    Effect.fnUntraced(function* (offset: bigint) {
      if (offset >= size) return;
      const remaining = size - offset;
      const bytes = yield* file.readAlloc(remaining < 65_536n ? remaining : 65_536n);

      if (Option.isNone(bytes)) return;

      return [bytes.value, offset + BigInt(bytes.value.byteLength)] as const;
    }),
  );

function mutableFileEtag(file: FileSystem.File): string | undefined {
  if (!("fd" in file) || !Predicate.isNumber(file.fd)) return undefined;
  const descriptor = file.fd;

  try {
    const info = NodeFS.fstatSync(descriptor, { bigint: true });

    return `W/"${info.dev.toString(16)}-${info.ino.toString(16)}-${info.size.toString(16)}-${info.mtimeNs.toString(16)}-${info.ctimeNs.toString(16)}"`;
  } catch {
    // Without a validator that changes with content, serving 200 is safer than a stale 304.
    return undefined;
  }
}

const handleStaticAndDevRequest = Effect.fn("handleStaticAndDevRequest")(
  function* (immutableBuildAssets: ReadonlySet<string>) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;

    if (config.devUrl && isDevProxiedPath(url.value.pathname)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir =
      config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);

    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");

    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);

    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);

    if (!ext) {
      filePath = path.resolve(filePath, "index.html");

      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    let opened = yield* openStaticFile(filePath);

    if (!opened) {
      filePath = path.resolve(staticRoot, "index.html");
      opened = yield* openStaticFile(filePath);

      if (!opened) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
    }

    const fileInfo = opened.info;

    // A hash-like name is not enough: custom static files can use the same naming pattern.
    const relativePath = path.relative(staticRoot, filePath).replaceAll("\\", "/");

    const immutable =
      /^assets\/.+-[\w-]{8}\.[^/]+$/.test(relativePath) && immutableBuildAssets.has(relativePath);

    type StaticResponseHeaders = {
      "Cache-Control": string;
      ETag?: string;
      "Last-Modified"?: string;
    };

    const headers: StaticResponseHeaders = {
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    };

    const modifiedAt = Option.getOrUndefined(fileInfo.mtime);

    const etag = immutable
      ? modifiedAt
        ? `W/"${fileInfo.size.toString(16)}-${modifiedAt.getTime().toString(16)}"`
        : undefined
      : mutableFileEtag(opened.file);

    if (etag !== undefined && modifiedAt !== undefined) {
      headers.ETag = etag;
      headers["Last-Modified"] = modifiedAt.toUTCString();
    }

    // If-None-Match takes precedence over dates and uses weak comparison for
    // GET/HEAD, including when compression changes the transferred bytes.
    const ifNoneMatch = request.headers["if-none-match"];
    const ifModifiedSince = request.headers["if-modified-since"];

    const unchanged =
      ifNoneMatch !== undefined
        ? ifNoneMatch.split(",").some((value) => {
            const candidate = value.trim();

            return (
              candidate === "*" ||
              (etag !== undefined && candidate.replace(/^W\//i, "") === etag.replace(/^W\//i, ""))
            );
          })
        : immutable &&
          ifModifiedSince !== undefined &&
          modifiedAt !== undefined &&
          Date.parse(modifiedAt.toUTCString()) <= Date.parse(ifModifiedSince);

    if (unchanged) {
      return HttpServerResponse.empty({
        status: 304,
        headers: { ...headers, Vary: "Accept-Encoding" },
      });
    }

    const contentType =
      path.extname(filePath) === ".html"
        ? "text/html; charset=utf-8"
        : (Mime.getType(filePath) ?? "application/octet-stream");

    // The request scope closes the handle for GET, HEAD, 304, errors, and cancellation.
    // HEAD still passes through compression, which selects headers without reading the stream.
    return HttpServerResponse.stream(streamStaticFile(opened.file, fileInfo.size), {
      headers,
      contentType,
      contentLength: Number(fileInfo.size),
    });
  },
  Effect.catchTags({
    PlatformError: () =>
      Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
  }),
);

// Read the installed build's manifest once. Unknown files use revalidation.
export const staticAndDevRouteLayer = Layer.unwrap(
  loadImmutableBuildAssets.pipe(
    Effect.map((assets) => HttpRouter.add("GET", "*", handleStaticAndDevRequest(assets))),
  ),
);
