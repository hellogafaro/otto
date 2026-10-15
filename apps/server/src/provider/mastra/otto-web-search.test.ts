import { describe, expect, it } from "vite-plus/test";
import type { MastraModelConfig } from "@mastra/core/llm";
import { ottoNativeWebSearch } from "./otto-web-search.ts";

type StreamingModel = Extract<MastraModelConfig, { readonly specificationVersion: "v3" }>;

function searchingModel(provider: string) {
  const calls: Array<{ readonly tools: unknown }> = [];

  const model: StreamingModel = {
    specificationVersion: "v3",
    provider,
    modelId: "test-model",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("WebSearch must stream.");
    },
    doStream: async (options: { readonly tools?: unknown }) => {
      calls.push({ tools: options.tools });

      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });

            for (const id of ["s1", "s2"]) {
              controller.enqueue({
                type: "source",
                sourceType: "url",
                id,
                url: "https://bun.sh/blog",
                title: "Bun",
              });
            }

            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({
              type: "text-delta",
              id: "t",
              delta: "Bun 1.4.3 is the latest release.",
            });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  };

  return { model, calls };
}

describe("ottoNativeWebSearch", () => {
  it("leaves providers without built-in search on the unavailable answer", () => {
    const { model } = searchingModel("kimi");

    expect(ottoNativeWebSearch("kimi/kimi-k2", () => model)).toBeUndefined();
    expect(ottoNativeWebSearch("opencode-go/glm-5", () => model)).toBeUndefined();
  });

  it.each([
    ["openai/gpt-6.1-sol", "openai.web_search"],
    ["anthropic/claude-sonnet-5-5", "anthropic.web_search_20250305"],
  ])("searches %s through its provider's search tool", async (modelId, toolId) => {
    const { model, calls } = searchingModel(modelId.split("/")[0]!);
    const search = ottoNativeWebSearch(modelId, () => model);

    const result = await search!({ query: "latest bun release", domains: ["bun.sh"] });

    expect(result).toEqual({
      status: "completed",
      query: "latest bun release",
      answer: "Bun 1.4.3 is the latest release.",
      sources: [{ title: "Bun", url: "https://bun.sh/blog" }],
    });
    expect(JSON.stringify(calls[0]?.tools)).toContain(toolId);
    expect(JSON.stringify(calls[0]?.tools)).toContain("bun.sh");
  });
});
