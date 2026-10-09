import { randomBytes } from "node:crypto";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { ModelAuthorization } from "../../packages/runs/src";
import { createSubscription } from "../../packages/subscriptions/src";
import {
  authorizeSubscriptionModel,
  setSubscriptionApiKey,
} from "../../packages/subscriptions/src/server";
import type { Context } from "../../packages/workspaces/src";

type NativeV2Model = Extract<MastraModelConfig, { specificationVersion: "v2" }>;
type FixtureModel = Extract<
  NativeV2Model,
  {
    doGenerate: (options: never) => PromiseLike<{ content: unknown }>;
  }
>;
type FixtureStreamPart =
  Awaited<
    ReturnType<FixtureModel["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

export const fixtureEncryptionKey = randomBytes(32);
export const nativeModelAuthorization: ModelAuthorization = {
  authorizeModel: authorizeSubscriptionModel,
};

export async function controlledSubscription(
  c: Context,
  key = fixtureEncryptionKey,
) {
  const account = await createSubscription(c, {
    title: "Controlled account",
    provider: "openai",
    protocol: "responses",
    models: ["fixture", "selected"],
    visibility: "workspace",
  });
  await setSubscriptionApiKey(
    c,
    account.id,
    { apiKey: "fixture-not-a-real-key" },
    key,
  );
  return account.id;
}

export function controlledModel(
  options: {
    text?: string;
    signal?: AbortSignal;
    hold?: boolean;
    onPrompt?: (prompt: unknown) => void;
    toolRequests?: {
      toolName: string;
      input: unknown;
      toolCallId?: string;
    }[];
    usage?: { inputTokens: number; outputTokens: number };
    steps?: {
      text?: string;
      hold?: boolean;
      toolRequests?: {
        toolName: string;
        input: unknown;
        toolCallId?: string;
      }[];
      usage?: { inputTokens: number; outputTokens: number };
    }[];
  } = {},
) {
  const text = options.text ?? "fixture output";
  let calls = 0;
  const model: FixtureModel = {
    specificationVersion: "v2" as const,
    provider: "controlled-fixture",
    modelId: "fixture",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        warnings: [],
      };
    },
    async doStream(input: { prompt: unknown; abortSignal?: AbortSignal }) {
      options.onPrompt?.(input.prompt);
      const call = calls++;
      const step = options.steps?.[call];
      const content = step?.text ?? text;
      const requests =
        step?.toolRequests ?? (call === 0 ? options.toolRequests : undefined);
      const usage = step?.usage ??
        options.usage ?? { inputTokens: 10, outputTokens: 2 };
      const signal = options.signal ?? input.abortSignal;
      let removeAbort: (() => void) | undefined;
      return {
        stream: new ReadableStream<FixtureStreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "fixture-text" });
            controller.enqueue({
              type: "text-delta",
              id: "fixture-text",
              delta: content,
            });
            controller.enqueue({ type: "text-end", id: "fixture-text" });
            for (const [index, request] of (requests ?? []).entries()) {
              controller.enqueue({
                type: "tool-call",
                toolCallId:
                  request.toolCallId ?? `fixture-call-${call}-${index}`,
                toolName: request.toolName,
                input: JSON.stringify(request.input),
              });
            }
            if (step?.hold ?? options.hold) {
              const abort = () => {
                controller.error(new Error("Controlled native turn aborted"));
              };
              if (signal?.aborted) abort();
              else {
                signal?.addEventListener("abort", abort, { once: true });
                removeAbort = () => signal?.removeEventListener("abort", abort);
              }
              return;
            }
            controller.enqueue({
              type: "finish",
              finishReason: requests?.length ? "tool-calls" : "stop",
              usage: {
                ...usage,
                totalTokens: usage.inputTokens + usage.outputTokens,
              },
            });
            controller.close();
          },
          cancel() {
            removeAbort?.();
          },
        }),
      };
    },
  };
  return model;
}
