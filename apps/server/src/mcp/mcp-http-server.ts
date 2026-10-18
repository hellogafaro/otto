import * as Predicate from "effect/Predicate";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Types from "effect/Types";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import packageJson from "../../package.json" with { type: "json" };
import * as McpInvocationContext from "./mcp-invocation-context.ts";
import * as McpSessionRegistry from "./mcp-session-registry.ts";
import { registerImageTool } from "./image-tool-registration.ts";

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": "Bearer",
    },
  },
);

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

export const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    Predicate.isTagged(response.body, "Empty") ||
    (Predicate.isTagged(response.body, "Uint8Array") && response.body.contentLength === 0) ||
    (Predicate.isTagged(response.body, "Raw") && response.body.contentLength === 0);

  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

const makeMcpAuthMiddleware = McpSessionRegistry.McpSessionRegistry.pipe(
  Effect.map(
    (registry): McpAuthMiddleware =>
      Effect.fn("McpHttpServer.authenticateRequest")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const authorization = request.headers.authorization;

        const token =
          authorization?.startsWith("Bearer ") === true
            ? authorization.slice("Bearer ".length).trim()
            : "";

        const invocation = yield* registry.resolve(token);

        if (!invocation) {
          // Without this the only symptom of a dead credential is the agent
          // quietly losing the whole `otto` toolkit for the rest of its
          // session, with nothing on the server to explain why.
          yield* Effect.logWarning("rejected MCP request with an unusable credential", {
            reason: token.length === 0 ? "missing_bearer_token" : "unknown_or_expired_token",
          });

          return unauthorized;
        }

        return yield* httpEffect.pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.map(normalizeMcpHttpResponse),
        );
      }),
  ),
  Effect.withSpan("McpHttpServer.makeAuthMiddleware"),
);

const McpAuthMiddlewareLive = HttpRouter.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(makeMcpAuthMiddleware).layer;

export const ToolRegistrationLive = Layer.mergeAll(Layer.effectDiscard(registerImageTool()));

const McpTransportLive = McpServer.layerHttp({
  name: "Otto",
  version: packageJson.version,
  path: "/mcp",
  protocols: [McpProtocol.v2025_06_18],
}).pipe(Layer.provide(McpAuthMiddlewareLive));

export const layer = ToolRegistrationLive.pipe(Layer.provideMerge(McpTransportLive));

export { normalizeProviderToolInputSchema } from "./mcp-tool-schema.ts";

export { IMAGE_TOOL_DESCRIPTION } from "./image-tool-registration.ts";
