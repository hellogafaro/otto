import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  ApprovalRequestId,
  EnvironmentId,
  McpServerId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe, expect, vi } from "vite-plus/test";
import { AgentController } from "../services/agent-controller.ts";
import {
  mcpServerIdForToolName,
  toMcpServerConfigs,
  usesMastraCode,
  type AgentControllerLiveOptions,
} from "./agent-controller.ts";
import { SubscriptionAuthService } from "../../subscription-auth/service.ts";
import { withMcpRuntimeHeaders } from "../mcp-server-config.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";

describe("usesMastraCode", () => {
  it("gives catalog tools, workers included, only to Mastra-backed providers", () => {
    for (const provider of ["codex", "claudeAgent", "grok", "kimi", "opencodeGo"]) {
      expect(usesMastraCode(ProviderDriverKind.make(provider))).toBe(true);
    }

    // Standard OpenCode runs on the legacy bridge, which registers no tool session.
    expect(usesMastraCode(ProviderDriverKind.make("opencode"))).toBe(false);
  });
});

describe("toMcpServerConfigs", () => {
  it("attributes namespaced MCP tools to the exact server id", () => {
    expect(
      mcpServerIdForToolName(
        [McpServerId.make("builtin-exa"), McpServerId.make("builtin-exa-search")],
        "builtin-exa-search_find",
      ),
    ).toBe("builtin-exa-search");
    expect(mcpServerIdForToolName([McpServerId.make("builtin-exa")], "read_file")).toBeUndefined();
  });
});

describe("toMcpServerConfigs", () => {
  it("forwards transient MCP headers without adding them to the server record", () => {
    const server = withMcpRuntimeHeaders(
      {
        id: McpServerId.make("composio-session"),
        name: "Composio",
        transport: "url" as const,
        url: "https://app.composio.dev/tool_router/v3/session/mcp",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      { "x-api-key": "project-key" },
    );

    expect(toMcpServerConfigs([server])).toEqual({
      "composio-session": {
        url: "https://app.composio.dev/tool_router/v3/session/mcp",
        headers: { "x-api-key": "project-key" },
      },
    });
    expect(server).not.toHaveProperty("headers");
  });
});

describe("AgentControllerLive", () => {
  it.effect("fails closed for MCP tools missing from the manager index", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    const mcpManager = {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({
        indexed_read: { mcp: { annotations: { readOnlyHint: true } } },
        ask_user: { mcp: { annotations: {} } },
      })),
      getServerStatuses: vi.fn(() => []),
    };

    const makeMcpManager: NonNullable<AgentControllerLiveOptions["makeMcpManager"]> = vi.fn(
      () => mcpManager as never,
    );

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
          mcpServers: [
            {
              id: McpServerId.make("mcp-test"),
              name: "Test MCP",
              transport: "url",
              url: "https://example.com/mcp",
              enabled: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });

        const events: ProviderRuntimeEvent[] = [];

        const eventsFiber = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Effect.yieldNow;
        yield* controller.sendTurn({ threadId: codexThreadId, input: "Use tools." });

        for (const [toolCallId, toolName, args] of [
          ["builtin-safe", "execute_command", { command: "bun test" }],
          ["indexed-read", "indexed_read", { query: "status" }],
          ["connector-name-collision", "ask_user", { prompt: "Run connector action" }],
          ["missing-index", "new_mcp_tool", { value: "unknown" }],
        ] as const) {
          mastra.emit({
            type: "tool_approval_required",
            toolCallId,
            toolName,
            args,
          } as AgentControllerEvent);
        }

        yield* Effect.yieldNow;

        expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
          toolCallId: "builtin-safe",
          decision: "approve",
        });
        expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
          toolCallId: "indexed-read",
          decision: "approve",
        });
        expect(events.filter((event) => event.type === "request.opened")).toEqual([
          expect.objectContaining({
            requestId: "connector-name-collision",
            payload: expect.objectContaining({ target: "ask_user" }),
          }),
          expect.objectContaining({
            requestId: "missing-index",
            payload: expect.objectContaining({ target: "new_mcp_tool" }),
          }),
        ]);
        yield* Fiber.interrupt(eventsFiber);
      }),
      bridge.service,
      mastra.factory,
      makeMcpManager,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("attaches the globally installed MCP servers selected for the bot", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-mcp-"));

    const mcpManager = {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({ "builtin-exa_search": {} })),
      getServerStatuses: vi.fn(() => [{ name: "builtin-exa", connected: true }]),
    };

    const makeMcpManagerMock = vi.fn((_dataDir, _configDir, _servers) => mcpManager as never);

    const makeMcpManager: NonNullable<AgentControllerLiveOptions["makeMcpManager"]> =
      makeMcpManagerMock;

    const exaServer = {
      id: McpServerId.make("builtin-exa"),
      name: "Exa",
      transport: "url" as const,
      url: "https://mcp.exa.ai/mcp",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);

        const session = yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
          mcpServers: [exaServer],
        });

        assert.deepEqual(session.mcpServerIds, [exaServer.id]);
        expect(makeMcpManagerMock).toHaveBeenCalledOnce();
        expect(makeMcpManagerMock.mock.calls[0]?.[2]).toEqual({
          "builtin-exa": { url: "https://mcp.exa.ai/mcp" },
        });
        expect(mcpManager.init).toHaveBeenCalledOnce();
        assert.property(
          mastra.harnessOptions[0]?.getThreadTools(String(codexThreadId)),
          "builtin-exa_search",
        );
        expect(mastra.session.permissions.setForTool).toHaveBeenCalledWith({
          toolName: "builtin-exa_search",
          policy: "ask",
        });

        yield* controller.sendTurn({ threadId: codexThreadId, input: "Search." });
        mastra.emit({
          type: "tool_approval_required",
          toolCallId: "exa-tool-1",
          toolName: "builtin-exa_search",
          args: { operation: "read" },
        } as AgentControllerEvent);
        yield* controller.respondToRequest({
          threadId: codexThreadId,
          requestId: ApprovalRequestId.make("exa-tool-1"),
          decision: "accept",
        });
        mastra.emit({
          type: "tool_end",
          toolCallId: "exa-tool-1",
          result: "failed",
          isError: true,
          denied: false,
        } as AgentControllerEvent);
        expect(
          (yield* SubscriptionAuthService.forSecretsDir(
            NodePath.join(baseDir, "userdata", "secrets"),
          )).mcpRequestHealth(exaServer.id)?.health,
        ).toBe("failed-first-request");

        mastra.emit({
          type: "tool_start",
          toolCallId: "exa-tool-2",
          toolName: "builtin-exa_search",
          args: { operation: "read" },
        } as AgentControllerEvent);
        mastra.emit({
          type: "tool_end",
          toolCallId: "exa-tool-2",
          result: "ok",
          isError: false,
          denied: false,
        } as AgentControllerEvent);
        expect(
          (yield* SubscriptionAuthService.forSecretsDir(
            NodePath.join(baseDir, "userdata", "secrets"),
          )).mcpRequestHealth(exaServer.id)?.health,
        ).toBe("recovered");
        mastra.finishSend();

        yield* controller.stopSession({ threadId: codexThreadId });
        expect(mcpManager.disconnect).toHaveBeenCalledOnce();
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      makeMcpManager,
      baseDir,
      undefined,
      {
        issueMcpCredential: ({ threadId, providerInstanceId }) =>
          Effect.succeed({
            config: {
              environmentId: EnvironmentId.make("environment-preview-test"),
              threadId,
              providerSessionId: "provider-session-preview-test",
              providerInstanceId,
              endpoint: "http://127.0.0.1:15070/mcp",
              authorizationHeader: "Bearer preview-test",
            },
          }),
        revokeMcpCredential: () => Effect.void,
      },
    );
  });
});
