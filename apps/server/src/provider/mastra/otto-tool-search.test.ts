import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { OTTO_TOOL_CATALOG } from "@otto/contracts";
import { assert, describe, expect, it } from "vite-plus/test";

import { toolRuntimeFixture } from "../test-support/tool-runtime-fixture.ts";
import { resolveOttoTools } from "./otto-tools.ts";
import { nativeToolSearch } from "./otto-tool-search.ts";

const LOADED = new Set(["search", "connection_read", "connection_check", "bot_update"]);

interface SentTool {
  readonly type: string;
  readonly name?: string;
  readonly description?: string;
  readonly defer_loading?: boolean;
  readonly tools?: ReadonlyArray<SentTool>;
}

/** Sends one request with the bot's tools and returns the JSON body the provider received. */
async function sentTools(
  modelId: string,
  model: (fetch: typeof globalThis.fetch) => Agent["model"],
) {
  const bodies: Array<{ readonly tools?: ReadonlyArray<SentTool> }> = [];

  const capture = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));

      return Response.json({ error: { message: "captured" } }, { status: 400 });
    },
    { preconnect: () => undefined },
  );

  const requestContext = new RequestContext();
  requestContext.setRaw("controller", { resourceId: "thread-defer", session: { modelId } });

  const tools = await resolveOttoTools(requestContext, {
    authStorage: new AuthStorage("/tmp/otto-unused-auth.json"),
    getThreadTools: () => ({}),
    toolRuntime: toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG.filter((tool) => LOADED.has(tool.id)),
    }),
  });

  const agent = new Agent({
    id: "defer",
    name: "defer",
    instructions: "",
    model: model(capture),
    tools,
  });

  await agent.generate("hi", { modelSettings: { maxRetries: 0 } }).catch(() => undefined);

  return bodies[0]?.tools ?? [];
}

describe("native tool search", () => {
  it.each([
    ["openai/gpt-5.6-sol", "openai"],
    ["openai/gpt-5.4", "openai"],
    ["openai/gpt-6", "openai"],
    ["openai/gpt-5.2", null],
    ["anthropic/claude-sonnet-4-5", "anthropic"],
    ["anthropic/claude-opus-5-5[1m]", "anthropic"],
    ["anthropic/claude-opus-4-20250514", null],
    ["xai/grok-4", null],
  ] as const)("%s uses %s", (modelId, search) => {
    expect(nativeToolSearch(modelId)).toBe(search);
  });

  it("sends deferred families as OpenAI namespaces behind tool_search", async () => {
    const tools = await sentTools("openai/gpt-5.6-sol", (fetch) =>
      createOpenAI({ apiKey: "test", fetch }).responses("gpt-5.6-sol"),
    );

    const connections = tools.find((tool) => tool.name === "connections");

    assert.deepEqual(
      tools.map((tool) => [tool.type, tool.name ?? null]),
      [
        ["function", "search"],
        ["namespace", "connections"],
        ["namespace", "bot"],
        ["tool_search", null],
      ],
    );
    expect(connections).toMatchObject({
      description: "Find, add, check and remove the apps and MCP servers this bot can use.",
      tools: [
        { name: "connection_read", defer_loading: true },
        { name: "connection_check", defer_loading: true },
      ],
    });
    assert.notProperty(tools[0], "defer_loading");
  });

  it("marks deferred tools for Anthropic's tool search and keeps the rest loaded", async () => {
    const tools = await sentTools("anthropic/claude-sonnet-4-5", (fetch) =>
      createAnthropic({ apiKey: "test", fetch })("claude-sonnet-4-5"),
    );

    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.defer_loading ?? false]),
      [
        ["search", false],
        ["connection_read", true],
        ["connection_check", true],
        ["bot_update", true],
        ["tool_search_tool_bm25", false],
      ],
    );
  });
});
