import { mcpManagerFixture } from "./test-support/mcp-manager-fixture.ts";
import { describe } from "vite-plus/test";
import type { McpManager } from "@mastra/code-sdk/mcp/index";
import { expect, it, vi } from "vite-plus/test";
import { createOttoCatalogToolHandlers } from "./otto-catalog-tool-handlers.ts";
import { makeOttoCatalogToolHandlersTestSupport } from "./test-support/otto-catalog-tool-handlers.ts";

const { connectedStatus, healthOptions } = makeOttoCatalogToolHandlersTestSupport();

describe("Otto catalog MCP tool handlers", () => {
  it("authenticates through the session manager and reports the authorization URL", async () => {
    const status = {
      name: "search",
      connected: true,
      toolCount: 1,
      toolNames: ["search_web"],
      transport: "http" as const,
    };

    const authenticateServer = vi.fn<McpManager["authenticateServer"]>(
      async (_serverId, options) => {
        options?.onAuthorizationUrl?.("https://example.com/authorize");

        return status;
      },
    );

    const handlers = createOttoCatalogToolHandlers(
      mcpManagerFixture({
        authenticateServer,
      }),
    );

    const emitProgress = vi.fn();

    await expect(
      handlers.connection_check!({
        input: { id: "search", action: "authenticate" },
        emitProgress,
      }),
    ).resolves.toEqual({
      ...status,
      authorizationUrl: "https://example.com/authorize",
    });
    expect(emitProgress).toHaveBeenCalledWith("Authorize MCP server 'search'.", {
      authorizationUrl: "https://example.com/authorize",
    });

    authenticateServer.mockResolvedValueOnce({
      ...status,
      connected: false,
      error: "Authentication cancelled.",
    });
    await expect(
      handlers.connection_check!({
        input: { id: "search", action: "authenticate" },
        emitProgress,
      }),
    ).rejects.toThrow("Authentication cancelled");
  });

  it("reports real request evidence instead of treating a connection as healthy", async () => {
    const manager = mcpManagerFixture({ getServerStatuses: () => [connectedStatus] });

    const handler = createOttoCatalogToolHandlers(
      manager,
      undefined,
      healthOptions({
        getRequestHealth: () => ({
          health: "failed" as const,
          lastSuccessfulRequestAt: "2026-09-01T01:00:00.000Z",
          lastFailedRequest: { at: "2026-09-01T01:30:00.000Z", message: "OAuth expired." },
        }),
      }),
    ).connection_read!;

    await expect(handler({ input: { id: "search" }, emitProgress: vi.fn() })).resolves.toEqual(
      expect.objectContaining({
        connectionState: "connected",
        healthTest: "failed",
        authenticationExpiresAt: null,
        lastFailure: { at: "2026-09-01T01:30:00.000Z", message: "OAuth expired." },
        dependentBots: [{ id: "bot-otto", name: "Otto" }],
        dependentRoutines: [],
      }),
    );
  });

  it.each(["test", "reconnect"] as const)(
    "connection_check %s records the real reconnect result",
    async (action) => {
      const reconnectServer = vi.fn(async () => connectedStatus);

      const manager = mcpManagerFixture({
        getServerStatuses: () => [connectedStatus],
        reconnectServer,
      });

      const recordSuccess = vi.fn();
      const onRecovery = vi.fn();

      const handler = createOttoCatalogToolHandlers(
        manager,
        undefined,
        healthOptions({ recordSuccess, onRecovery }),
      ).connection_check!;

      await expect(
        handler({ input: { id: "search", action }, emitProgress: vi.fn() }),
      ).resolves.toEqual(expect.objectContaining({ connected: true }));
      expect(reconnectServer).toHaveBeenCalledWith("search");
      expect(recordSuccess).toHaveBeenCalledWith("search", "2026-09-01T02:00:00.000Z");
      expect(onRecovery).toHaveBeenCalledOnce();
    },
  );

  it("records and escalates a failed health test", async () => {
    const failed = { ...connectedStatus, connected: false, error: "OAuth expired." };

    const manager = mcpManagerFixture({
      getServerStatuses: () => [connectedStatus],
      reconnectServer: async () => failed,
    });

    const recordFailure = vi.fn();
    const onFailure = vi.fn();

    const handler = createOttoCatalogToolHandlers(
      manager,
      undefined,
      healthOptions({ recordFailure, onFailure }),
    ).connection_check!;

    await expect(
      handler({ input: { id: "search", action: "test" }, emitProgress: vi.fn() }),
    ).rejects.toThrow("OAuth expired");
    expect(recordFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
