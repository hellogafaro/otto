import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import { completeMcpOAuthCallback } from "./mcp-oauth-login.ts";
import {
  MCP_OAUTH_CALLBACK_PATH,
  MCP_OAUTH_CLIENT_METADATA_PATH,
  ottoMcpOAuthClientDocument,
  ottoMcpOAuthIdentity,
} from "./mcp-oauth-public.ts";

/** Serves the client document and callback for a hosted MCP sign-in, or undefined for other paths. */
export function mcpOAuthHttpResponse(
  url: URL,
  publicOrigin: string | null | undefined,
): Response | Promise<Response> | undefined {
  if (url.pathname === MCP_OAUTH_CLIENT_METADATA_PATH) {
    const identity = ottoMcpOAuthIdentity(publicOrigin);

    if (!identity) {
      return new Response("MCP sign-in needs this server's public https address (OTTO_PUBLIC_URL).", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }

    return new Response(JSON.stringify(ottoMcpOAuthClientDocument(identity)), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (url.pathname === MCP_OAUTH_CALLBACK_PATH) {
    return completeMcpOAuthCallback(url.searchParams);
  }

  return undefined;
}

const handle = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);

  if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });

  const config = yield* ServerConfig.ServerConfig;
  const response = mcpOAuthHttpResponse(url.value, config.publicOrigin);

  if (!response) return HttpServerResponse.text("Not Found", { status: 404 });

  return HttpServerResponse.fromWeb(yield* Effect.promise(() => Promise.resolve(response)));
});

export const mcpOAuthRouteLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", MCP_OAUTH_CLIENT_METADATA_PATH, handle);
    yield* router.add("GET", MCP_OAUTH_CALLBACK_PATH, handle);
  }),
);
