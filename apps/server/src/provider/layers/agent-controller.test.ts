import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  EventId,
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@otto/contracts";
import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import {
  mastraConnectionIssue,
  recordProviderAccessHealth,
  toMcpServerConfigs,
} from "./agent-controller.ts";
import { makeTestSubscriptionAuthService } from "../../subscription-auth/test-utils/subscription-auth-service.ts";

describe("mastraConnectionIssue", () => {
  it("uses the exact instance transport when deciding readiness", () => {
    assert.isUndefined(
      mastraConnectionIssue(
        ProviderDriverKind.make("grok"),
        {
          environment: { XAI_API_KEY: "ambient-key" },
          instanceEnvironment: { XAI_API_KEY: "instance-key" },
          useSavedCredential: false,
        },
        false,
      ),
    );
    assert.include(
      mastraConnectionIssue(
        ProviderDriverKind.make("grok"),
        {
          environment: { XAI_API_KEY: "ambient-key" },
          instanceEnvironment: {},
          useSavedCredential: false,
        },
        true,
      ) ?? "",
      "XAI_API_KEY",
    );
  });
});

describe("mastraConnectionIssue", () => {
  it("requires the provider-wide connection only when the instance opted into it", () => {
    const connection = { environment: {}, instanceEnvironment: {}, useSavedCredential: true };
    assert.isUndefined(
      mastraConnectionIssue(ProviderDriverKind.make("claudeAgent"), connection, true),
    );
    assert.include(
      mastraConnectionIssue(ProviderDriverKind.make("claudeAgent"), connection, false) ?? "",
      "Connect",
    );
  });
});

describe("mastraConnectionIssue", () => {
  it.each([
    [ProviderDriverKind.make("codex"), { OPENAI_API_KEY: "ambient-key" }],
    [ProviderDriverKind.make("claudeAgent"), { ANTHROPIC_API_KEY: "ambient-key" }],
    [ProviderDriverKind.make("grok"), { XAI_API_KEY: "ambient-key" }],
    [ProviderDriverKind.make("opencodeGo"), { OPENCODE_API_KEY: "ambient-key" }],
  ] as const)("accepts ambient credentials for %s without a saved connection", (provider, env) => {
    assert.isUndefined(
      mastraConnectionIssue(
        provider,
        { environment: env, instanceEnvironment: {}, useSavedCredential: true },
        false,
      ),
    );
  });
});

describe("mastraConnectionIssue", () => {
  it("accepts an isolated OpenCode Go inline credential", () => {
    const environment = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: {
          "opencode-go": {
            options: { apiKey: "inline-key", baseURL: "https://inline.example/v1" },
          },
        },
      }),
    };

    assert.isUndefined(
      mastraConnectionIssue(
        ProviderDriverKind.make("opencodeGo"),
        { environment, instanceEnvironment: environment, useSavedCredential: false },
        false,
      ),
    );
  });

  it("gates a Custom API instance on its configured base URL alone", () => {
    const customOpenai = ProviderDriverKind.make("customOpenai");
    assert.isUndefined(
      mastraConnectionIssue(
        customOpenai,
        {
          environment: { CUSTOM_OPENAI_BASE_URL: "http://localhost:11434/v1" },
          instanceEnvironment: {},
          useSavedCredential: true,
        },
        false,
      ),
    );
    // A saved subscription credential is not a substitute for the endpoint:
    // the branch must win over the generic saved-credential path.
    assert.equal(
      mastraConnectionIssue(
        customOpenai,
        { environment: {}, instanceEnvironment: {}, useSavedCredential: true },
        true,
      ),
      "This Custom API instance needs a base URL.",
    );
  });
});

describe("toMcpServerConfigs", () => {
  it("converts only the bot's filtered MCP registrations for Mastra", () => {
    expect(
      toMcpServerConfigs([
        {
          id: McpServerId.make("builtin-exa"),
          name: "Exa",
          transport: "url",
          url: "https://mcp.exa.ai/mcp",
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: McpServerId.make("local-tools"),
          name: "Local tools",
          transport: "stdio",
          command: "bunx",
          args: ["local-tools"],
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ).toEqual({
      "builtin-exa": { url: "https://mcp.exa.ai/mcp" },
      "local-tools": { command: "bunx", args: ["local-tools"] },
    });
  });
});

describe("provider access health", () => {
  it.each(["interrupted", "cancelled"] as const)(
    "does not call a %s turn a successful provider request",
    async (state) => {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-access-stop-"));
      const authPath = NodePath.join(directory, "subscription-auth.json");

      try {
        const service = await makeTestSubscriptionAuthService(authPath);
        recordProviderAccessHealth(service, {
          provider: ProviderDriverKind.make("grok"),
          providerInstanceId: ProviderInstanceId.make("grok"),
          threadId: ThreadId.make("thread-stopped"),
          turnId: TurnId.make("turn-stopped"),
          type: "turn.completed",
          eventId: EventId.make(`evt-health-${state}`),
          createdAt: "2026-08-30T20:00:00.000Z",
          payload: { state, stopReason: null },
        });

        expect(service.providerInstanceHealth("grok")).toBeUndefined();
      } finally {
        NodeFS.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
