import type { createAnthropic } from "@ai-sdk/anthropic";
import { describe } from "vite-plus/test";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { RequestContext } from "@mastra/core/request-context";
import { ProviderDriverKind } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import { it } from "@effect/vitest";
import { assert, expect, vi } from "vite-plus/test";
import {
  createOttoAgentInstructions,
  createOttoBotInstructions,
} from "./otto-agent-instructions.ts";
import {
  mastraModelId,
  resolveOttoInstructions,
  resolveOttoMastraModel,
  withOttoModelRunOptions,
} from "./otto-mastra-harness.ts";

describe("OttoMastraHarness", () => {
  it("routes Codex API keys through OpenAI Responses instead of the OAuth transport", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-api-key-auth.json");

    const getCredential = vi.fn(() => ({
      type: "api-key" as const,
      access: "key",
      baseUrl: "https://proxy.example/v1",
    }));

    expect(
      resolveOttoMastraModel(
        "openai/gpt-5.6",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
      ),
    ).toMatchObject({ modelId: "gpt-5.6", provider: "openai.responses" });
    expect(getCredential).toHaveBeenCalledWith("openai-codex", undefined, undefined);
  });

  it("uses the selected instance key without reading the provider-wide credential", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-instance-auth.json");

    const getCredential = vi.fn(() => ({
      type: "api-key" as const,
      access: "provider-wide-key",
    }));

    expect(
      resolveOttoMastraModel(
        "xai/grok-code-fast-1",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
        {
          environment: {
            XAI_API_KEY: "instance-key",
            XAI_BASE_URL: "https://instance.example/v1",
          },
          instanceEnvironment: {
            XAI_API_KEY: "instance-key",
            XAI_BASE_URL: "https://instance.example/v1",
          },
          useSavedCredential: false,
        },
      ),
    ).toMatchObject({ modelId: "grok-code-fast-1", provider: "xai.chat" });
    expect(getCredential).not.toHaveBeenCalled();
  });

  it("resolves a saved API key for the selected account instance", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-bound-auth.json");

    const getCredential = vi.fn((_provider: string, instanceId?: string) =>
      instanceId === "grok_work" ? { type: "api-key" as const, access: "work-key" } : undefined,
    );

    expect(
      resolveOttoMastraModel(
        "xai/grok-code-fast-1",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
        {
          environment: {},
          instanceEnvironment: {},
          useSavedCredential: true,
          instanceId: "grok_work",
        },
      ),
    ).toMatchObject({ modelId: "grok-code-fast-1", provider: "xai.chat" });
    expect(getCredential).toHaveBeenCalledWith("xai", "grok_work", undefined);
  });

  it("does not leak provider-wide credentials into an isolated instance", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-isolated-auth.json");

    const getCredential = vi.fn(() => ({
      type: "api-key" as const,
      access: "provider-wide-key",
    }));

    assert.throws(
      () =>
        resolveOttoMastraModel(
          "anthropic/claude-fable-5",
          authStorage,
          undefined,
          undefined,
          undefined,
          getCredential,
          { environment: {}, instanceEnvironment: {}, useSavedCredential: false },
        ),
      "has no API key or auth token transport",
    );
    expect(getCredential).not.toHaveBeenCalled();
  });

  it("uses the first nonempty trimmed Claude auth token", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-empty-token-auth.json");

    for (const token of ["", "   "]) {
      expect(
        resolveOttoMastraModel(
          "anthropic/claude-opus-4-6",
          authStorage,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            environment: {},
            instanceEnvironment: {
              ANTHROPIC_AUTH_TOKEN: token,
              CLAUDE_CODE_OAUTH_TOKEN: "  valid-token  ",
            },
            useSavedCredential: false,
          },
        ),
      ).toMatchObject({ modelId: "claude-opus-4-6", provider: "anthropic.messages" });
    }
  });

  it("translates Claude 1M model selections into API headers for every credential transport", async () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-context-auth.json");
    const requests: Array<{ body: unknown; beta: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
        async (_input, init) => {
          requests.push({
            body: init?.body,
            beta: new Headers(init?.headers).get("anthropic-beta"),
          });

          return Response.json({
            id: "msg-context",
            type: "message",
            role: "assistant",
            model: "claude-opus-4-6",
            content: [{ type: "text", text: "Done" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      ),
    );

    try {
      for (const transport of ["environment", "saved-key", "oauth"] as const) {
        const model = resolveOttoMastraModel(
          "anthropic/claude-opus-4-6[1m]",
          authStorage,
          undefined,
          undefined,
          undefined,
          transport === "saved-key" ? () => ({ type: "api-key", access: "saved-key" }) : undefined,
          {
            environment: transport === "environment" ? { ANTHROPIC_API_KEY: "env-key" } : {},
            instanceEnvironment: {},
            useSavedCredential: true,
          },
        ) as ReturnType<ReturnType<typeof createAnthropic>>;

        await model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
          maxOutputTokens: 32,
        });
      }

      expect(requests).toHaveLength(3);

      for (const request of requests) {
        expect(request.body).toContain('"model":"claude-opus-4-6"');
        expect(request.body).not.toContain("[1m]");
        expect(request.beta).toContain("context-1m-2025-08-07");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Kimi model names on the Kimi subscription transport", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-auth.json");
    assert.equal(
      mastraModelId(ProviderDriverKind.make("kimi"), "k3-256k"),
      "kimi-for-coding/k3-256k",
    );
    assert.deepInclude(
      resolveOttoMastraModel("kimi-for-coding/k3-256k", authStorage, async () => ({
        accessToken: "kimi-access",
        deviceId: "0123456789abcdef0123456789abcdef",
      })),
      { provider: "anthropic.messages", modelId: "k3-256k" },
    );
    assert.throws(
      () => resolveOttoMastraModel("kimi-for-coding/k3-256k", authStorage),
      "subscription access is unavailable",
    );
  });

  it("keeps OpenCode Go model names on the direct subscription transport", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-auth.json");
    assert.equal(
      mastraModelId(ProviderDriverKind.make("opencodeGo"), "gpt-5.6-luna"),
      "opencode-go/gpt-5.6-luna",
    );
    assert.deepInclude(
      resolveOttoMastraModel("opencode-go/gpt-5.6-luna", authStorage, undefined, async () => ({
        access: "go-key",
      })),
      { provider: "opencode-go.responses", modelId: "gpt-5.6-luna" },
    );
    assert.throws(
      () => resolveOttoMastraModel("opencode-go/gpt-5.6-luna", authStorage),
      "subscription access is unavailable",
    );
  });

  it("uses an isolated OpenCode Go inline connection", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-inline-opencode-auth.json");

    const getCredential = vi.fn(() => ({
      type: "api-key" as const,
      access: "provider-wide-key",
    }));

    const environment = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: {
          "opencode-go": {
            options: { apiKey: "inline-key", baseURL: "https://inline.example/v1" },
          },
        },
      }),
    };

    assert.deepInclude(
      resolveOttoMastraModel(
        "opencode-go/gpt-5.6-luna",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
        { environment, instanceEnvironment: environment, useSavedCredential: false },
      ),
      { provider: "opencode-go.responses", modelId: "gpt-5.6-luna" },
    );
    expect(getCredential).not.toHaveBeenCalled();
  });

  it("routes a Custom API model through its configured base URL and key", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-custom-openai-auth.json");
    expect(
      resolveOttoMastraModel(
        "custom-openai/local-model",
        authStorage,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          environment: {
            CUSTOM_OPENAI_API_KEY: "custom-key",
            CUSTOM_OPENAI_BASE_URL: "http://localhost:11434/v1",
          },
          instanceEnvironment: {},
          useSavedCredential: true,
        },
      ),
    ).toMatchObject({ modelId: "local-model", provider: "custom-openai.chat" });
    expect(() =>
      resolveOttoMastraModel(
        "custom-openai/local-model",
        authStorage,
        undefined,
        undefined,
        undefined,
        undefined,
        { environment: {}, instanceEnvironment: {}, useSavedCredential: true },
      ),
    ).toThrow(/needs a base URL/);
  });

  it("routes Claude and Grok models through their subscription transports", () => {
    const authStorage = new AuthStorage("/tmp/otto-unused-legacy-observer-auth.json");

    const getCredential = vi.fn((provider: string) =>
      provider === "anthropic"
        ? { type: "api-key" as const, access: "claude-key" }
        : { type: "api-key" as const, access: "grok-key" },
    );

    assert.equal(
      mastraModelId(ProviderDriverKind.make("claudeAgent"), "claude-sonnet-4-5"),
      "anthropic/claude-sonnet-4-5",
    );
    assert.deepInclude(
      resolveOttoMastraModel(
        "anthropic/claude-sonnet-4-5",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
      ),
      { provider: "anthropic.messages", modelId: "claude-sonnet-4-5" },
    );
    assert.equal(mastraModelId(ProviderDriverKind.make("grok"), "grok-4"), "xai/grok-4");
    assert.equal(mastraModelId(ProviderDriverKind.make("grok"), "grok-build"), "xai/grok-4.7");
    assert.deepInclude(
      resolveOttoMastraModel(
        "xai/grok-4",
        authStorage,
        undefined,
        undefined,
        undefined,
        getCredential,
      ),
      { provider: "xai.chat", modelId: "grok-4" },
    );
  });

  it("builds a compact, human prompt with the bot name and current date", () => {
    const instructions = createOttoAgentInstructions({
      name: "  Research\nBot  ",
      now: DateTime.makeUnsafe("2026-09-02T12:00:00.000Z"),
    });

    assert.include(instructions, "You are Research Bot, a sharp, curious general assistant");
    assert.include(instructions, "Today is Wednesday, September 2, 2026");
    assert.include(instructions, "Write with judgment");
    assert.include(instructions, "Before sending, cut filler");
    assert.include(instructions, "Name every drawback");
    assert.include(instructions, "Never use em or en dashes");
    assert.include(instructions, "enabled plugins");
    assert.include(instructions, "Prefer preview_* tools over browser_* tools");
    assert.include(instructions, "Own the requested outcome");
    assert.include(instructions, "Carry multi-step work through implementation");
    assert.include(instructions, "Never report success before");
    assert.include(instructions, "otto_list_routines");
    assert.notInclude(instructions, "—");
    assert.notInclude(instructions, "coding agent");
    assert.isBelow(createOttoBotInstructions({ now: DateTime.nowUnsafe() }).length, 3_500);
  });

  it("passes the saved Codex service tier to Mastra provider options", () => {
    expect(
      withOttoModelRunOptions(
        { providerOptions: { anthropic: { fallback: true }, openai: { store: false } } },
        { modelOptions: { serviceTier: "priority" } },
      ),
    ).toEqual({
      providerOptions: {
        anthropic: { fallback: true },
        openai: { store: false, serviceTier: "priority" },
      },
    });
  });

  it("adds reply and status rules only to bot conversations", () => {
    const now = DateTime.makeUnsafe("2026-09-02T12:00:00.000Z");
    const regular = new RequestContext();
    regular.setRaw("controller", { state: { botConversation: false } });
    const bot = new RequestContext();
    bot.setRaw("controller", {
      state: { botConversation: true, botName: "Mina", personalityTone: 20 },
    });

    assert.equal(resolveOttoInstructions(regular, now), createOttoAgentInstructions({ now }));
    assert.equal(
      resolveOttoInstructions(bot, now),
      createOttoBotInstructions({ name: "Mina", now, personalityTone: 20 }),
    );
    assert.include(resolveOttoInstructions(bot, now), "You are Mina");
    assert.include(resolveOttoInstructions(bot, now), "20/100, a 80% chill");
    assert.include(resolveOttoInstructions(bot, now), "Before you use a tool");
    assert.include(resolveOttoInstructions(bot, now), "automatic continuation");
  });

  it("appends saved MCP server guidance to the system prompt", () => {
    const now = DateTime.makeUnsafe("2026-09-02T12:00:00.000Z");
    const context = new RequestContext();
    context.setRaw("controller", {
      state: {
        botConversation: false,
        mcpInstructions: "MCP server guidance:\n- Docs (docs): Search first.",
      },
    });

    assert.equal(
      resolveOttoInstructions(context, now),
      `${createOttoAgentInstructions({ now })}\n\nMCP server guidance:\n- Docs (docs): Search first.`,
    );
  });

  it("lists the bot's saved skills after MCP guidance", () => {
    const now = DateTime.makeUnsafe("2026-09-02T12:00:00.000Z");
    const context = new RequestContext();
    context.setRaw("controller", {
      state: {
        botConversation: false,
        mcpInstructions: "MCP server guidance:",
        skillsContext: "Saved skills you can use.\n- Weekly report (skillId: s1)",
        persistentMemoryContext: "<memory />",
      },
    });

    assert.equal(
      resolveOttoInstructions(context, now),
      `${createOttoAgentInstructions({ now })}\n\nMCP server guidance:\n\nSaved skills you can use.\n- Weekly report (skillId: s1)\n\n<memory />`,
    );
  });
});
