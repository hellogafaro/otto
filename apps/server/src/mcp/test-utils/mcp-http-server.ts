import { EnvironmentId, ProviderInstanceId, ThreadId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as McpHttpServer from "../mcp-http-server.ts";

const environmentId = EnvironmentId.make("environment-mcp-test");

const threadId = ThreadId.make("thread-mcp-test");

const invocation = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-mcp-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["image"] as const),
  issuedAt: 1,
};

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const TestLayer = McpHttpServer.ToolRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
);

export { environmentId, threadId, invocation, client, TestLayer };
