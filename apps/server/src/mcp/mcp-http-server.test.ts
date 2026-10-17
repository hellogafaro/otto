import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";
import * as McpHttpServer from "./mcp-http-server.ts";

it("normalizes empty successful notification responses to accepted", () => {
  const notificationResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.text("", { status: 200, contentType: "application/json" }),
  );

  expect(notificationResponse.status).toBe(202);

  const resultResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: 1, result: {} }),
  );

  expect(resultResponse.status).toBe(200);
});

it("normalizes only conflict-free scalar allOf constraints", () => {
  expect(
    McpHttpServer.normalizeProviderToolInputSchema({
      type: "object",
      properties: {
        url: {
          anyOf: [
            {
              type: "string",
              description: "parent",
              allOf: [
                { pattern: "^https://" },
                { minLength: 1 },
                { maxLength: 100, description: "child" },
              ],
            },
          ],
        },
      },
    } as never),
  ).toEqual({
    type: "object",
    properties: {
      url: {
        anyOf: [
          {
            type: "string",
            description: "parent",
            pattern: "^https://",
            minLength: 1,
            maxLength: 100,
          },
        ],
      },
    },
  });

  for (const schema of [
    { type: "string", allOf: [{ pattern: "^a" }, { pattern: "b$" }] },
    { type: "string", minLength: 2, allOf: [{ minLength: 1 }] },
    { type: "string", allOf: [{ not: { const: "x" } }] },
    { type: "object", allOf: [{ properties: { a: { type: "string" } } }] },
  ]) {
    expect(McpHttpServer.normalizeProviderToolInputSchema(schema as never)).toEqual(schema);
  }
});

it.effect("terminates HTTP MCP sessions with DELETE", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const serverLayer = McpServer.layerHttp({
        name: "MCP termination test",
        version: "1.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18],
      });

      yield* HttpRouter.serve(serverLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;

      const initializeResponse = yield* httpClient.post("/mcp", {
        headers: { accept: "application/json, text/event-stream" },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`,
          "application/json",
        ),
      });

      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(initializeResponse.status).toBe(200);
      expect(sessionId).not.toBeNull();

      const missingSessionResponse = yield* httpClient.del("/mcp");
      expect(missingSessionResponse.status).toBe(400);

      const unknownSessionResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": "unknown-session" },
      });

      expect(unknownSessionResponse.status).toBe(404);

      const terminateResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": sessionId! },
      });

      expect(terminateResponse.status).toBe(204);

      const reusedSessionResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}`,
          "application/json",
        ),
      });

      expect(reusedSessionResponse.status).toBe(404);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
