import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import type { OttoCatalogBackendOptions } from "../tools/OttoCatalogTypes.ts";
import type { resolveOttoMastraModel } from "./OttoModels.ts";

export type OttoWebSearch = NonNullable<OttoCatalogBackendOptions["webSearch"]>;

const WEB_SEARCH_INSTRUCTIONS =
  "Search the web for the request. Answer with the facts you found, concisely, and name the source of each fact. Never answer from memory alone.";

/**
 * Runs WebSearch through the bot's own model and account with that provider's
 * built-in search. Providers without one get no search, so the caller keeps
 * the plain unavailable answer.
 */
export function ottoNativeWebSearch(
  modelId: string,
  model: () => ReturnType<typeof resolveOttoMastraModel>,
  abortSignal?: AbortSignal,
): OttoWebSearch | undefined {
  const searchTool = modelId.startsWith("openai/")
    ? (domains: readonly string[] | undefined) =>
        openai.tools.webSearch(domains ? { filters: { allowedDomains: [...domains] } } : {})
    : modelId.startsWith("anthropic/")
      ? (domains: readonly string[] | undefined) =>
          anthropic.tools.webSearch_20250305({
            maxUses: 5,
            ...(domains ? { allowedDomains: [...domains] } : {}),
          })
      : undefined;

  if (!searchTool) return undefined;

  return async ({ query, domains }) => {
    const searcher = new Agent({
      id: "otto-web-search",
      name: "Otto web search",
      instructions: WEB_SEARCH_INSTRUCTIONS,
      model: model(),
      // SAFETY: AI SDK provider tools are Mastra provider-defined tools; only their optional `type` is declared looser under exactOptionalPropertyTypes.
      tools: { web_search: searchTool(domains) as ToolsInput[string] },
    });

    // The Codex backend accepts only streamed responses.
    const result = await searcher.stream(query, abortSignal ? { abortSignal } : {});
    const [answer, found] = await Promise.all([result.text, result.sources]);
    const sources = new Map<string, string>();

    for (const source of found) {
      const { url, title } = source.payload;

      if (url && !sources.has(url)) sources.set(url, title || url);
    }

    return {
      status: "completed" as const,
      query,
      answer,
      sources: [...sources].map(([url, title]) => ({ title, url })),
    };
  };
}
