import { harnessCredentialIssue } from "../../harness-provider-status.ts";
import { ProviderDriverKind } from "@otto/contracts";
import { ProviderInstanceId } from "@otto/contracts";
import { PROVIDER_ACCOUNT_NAMES } from "@otto/contracts";
import * as NodeCrypto from "node:crypto";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import { AuthStorage } from "@mastra/code-sdk/auth/storage";
import { type ProviderRuntimeEvent } from "@otto/contracts";
import {
  SubscriptionAuthService,
  type SubscriptionProviderId,
} from "../../../subscription-auth/service.ts";
import { openCodeGoInlineConnection } from "../../otto-mastra-harness.ts";
import type { ProviderInstanceRoutingInfo } from "../../services/provider-adapter-registry.ts";
import { type OttoDelegationRuntimeOptions } from "../../otto-delegation-runtime.ts";

import { nowIso, eventId } from "./event-identity.ts";

/**
 * Mastra reads Otto's subscription credentials but never writes them. Its AuthStorage migrates
 * the file into its own account registry on load, which would bring back credentials Otto has
 * logged out; SubscriptionAuthService owns every write and refresh.
 */
export class OttoMastraAuthStorage extends AuthStorage {}

// Otto: `save` is private in Mastra's types, so it is replaced on the prototype; the base
// constructor already resolves it here when its first reload migrates the file.
Object.defineProperty(OttoMastraAuthStorage.prototype, "save", { value: () => undefined });

export const createOttoMastraAuthStorage = Effect.fn("createOttoMastraAuthStorage")(function* (
  secretsDir: string,
) {
  const path = yield* Path.Path;

  return new OttoMastraAuthStorage(path.join(secretsDir, "subscription-auth.json"));
});

export type DelegatedUsage = Parameters<
  NonNullable<OttoDelegationRuntimeOptions["recordUsage"]>
>[0];

export function delegatedUsageReceipt(
  usage: DelegatedUsage,
  active: {
    readonly provider: ProviderDriverKind;
    readonly providerInstanceId: ProviderInstanceId;
  },
  createdAt = nowIso(),
): Extract<ProviderRuntimeEvent, { readonly type: "tool.receipt" }> {
  return {
    eventId: eventId(),
    provider: active.provider,
    providerInstanceId: active.providerInstanceId,
    threadId: usage.threadId,
    ...(usage.turnId ? { turnId: usage.turnId } : {}),
    createdAt,
    type: "tool.receipt",
    payload: {
      receiptId: `delegation:usage:${NodeCrypto.randomUUID()}`,
      toolId: "delegate",
      phase: "success",
      threadId: usage.threadId,
      botId: usage.botId,
      billedBotId: usage.botId,
      fatalToThread: false,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      createdAt,
    },
  };
}

export function subscriptionProviderForDriver(
  provider: ProviderDriverKind,
): SubscriptionProviderId | undefined {
  switch (String(provider)) {
    case "codex":
      return "openai-codex";
    case "claudeAgent":
      return "anthropic";
    case "grok":
      return "xai";
    case "kimi":
      return "kimi-for-coding";
    case "opencodeGo":
      return "opencode-go";
    default:
      return undefined;
  }
}

export function mastraConnectionIssue(
  provider: ProviderDriverKind,
  connection: ProviderInstanceRoutingInfo["mastraConnection"],
  savedCredentialConnected: boolean,
): string | undefined {
  if (!connection) return undefined;

  if (provider === "codex" || provider === "claudeAgent" || provider === "grok") {
    return harnessCredentialIssue(provider, connection, savedCredentialConnected);
  }

  const env = connection.useSavedCredential
    ? connection.environment
    : connection.instanceEnvironment;

  // A custom endpoint has no subscription account to connect: the base URL is
  // the whole credential story, so neither branch below applies.
  if (String(provider) === "customOpenai") {
    return env.CUSTOM_OPENAI_BASE_URL?.trim()
      ? undefined
      : "This Custom API instance needs a base URL.";
  }

  if (connection.useSavedCredential) {
    const hasAmbientCredential = (() => {
      switch (String(provider)) {
        case "opencodeGo":
          return Boolean(env.OPENCODE_API_KEY?.trim() || openCodeGoInlineConnection(env).apiKey);
        default:
          return false;
      }
    })();

    if (hasAmbientCredential) return undefined;

    return savedCredentialConnected
      ? undefined
      : `Connect ${PROVIDER_ACCOUNT_NAMES[provider] ?? provider} in Settings.`;
  }

  switch (String(provider)) {
    case "kimi":
      return "Custom Kimi credentials are not supported by the Otto harness.";
    case "opencodeGo":
      return env.OPENCODE_API_KEY?.trim() || openCodeGoInlineConnection(env).apiKey
        ? undefined
        : "This OpenCode Go instance needs OPENCODE_API_KEY for the Otto harness.";
    default:
      return `Provider '${provider}' has no Otto Mastra transport.`;
  }
}

export function recordProviderAccessHealth(
  subscriptionAuth: SubscriptionAuthService,
  event: ProviderRuntimeEvent,
  model?: string,
): void {
  const provider = subscriptionProviderForDriver(event.provider);
  const providerInstanceId = event.providerInstanceId;
  const threadId = String(event.threadId);

  if (event.type === "turn.completed") {
    if (event.payload.state === "failed") {
      const message = event.payload.errorMessage ?? "The provider request failed.";

      if (provider) {
        if (providerInstanceId)
          subscriptionAuth.recordAccountRequestFailure(
            provider,
            providerInstanceId,
            message,
            event.createdAt,
            threadId,
          );
        else
          subscriptionAuth.recordRequestFailure(
            provider,
            message,
            event.createdAt,
            "request",
            threadId,
          );
      }

      if (providerInstanceId) {
        subscriptionAuth.recordProviderInstanceFailure(
          providerInstanceId,
          message,
          event.createdAt,
          model,
        );
      }
    } else if (event.payload.state === "completed") {
      if (provider) {
        if (providerInstanceId)
          subscriptionAuth.recordAccountRequestSuccess(
            provider,
            providerInstanceId,
            event.createdAt,
            threadId,
          );
        else subscriptionAuth.recordRequestSuccess(provider, event.createdAt, threadId);
      }

      if (providerInstanceId) {
        subscriptionAuth.recordProviderInstanceSuccess(providerInstanceId, event.createdAt);
      }
    }

    return;
  }

  if (event.type !== "runtime.error" || event.payload.class !== "provider_error") return;

  if (provider) {
    if (providerInstanceId)
      subscriptionAuth.recordAccountRequestFailure(
        provider,
        providerInstanceId,
        event.payload.message,
        event.createdAt,
        threadId,
      );
    else
      subscriptionAuth.recordRequestFailure(
        provider,
        event.payload.message,
        event.createdAt,
        "request",
        threadId,
      );
  }

  if (providerInstanceId) {
    subscriptionAuth.recordProviderInstanceFailure(
      providerInstanceId,
      event.payload.message,
      event.createdAt,
      model,
    );
  }
}
