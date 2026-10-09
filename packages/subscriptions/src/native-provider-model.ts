import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { DomainError } from "@otto/shared";
import type { NativeModelConfig } from "./native-provider-config";

export function createNativeModel(
  config: NativeModelConfig,
  apiKey: string,
  fetch: typeof globalThis.fetch,
) {
  if (config.provider === "anthropic" && config.protocol === "anthropic")
    return createAnthropic({ apiKey, baseURL: config.baseUrl, fetch })(
      config.id,
    );
  if (config.provider === "anthropic" || config.protocol === "anthropic")
    throw new DomainError("invalid", "Provider protocol mismatch");
  const provider = createOpenAI({ apiKey, baseURL: config.baseUrl, fetch });
  if (config.protocol !== "responses") return provider.chat(config.id);
  const model = provider.responses(config.id);
  const generate = model.doGenerate.bind(model);
  const stream = model.doStream.bind(model);
  const options = (input: Parameters<typeof model.doGenerate>[0]) => ({
    ...input,
    providerOptions: {
      ...input.providerOptions,
      openai: { ...input.providerOptions?.openai, store: false },
    },
  });
  model.doGenerate = (input) => generate(options(input));
  model.doStream = (input) => stream(options(input));
  return model;
}
