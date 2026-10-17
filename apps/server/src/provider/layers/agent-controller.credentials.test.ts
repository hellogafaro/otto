import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { EventId, ProviderDriverKind, ProviderInstanceId, ThreadId, TurnId } from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, describe, expect, vi } from "vite-plus/test";
import { ServerConfig } from "../../config.ts";
import { AgentController } from "../services/agent-controller.ts";
import { LegacyProviderBridge } from "../services/legacy-provider-bridge.ts";
import {
  createOttoMastraAuthStorage,
  agentControllerLayerWith,
  recordProviderAccessHealth,
} from "./agent-controller.ts";
import { makeTestSubscriptionAuthService } from "../../subscription-auth/test-utils/subscription-auth-service.ts";
import { BotUsageLedger } from "../../usage/bot-usage-ledger.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { usageLedgerFixture } from "./test-support/agent-controller-memory.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("provider access health", () => {
  it.each([
    ["codex", "openai-codex"],
    ["claudeAgent", "anthropic"],
    ["grok", "xai"],
    ["kimi", "kimi-for-coding"],
  ] as const)("maps %s runtime requests to %s access health", async (driver, provider) => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-access-map-"));
    const authPath = NodePath.join(directory, "subscription-auth.json");

    try {
      NodeFS.writeFileSync(
        authPath,
        JSON.stringify({
          [provider]: { type: "oauth", access: "a", refresh: "r", expires: 1_900_000_000_000 },
        }),
      );
      const service = await makeTestSubscriptionAuthService(authPath);
      // The default instance reports as the provider-level account.
      const providerInstanceId = ProviderInstanceId.make(driver);

      const base = {
        provider: ProviderDriverKind.make(driver),
        providerInstanceId,
        threadId: ThreadId.make(`thread-${driver}`),
      };

      recordProviderAccessHealth(service, {
        ...base,
        type: "runtime.error",
        eventId: EventId.make(`evt-${driver}-failed`),
        createdAt: "2026-08-30T20:00:00.000Z",
        payload: { message: "The first request failed.", class: "provider_error" },
      });
      expect(
        service.statuses([], 1_800_000_000_000).find((item) => item.provider === provider),
      ).toMatchObject({ health: "failed-first-request" });
      expect(service.providerInstanceHealth(providerInstanceId)).toBe("failed-first-request");

      recordProviderAccessHealth(service, {
        ...base,
        type: "turn.completed",
        eventId: EventId.make(`evt-${driver}-recovered`),
        createdAt: "2026-08-30T20:01:00.000Z",
        turnId: TurnId.make(`turn-${driver}`),
        payload: { state: "completed", stopReason: null },
      });
      expect(
        service.statuses([], 1_800_000_000_000).find((item) => item.provider === provider),
      ).toMatchObject({ health: "recovered" });
      expect(service.providerInstanceHealth(providerInstanceId)).toBe("recovered");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("AgentControllerLive", () => {
  it.effect("reads Otto subscription credentials through Mastra AuthStorage", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const authPath = NodePath.join(config.secretsDir, "subscription-auth.json");
      yield* Effect.sync(() => {
        NodeFS.mkdirSync(config.secretsDir, { recursive: true });
        NodeFS.writeFileSync(
          authPath,
          JSON.stringify({
            "openai-codex": {
              type: "oauth",
              access: "subscription-access",
              refresh: "subscription-refresh",
              expires: 4_102_444_800_000,
              accountId: "account-123",
            },
          }),
        );
      });

      const auth = yield* createOttoMastraAuthStorage(config.secretsDir);
      assert.deepEqual(auth.get("openai-codex"), {
        type: "oauth",
        access: "subscription-access",
        refresh: "subscription-refresh",
        expires: 4_102_444_800_000,
        accountId: "account-123",
      });
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "otto-mastra-auth-test-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});

describe("AgentControllerLive", () => {
  it.effect("passes Otto subscription auth and memory storage to the custom harness", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();

    return provideController(
      Effect.gen(function* () {
        yield* AgentController;
        const options = mastra.harnessOptions[0];
        assert.isDefined(options);
        assert.isDefined(options.authStorage);
        assert.match(options.memoryDbPath, /mastra-observational-memory\.sqlite$/);
      }),
      bridge.service,
      mastra.factory,
    );
  });
});

describe("AgentControllerLive", () => {
  it.effect("preserves the Railway VM when an active session rotates credentials", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const destroy = vi.fn(async () => undefined);

    const makeRemoteWorkspace = vi.fn(
      async (_input: import("../bot-workspace.ts").CreateRemoteBotWorkspaceInput) => ({
        id: "railway-vm",
        provider: "railway" as const,
        workspace: new Workspace({
          filesystem: new LocalFilesystem({ basePath: process.cwd() }),
          sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
        }),
        inspect: async () => "running" as const,
        wake: async () => undefined,
        sleep: async () => undefined,
        destroy,
      }),
    );

    const layer = agentControllerLayerWith({
      makeMastraHarness: mastra.factory,
      makeRemoteWorkspace,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(LegacyProviderBridge, bridge.service),
          Layer.succeed(BotUsageLedger, usageLedgerFixture().service),
          ServerConfig.layerTest(process.cwd(), { prefix: "otto-railway-rotation-test-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
          NodeServices.layer,
        ),
      ),
    );

    return Effect.gen(function* () {
      const controller = yield* AgentController;
      yield* resolveCodex(controller);

      const input = {
        threadId: codexThreadId,
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: codexInstanceId,
        modelSelection: codexSelection,
        runtimeMode: "full-access" as const,
        botSandbox: "railway" as const,
      };

      for (const token of ["old", "new"]) {
        yield* controller.startSession(codexThreadId, {
          ...input,
          botSandboxEnvironment: { RAILWAY_API_TOKEN: token, RAILWAY_ENVIRONMENT_ID: "env" },
        });
      }

      expect(makeRemoteWorkspace).toHaveBeenCalledTimes(2);
      expect(makeRemoteWorkspace.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          workspaceId: makeRemoteWorkspace.mock.calls[1]?.[0]?.workspaceId,
        }),
      );
      expect(destroy).not.toHaveBeenCalled();
      yield* controller.startSession(codexThreadId, { ...input, botSandbox: "e2b" });
      expect(destroy).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(layer), Effect.orDie);
  });
});
