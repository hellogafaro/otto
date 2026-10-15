import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { opencodeClaudeMaxProvider } from "@mastra/code-sdk/providers/claude-max";
import { xaiProvider } from "@mastra/code-sdk/providers/xai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type SubscriptionProviderId, type ProviderDriverKind } from "@otto/contracts";
import type { SubscriptionAuthService } from "../../subscription-auth/service.ts";
import { ottoCodexOAuthProvider, ottoOpenAIProvider } from "../otto-open-ai-provider.ts";
import { ottoKimiProvider, type OttoKimiAccess } from "../otto-kimi-provider.ts";
import {
  ottoOpenCodeGoProvider,
  type OttoOpenCodeGoAccess,
} from "../otto-open-code-go-provider.ts";
import { type OttoMastraState } from "./otto-harness-types.ts";

const decodeInlineConfig = Schema.decodeUnknownSync(
  Schema.Struct({ provider: Schema.optionalKey(Schema.Unknown) }),
);

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-sol";

export type OttoRunOptions = {
  readonly providerOptions?: unknown;
  readonly requireToolApproval?: boolean | ((input: { readonly toolName: string }) => boolean);
};

export function withOttoModelRunOptions<Options extends OttoRunOptions>(
  runOptions: Options,
  state: OttoMastraState,
) {
  const modelOptions = state.modelOptions;

  if (!modelOptions) return runOptions;

  const namespace =
    modelOptions.namespace ??
    (modelOptions.effort !== undefined || modelOptions.thinking !== undefined
      ? "anthropic"
      : "openai");

  const reasoningEffort =
    modelOptions.reasoningEffort === "off" ? "none" : modelOptions.reasoningEffort;

  const providerOptions = Predicate.isObject(runOptions.providerOptions)
    ? runOptions.providerOptions
    : {};

  const existing = providerOptions[namespace];

  const priorOptions = Predicate.isObject(existing) ? existing : {};

  const native = {
    ...priorOptions,
    ...(reasoningEffort && reasoningEffort !== "default"
      ? { reasoningEffort, ...(namespace === "openai" ? { forceReasoning: true } : {}) }
      : {}),
    ...(modelOptions.serviceTier ? { serviceTier: modelOptions.serviceTier } : {}),
    ...(modelOptions.effort && modelOptions.effort !== "default"
      ? { effort: modelOptions.effort }
      : {}),
    ...(modelOptions.thinking !== undefined
      ? {
          thinking: {
            type: modelOptions.thinking ? (modelOptions.thinkingMode ?? "adaptive") : "disabled",
          },
        }
      : {}),
  };

  return { ...runOptions, providerOptions: { ...providerOptions, [namespace]: native } };
}

export const MASTRA_MODEL_PREFIX = {
  codex: "openai",
  claudeAgent: "anthropic",
  grok: "xai",
  kimi: "kimi-for-coding",
  opencodeGo: "opencode-go",
  customOpenai: "custom-openai",
} as const;

export function mastraModelId(provider: ProviderDriverKind, model: string): string {
  const trimmed = provider === "grok" && model.trim() === "grok-build" ? "grok-4.7" : model.trim();
  const prefix = Object.entries(MASTRA_MODEL_PREFIX).find(([driver]) => driver === provider)?.[1];

  if (!prefix) return trimmed.includes("/") ? trimmed : `${provider}/${trimmed}`;
  const token = `${prefix}/`;

  return trimmed.startsWith(token) ? trimmed : `${token}${trimmed}`;
}

export function openCodeGoInlineConnection(environment: NodeJS.ProcessEnv | undefined) {
  const content = environment?.OPENCODE_CONFIG_CONTENT?.trim();

  if (!content) return {};

  try {
    const parsed = decodeInlineConfig(JSON.parse(content));
    const provider = parsed.provider;

    const go =
      Predicate.isObject(provider) && "opencode-go" in provider
        ? provider["opencode-go"]
        : undefined;

    const options =
      Predicate.isObject(go) && "options" in go && Predicate.isObject(go.options) ? go.options : {};

    const apiKey =
      "apiKey" in options && Predicate.isString(options.apiKey) ? options.apiKey.trim() : "";

    const baseUrl =
      "baseURL" in options && Predicate.isString(options.baseURL) ? options.baseURL.trim() : "";

    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  } catch {
    return {};
  }
}

export function resolveOttoMastraModel(
  modelId: string,
  authStorage: AuthStorage,
  getKimiAccess?: (instanceId?: string, threadId?: string) => Promise<OttoKimiAccess | undefined>,
  getOpenCodeGoApiKey?: (
    instanceId?: string,
    threadId?: string,
  ) => Promise<OttoOpenCodeGoAccess | undefined>,
  _modelOptions?: OttoMastraState["modelOptions"],
  getSubscriptionApiKey?: SubscriptionAuthService["getApiKeyCredential"],
  connection?: {
    readonly environment: NodeJS.ProcessEnv;
    readonly instanceEnvironment: NodeJS.ProcessEnv;
    readonly useSavedCredential: boolean;
    readonly instanceId?: string;
  },
  getSubscriptionOAuth?: SubscriptionAuthService["getOAuthCredential"],
  getSubscriptionAccessToken?: SubscriptionAuthService["getAccessToken"],
  /** The thread this request serves, so its outcome is recorded on the account it used. */
  threadId?: string,
) {
  const trimmed = modelId.trim();

  const environment = connection?.useSavedCredential
    ? connection.environment
    : connection?.instanceEnvironment;

  const useSavedCredential = connection?.useSavedCredential !== false;
  const instanceId = connection?.instanceId;

  const savedApiKey = (provider: Parameters<NonNullable<typeof getSubscriptionApiKey>>[0]) =>
    getSubscriptionApiKey?.(provider, instanceId, threadId);

  // OAuth token refresh stays on the account selected for this model's transport.
  const scopedAuthStorage = (providerId: SubscriptionProviderId) => {
    if (!getSubscriptionOAuth || !getSubscriptionAccessToken) return authStorage;
    const credential = getSubscriptionOAuth(providerId, instanceId, threadId);

    // SAFETY: The scoped view inherits AuthStorage methods and state, and overrides only credential lookup.
    return Object.assign(Object.create(authStorage) as AuthStorage, {
      reload: () => {},
      get: (provider: string) => (provider === providerId ? credential : undefined),
      getApiKey: (provider: string) =>
        provider === providerId && credential
          ? getSubscriptionAccessToken(providerId, credential.scope ?? instanceId)
          : undefined,
    });
  };

  if (trimmed.startsWith("openai/")) {
    const instanceApiKey = environment?.OPENAI_API_KEY?.trim();

    const getCredential = instanceApiKey
      ? () => ({
          type: "api-key" as const,
          access: instanceApiKey,
          ...(environment?.OPENAI_BASE_URL?.trim()
            ? { baseUrl: environment.OPENAI_BASE_URL.trim() }
            : {}),
        })
      : useSavedCredential
        ? () => savedApiKey("openai-codex")
        : undefined;

    const credential = getCredential?.();

    if (credential) {
      return ottoOpenAIProvider(trimmed.slice("openai/".length), () => credential);
    }

    if (!useSavedCredential) {
      throw new Error("This Codex instance has no OPENAI_API_KEY transport for Otto Mastra.");
    }

    return ottoCodexOAuthProvider(
      trimmed.slice("openai/".length),
      scopedAuthStorage("openai-codex"),
    );
  }

  if (trimmed.startsWith("anthropic/")) {
    const selectedModel = trimmed.slice("anthropic/".length);
    const extendedContext = selectedModel.endsWith("[1m]");
    const model = extendedContext ? selectedModel.slice(0, -4) : selectedModel;

    const contextHeaders = extendedContext
      ? { headers: { "anthropic-beta": "context-1m-2025-08-07" } }
      : {};

    const instanceApiKey = environment?.ANTHROPIC_API_KEY?.trim();

    const instanceAuthToken =
      environment?.ANTHROPIC_AUTH_TOKEN?.trim() || environment?.CLAUDE_CODE_OAUTH_TOKEN?.trim();

    if (instanceApiKey || instanceAuthToken) {
      return createAnthropic({
        ...contextHeaders,
        ...(instanceApiKey ? { apiKey: instanceApiKey } : { authToken: instanceAuthToken! }),
        ...(environment?.ANTHROPIC_BASE_URL?.trim()
          ? { baseURL: environment.ANTHROPIC_BASE_URL.trim() }
          : {}),
      })(model);
    }

    const credential = useSavedCredential ? savedApiKey("anthropic") : undefined;

    if (credential) {
      return createAnthropic({
        ...contextHeaders,
        apiKey: credential.access,
        ...(credential.baseUrl ? { baseURL: credential.baseUrl } : {}),
      })(model);
    }

    if (!useSavedCredential) {
      throw new Error(
        "This Claude instance has no API key or auth token transport for Otto Mastra.",
      );
    }

    return opencodeClaudeMaxProvider(model, {
      ...contextHeaders,
      authStorage: scopedAuthStorage("anthropic"),
    });
  }

  if (trimmed.startsWith("xai/")) {
    const model = trimmed.slice("xai/".length);
    const instanceApiKey = environment?.XAI_API_KEY?.trim();

    const credential = instanceApiKey
      ? {
          access: instanceApiKey,
          baseUrl: environment?.XAI_BASE_URL?.trim() || undefined,
        }
      : useSavedCredential
        ? savedApiKey("xai")
        : undefined;

    if (credential) {
      return createOpenAICompatible({
        name: "xai",
        apiKey: credential.access,
        baseURL: credential.baseUrl ?? "https://api.x.ai/v1",
      })(model);
    }

    if (!useSavedCredential) {
      throw new Error("This Grok instance has no XAI_API_KEY transport for Otto Mastra.");
    }

    return xaiProvider(model, { authStorage: scopedAuthStorage("xai") });
  }

  if (trimmed.startsWith("kimi-for-coding/")) {
    if (!useSavedCredential) {
      throw new Error(
        "Custom Kimi instance credentials are not supported by the Otto Mastra transport.",
      );
    }

    if (!getKimiAccess) throw new Error("Kimi For Coding subscription access is unavailable.");

    return ottoKimiProvider(trimmed.slice("kimi-for-coding/".length), () =>
      getKimiAccess(instanceId, threadId),
    );
  }

  if (trimmed.startsWith("opencode-go/")) {
    const inlineConnection = openCodeGoInlineConnection(environment);
    const instanceApiKey = environment?.OPENCODE_API_KEY?.trim() || inlineConnection.apiKey;

    const baseUrl = environment?.OPENCODE_BASE_URL?.trim() || inlineConnection.baseUrl;

    const resolveAccess = instanceApiKey
      ? async () => {
          const resolvedBaseUrl =
            baseUrl || (useSavedCredential ? savedApiKey("opencode-go")?.baseUrl : undefined);

          return {
            access: instanceApiKey,
            ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
          };
        }
      : useSavedCredential && getOpenCodeGoApiKey
        ? async () => {
            const credential = await getOpenCodeGoApiKey(instanceId, threadId);

            return credential ? { ...credential, ...(baseUrl ? { baseUrl } : {}) } : undefined;
          }
        : undefined;

    if (!resolveAccess) throw new Error("OpenCode Go subscription access is unavailable.");

    return ottoOpenCodeGoProvider(trimmed.slice("opencode-go/".length), resolveAccess);
  }

  if (trimmed.startsWith("custom-openai/")) {
    const apiKey = environment?.CUSTOM_OPENAI_API_KEY?.trim();
    const baseUrl = environment?.CUSTOM_OPENAI_BASE_URL?.trim();

    if (!baseUrl) throw new Error("This Custom API instance needs a base URL.");

    return createOpenAICompatible({
      name: "custom-openai",
      ...(apiKey ? { apiKey } : {}),
      baseURL: baseUrl,
    })(trimmed.slice("custom-openai/".length));
  }

  throw new Error(`Mastra has no subscription transport for model '${modelId}'.`);
}
