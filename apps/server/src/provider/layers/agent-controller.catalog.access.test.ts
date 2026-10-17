import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BotId,
  DelegationId,
  McpServerId,
  ProviderDriverKind,
  ThreadId,
  type OttoDelegationAccessGrant,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, describe, expect, vi } from "vite-plus/test";
import { ServerConfig } from "../../config.ts";
import { Memories } from "../../memory/memories.ts";
import { AgentController } from "../services/agent-controller.ts";
import { LegacyProviderBridge } from "../services/legacy-provider-bridge.ts";
import { agentControllerLayerWith, type AgentControllerLiveOptions } from "./agent-controller.ts";
import { BotUsageLedger } from "../../usage/bot-usage-ledger.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import { makeBridge, makeLayer, resolveCodex } from "./test-support/agent-controller-layers.ts";
import { usageLedgerFixture } from "./test-support/agent-controller-memory.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive", () => {
  it.effect("enforces delegated MCP grants and keeps memory out of delegated turns", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const render = vi.fn(() => Effect.succeed("<memory>never</memory>"));

    const mcpManager = {
      init: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      getTools: vi.fn(() => ({ exa_search: {} })),
      getServerStatuses: vi.fn(() => [{ name: "web", connected: true }]),
    };

    const makeMcpManagerMock = vi.fn((_dataDir, _configDir, _servers) => mcpManager as never);

    const makeMcpManager: NonNullable<AgentControllerLiveOptions["makeMcpManager"]> =
      makeMcpManagerMock;

    const webId = McpServerId.make("web");
    const emailId = McpServerId.make("email");

    const access: OttoDelegationAccessGrant = {
      sandbox: "local",
      runtimeMode: "approval-required",
      enabledMcpServerIds: [webId],
      disabledMcpServerIds: [emailId],
    };

    const runtime = {
      send: vi.fn(async () => ({
        delegationId: DelegationId.make("delegation-child"),
        childThreadId: ThreadId.make("thread-child"),
        childBotId: BotId.make("bot-child"),
        name: "Child",
        phase: "running" as const,
      })),
      sendToUser: vi.fn(async () => {
        throw new Error("not used");
      }),
      parentFinished: vi.fn(async () => undefined),
      accessForThread: () => access,
    };

    const layer = makeLayer(
      bridge.service,
      mastra.factory,
      makeMcpManager,
      undefined,
      undefined,
      undefined,
      runtime,
    ).pipe(Layer.provide(Layer.mock(Memories)({ render })));

    const server = (id: typeof webId, name: string) => ({
      id,
      name,
      transport: "url" as const,
      url: `https://${name}.example/mcp`,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    return Effect.gen(function* () {
      const controller = yield* AgentController;
      yield* resolveCodex(controller);

      const session = yield* controller.startSession(codexThreadId, {
        threadId: codexThreadId,
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        cwd: process.cwd(),
        modelSelection: codexSelection,
        runtimeMode: "approval-required",
        mcpServers: [server(webId, "web"), server(emailId, "email")],
        botId: BotId.make("delegated-bot"),
      });

      expect(session.mcpServerIds).toEqual([webId]);
      expect(makeMcpManagerMock.mock.calls[0]?.[2]).toEqual({
        web: { url: "https://web.example/mcp" },
      });

      const toolIds = mastra.harnessOptions[0]?.toolRuntime
        .toolsForThread(String(codexThreadId))
        .map((tool) => tool.id);

      expect(toolIds).not.toContain("memory_update");
      yield* controller.sendTurn({
        threadId: codexThreadId,
        input: "Do the delegated task.",
        memoryChat: {
          threadId: codexThreadId,
          botId: BotId.make("delegated-bot"),
          groupId: null,
          groupName: "",
          projectId: null,
          projectTitle: "",
          audiencePersonId: null,
          people: [],
        },
      });
      expect(mastra.session.sendMessage).toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(mastra.session.state.get()).not.toHaveProperty("persistentMemoryContext");
    }).pipe(Effect.provide(layer), Effect.orDie);
  });
});

describe("AgentControllerLive", () => {
  it.effect("re-acquires the user-computer workspace when cwd changes locally", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    const layer = agentControllerLayerWith({
      makeMastraHarness: mastra.factory,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(LegacyProviderBridge, bridge.service),
          Layer.succeed(BotUsageLedger, usageLedgerFixture().service),
          ServerConfig.layerTest(process.cwd(), {
            prefix: "otto-mastra-cwd-change-test-",
          }).pipe(Layer.provide(NodeServices.layer)),
        ),
      ),
    );

    return Effect.gen(function* () {
      const controller = yield* AgentController;
      yield* resolveCodex(controller);
      const firstCwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-cwd-a-"));
      const secondCwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-cwd-b-"));

      try {
        const input = {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          modelSelection: codexSelection,
          runtimeMode: "full-access" as const,
        };

        yield* controller.startSession(codexThreadId, { ...input, cwd: firstCwd });
        yield* controller.startSession(codexThreadId, { ...input, cwd: secondCwd });

        const [session] = yield* controller.listSessions();
        assert.equal(session?.cwd, secondCwd);
        // A new Mastra session means the old one and its user-computer
        // workspace lease were torn down instead of reused.
        expect(mastra.createSession).toHaveBeenCalledTimes(2);
      } finally {
        NodeFS.rmSync(firstCwd, { recursive: true, force: true });
        NodeFS.rmSync(secondCwd, { recursive: true, force: true });
      }
    }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(NodeServices.layer))), Effect.orDie);
  });
});
