import { buildOpenAICodexOAuthFetch } from "@mastra/code-sdk/providers/openai-codex";
import type { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { createOpenAI } from "@ai-sdk/openai";
import { Predicate } from "effect";
import type { ApiKeyCredential } from "../subscription-auth/types.ts";
import { subscriptionRequestUrl } from "../subscription-auth/runtime.ts";

type OpenAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function buildOttoOpenAIFetch(
  getCredential: () => ApiKeyCredential | undefined,
  request: OpenAIFetch = globalThis.fetch,
): OpenAIFetch {
  return async (input, init) => {
    const credential = getCredential();

    if (!credential)
      throw new Error("The OpenAI API key is no longer connected. Start a new turn.");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("Authorization", `Bearer ${credential.access}`);
    headers.delete("chatgpt-account-id");

    return request(subscriptionRequestUrl(input, OPENAI_BASE_URL, credential.baseUrl), {
      ...init,
      headers,
      redirect: "error",
    });
  };
}

type OpenAIResponsesModel = ReturnType<ReturnType<typeof createOpenAI>["responses"]>;

type OpenAICallOptions = Parameters<OpenAIResponsesModel["doStream"]>[0];

/** Codex wants a top-level instructions string; with no system prompt it gets this one. */
const CODEX_FALLBACK_INSTRUCTIONS = "You are a helpful assistant.";

function withCallOptions(
  model: OpenAIResponsesModel,
  transform: (params: OpenAICallOptions) => OpenAICallOptions,
) {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: (params: OpenAICallOptions) => model.doGenerate(transform(params)),
    doStream: (params: OpenAICallOptions) => model.doStream(transform(params)),
  };
}

/** The prompt cache a request uses: the one its prompt chose (a group bot's own), else its chat's. */
function promptCacheKey(params: OpenAICallOptions, threadId: string | undefined) {
  const chosen = params.providerOptions?.openai?.["promptCacheKey"];

  return Predicate.isString(chosen) ? chosen : threadId;
}

/** Routes every request of one chat, or of one bot in a group, to the same prompt cache. */
function withPromptCacheKey(params: OpenAICallOptions, threadId: string | undefined) {
  const key = promptCacheKey(params, threadId);

  if (!key) return params;

  return {
    ...params,
    providerOptions: {
      ...params.providerOptions,
      openai: { ...params.providerOptions?.openai, promptCacheKey: key },
    },
  };
}

export function ottoOpenAIProvider(
  modelId: string,
  getCredential: () => ApiKeyCredential | undefined,
  threadId?: string,
) {
  const model = createOpenAI({
    apiKey: "otto-api-key",
    baseURL: OPENAI_BASE_URL,
    // SAFETY: The SDK accepts this Fetch API implementation; Bun ambient types add preconnect, which the SDK never calls.
    fetch: buildOttoOpenAIFetch(getCredential) as NonNullable<
      NonNullable<Parameters<typeof createOpenAI>[0]>["fetch"]
    >,
  }).responses(modelId);

  return withCallOptions(model, (params) => withPromptCacheKey(params, threadId));
}

/**
 * The ChatGPT subscription transport. The leading system message becomes Codex's top-level
 * instructions, so the bot's own prompt replaces the SDK's CLI stub; raw native efforts pass
 * through, with medium when none is set.
 */
export function ottoCodexOAuthProvider(
  modelId: string,
  authStorage: AuthStorage,
  threadId?: string,
) {
  const model = createOpenAI({
    apiKey: "oauth-placeholder",
    fetch: buildOpenAICodexOAuthFetch({ authStorage }),
  }).responses(modelId);

  return withCallOptions(model, (params) => {
    const sessionId = promptCacheKey(params, threadId);
    const [first, ...rest] = params.prompt;
    const instructions = first?.role === "system" ? first.content : undefined;
    const openai = params.providerOptions?.openai;
    const { topP: _topP, ...withoutTopP } = params;

    return withPromptCacheKey(
      {
        ...(params.temperature !== undefined ? withoutTopP : params),
        // Otto: the ChatGPT backend routes a session to the server holding its prompt cache.
        ...(sessionId
          ? {
              headers: {
                ...params.headers,
                "session-id": sessionId,
                "x-client-request-id": sessionId,
              },
            }
          : {}),
        prompt: instructions === undefined ? params.prompt : rest,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...openai,
            instructions: instructions ?? CODEX_FALLBACK_INSTRUCTIONS,
            store: false,
            reasoningEffort: openai?.reasoningEffort ?? "medium",
          },
        },
      },
      threadId,
    );
  });
}
