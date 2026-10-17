import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { ToolsInput } from "@mastra/core/agent";
import { OTTO_TOOL_FAMILIES } from "@otto/contracts";

export type OttoToolSearch = "openai" | "anthropic";

/**
 * The provider's own tool search, when the model has one: OpenAI from GPT-5.4 and Anthropic
 * from Claude 4.5. Other models get every tool up front.
 */
export function nativeToolSearch(modelId: string): OttoToolSearch | null {
  const gpt = /^openai\/gpt-(\d+)(?:\.(\d+))?/.exec(modelId);

  if (gpt) {
    const [major, minor] = [Number(gpt[1]), Number(gpt[2] ?? 0)];

    return major > 5 || (major === 5 && minor >= 4) ? "openai" : null;
  }

  const claude = /^anthropic\/claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(
    modelId,
  );

  if (!claude) return null;
  const [major, minor] = [Number(claude[1]), Number(claude[2] ?? 0)];

  return major > 4 || (major === 4 && minor >= 5) ? "anthropic" : null;
}

/** Marks a tool of a deferred family so the model loads it through tool search. */
export function deferredToolOptions(search: OttoToolSearch, toolId: string) {
  const family = OTTO_TOOL_FAMILIES.find((candidate) =>
    candidate.tools.some((tool) => tool === toolId),
  );

  if (!family) return undefined;

  return search === "openai"
    ? {
        openai: {
          deferLoading: true,
          namespace: { name: family.name, description: family.description },
        },
      }
    : { anthropic: { deferLoading: true } };
}

export function toolSearchTool(search: OttoToolSearch): ToolsInput[string] {
  // SAFETY: AI SDK provider tools are Mastra provider-defined tools; only their optional `type` is declared looser under exactOptionalPropertyTypes.
  return (
    search === "openai" ? openai.tools.toolSearch() : anthropic.tools.toolSearchBm25_20251119()
  ) as ToolsInput[string];
}
