import type { MastraDBMessage } from "@mastra/core/agent-controller";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { ProcessInputStepArgs, ProcessOutputStepArgs } from "@mastra/core/processors";
import type { Memory } from "@mastra/memory";
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";

import { checkpointAsUserMessage, OTTO_CHECKPOINT, startsTurn } from "../chat-history.ts";
import { BUNDLED_MODEL_CATALOG } from "../model-catalog-data.ts";
import type { OttoMastraHarnessOptions } from "./otto-harness-types.ts";
import {
  isV3Model,
  OTTO_COMPACTION_INSTRUCTION,
  type OttoCallOptions,
  type OttoLanguageModel,
} from "./otto-instructions.ts";
import { MASTRA_MODEL_PREFIX } from "./otto-models.ts";

/** Models with a larger window are treated as this size, so a chat compacts near 400k tokens. */
export const OTTO_CONTEXT_WINDOW_CAP_TOKENS = 400_000;

/** For models the catalog does not know, such as custom OpenAI-compatible endpoints. */
export const OTTO_UNKNOWN_CONTEXT_WINDOW_TOKENS = 128_000;

/** Room for one model step's output; bot requests send it as maxOutputTokens. */
export const OTTO_REPLY_RESERVE_TOKENS = 32_768;

/** The newest part of the chat a compaction keeps verbatim, as a share of the window. */
export const OTTO_KEEP_RECENT_RATIO = 0.1;

/** Fixed estimates per attached file, never counted by their base64 length. */
export const OTTO_IMAGE_TOKENS = 1_600;

export const OTTO_PDF_TOKENS = 3_000;

const OTTO_LAST_REQUESTS = 64;

export const OTTO_CHECKPOINT_SECTIONS = [
  ["Goal and acceptance", "what the people in this chat want and how they will judge it done"],
  [
    "Constraints and preferences",
    "rules, prohibitions and corrections (the latest wins; say what was superseded)",
  ],
  ["Decisions", "each with its reason"],
  [
    "Done",
    "completed actions and confirmed external effects (posted, sent, created, merged, paid), with ids",
  ],
  ["Open", "pending items, unanswered questions, approvals waiting, work promised but not done"],
  ["Next step", "the single next concrete action"],
  [
    "Key references",
    "ids, task, Library and PR links, file paths, people and bots by name, exact error messages",
  ],
] as const;

const OTTO_CHECKPOINT_INSTRUCTION = [
  "Write a checkpoint of this chat so far. Another model will continue the chat from it, with only the most recent messages still visible. Do not call tools.",
  "Use exactly these sections, each as a level-2 Markdown heading:",
  ...OTTO_CHECKPOINT_SECTIONS.map(([title, content]) => `## ${title}: ${content}`),
  "If there is a <checkpoint> above, carry over everything in it that is still true. Keep exact ids, links, paths, names, numbers and error messages. Count an effect as done only when a tool result or a person confirmed it; keep planned or promised work under Open. When something was corrected, keep the latest version and say what it replaced. Write (none) for an empty section. Be concise. No preamble.",
].join("\n");

/** What Otto logs when a chat could not be compacted. */
export interface OttoCompactionWarning {
  readonly threadId: string;
  readonly modelId: string;
  readonly tokensBefore: number;
  readonly cause: Error | undefined;
}

/** A thread's latest model request, which a compaction resends with its instruction. */
export interface OttoLastRequest {
  readonly model: OttoLanguageModel;
  readonly params: OttoCallOptions;
}

function catalogModel(modelId: string) {
  const slash = modelId.indexOf("/");
  const prefix = modelId.slice(0, slash);
  const driver = Object.entries(MASTRA_MODEL_PREFIX).find(([, value]) => value === prefix)?.[0];

  return driver
    ? BUNDLED_MODEL_CATALOG.drivers[driver]?.find((model) => model.id === modelId.slice(slash + 1))
    : undefined;
}

/** The tokens a model may receive: its catalog window, at most 400k, else 128k. */
export function contextWindow(modelId: string): number {
  return Math.min(
    catalogModel(modelId)?.contextWindow ?? OTTO_UNKNOWN_CONTEXT_WINDOW_TOKENS,
    OTTO_CONTEXT_WINDOW_CAP_TOKENS,
  );
}

/** The output limit every bot request sends, so a reply always fits the reserve. */
export function replyTokenLimit(modelId: string): number {
  return Math.min(
    catalogModel(modelId)?.maxOutputTokens ?? OTTO_REPLY_RESERVE_TOKENS,
    OTTO_REPLY_RESERVE_TOKENS,
  );
}

// A long base64 run or data URL in the stored JSON is an inline file; "JVBERi" is "%PDF" in base64.
const INLINE_FILE = /"(?:data:[^"]{1024,}|[A-Za-z0-9+/=]{1024,})"/g;

/** About four characters a token; each inline image or PDF counts a fixed amount. */
export function estimateTokens(messages: ReadonlyArray<MastraDBMessage>): number {
  let files = 0;

  const json = JSON.stringify(messages.map((message) => message.content)).replace(
    INLINE_FILE,
    (file) => {
      files += /^"(?:data:application\/pdf|JVBERi)/.test(file)
        ? OTTO_PDF_TOKENS
        : OTTO_IMAGE_TOKENS;

      return '""';
    },
  );

  return Math.ceil(json.length / 4) + files;
}

/**
 * The first message kept verbatim after a checkpoint: a turn's first message, no later than `latest`,
 * from which at least `keepTokens` remain. A turn is never split, so a tool call always keeps
 * its result. Undefined when no earlier message is left to summarise.
 */
export function firstKeptIndex(
  messages: ReadonlyArray<MastraDBMessage>,
  keepTokens: number,
  latest: number,
): number | undefined {
  let tokens = 0;

  for (let index = messages.length - 1; index > 0; index -= 1) {
    tokens += estimateTokens([messages[index]!]);

    if (index <= latest && tokens >= keepTokens && startsTurn(messages[index]!)) return index;
  }

  return undefined;
}

const CONTEXT_OVERFLOW =
  /context_length_exceeded|context window|context length|prompt is too long|prompt length|input is too long|too many (input )?tokens/i;

/** Whether a provider rejected a request because it did not fit the model's window. */
export function isContextOverflow(error: Error): boolean {
  const body =
    "responseBody" in error && Predicate.isString(error.responseBody) ? error.responseBody : "";

  return CONTEXT_OVERFLOW.test(`${error.message} ${body}`);
}

/** Remembers each thread's latest request, so a compaction can resend it from the cache. */
export function withLastRequest(
  model: MastraModelConfig,
  threadId: string | undefined,
  requests: Map<string, OttoLastRequest>,
): MastraModelConfig {
  if (!threadId || !isV3Model(model)) return model;

  const remember = (params: OttoCallOptions) => {
    const { abortSignal: _abortSignal, ...rest } = params;
    requests.delete(threadId);
    requests.set(threadId, { model, params: rest });

    if (requests.size > OTTO_LAST_REQUESTS) requests.delete(requests.keys().next().value!);
  };

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: (params) => {
      remember(params);

      return model.doGenerate(params);
    },
    doStream: (params) => {
      remember(params);

      return model.doStream(params);
    },
  };
}

interface CheckpointResult {
  readonly text?: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheCreationTokens: number;
    readonly outputTokens: number;
  };
  readonly error?: Error;
}

/** Sends the last request again with the checkpoint instruction in place of its turn block. */
async function requestCheckpoint(
  last: OttoLastRequest,
  abortSignal: AbortSignal | undefined,
): Promise<CheckpointResult> {
  let text = "";
  let calledTool = false;
  let finish: string | undefined;
  let usage: CheckpointResult["usage"];

  try {
    const { stream } = await last.model.doStream({
      ...last.params,
      prompt: [
        ...last.params.prompt,
        {
          role: "user",
          content: [{ type: "text", text: OTTO_CHECKPOINT_INSTRUCTION }],
          providerOptions: OTTO_COMPACTION_INSTRUCTION,
        },
      ],
      ...(abortSignal ? { abortSignal } : {}),
    });

    const reader = stream.getReader();

    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const part = read.value;

      if (part.type === "text-delta") text += part.delta;

      if (part.type === "tool-call" || part.type === "tool-input-start") calledTool = true;

      if (part.type === "error") throw part.error;

      if (part.type === "finish") {
        finish = part.finishReason.unified;
        usage = {
          inputTokens: part.usage.inputTokens.total ?? 0,
          cachedInputTokens: part.usage.inputTokens.cacheRead ?? 0,
          cacheCreationTokens: part.usage.inputTokens.cacheWrite ?? 0,
          outputTokens: part.usage.outputTokens.total ?? 0,
        };
      }
    }
  } catch (cause) {
    return {
      ...(usage ? { usage } : {}),
      error: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }

  const missing = OTTO_CHECKPOINT_SECTIONS.filter(([title]) => !text.includes(`## ${title}`));

  const problem = calledTool
    ? "it called a tool"
    : finish !== "stop"
      ? `it stopped with ${finish ?? "no finish"}`
      : missing.length > 0
        ? `it left out ${missing.map(([title]) => title).join(", ")}`
        : undefined;

  return problem
    ? { ...(usage ? { usage } : {}), error: new Error(`The checkpoint was rejected: ${problem}.`) }
    : { text: text.trim(), ...(usage ? { usage } : {}) };
}

/**
 * Keeps a chat's whole history in every request until it nears the model's window, then
 * replaces everything but the newest tenth of the window with one checkpoint, once.
 */
export function createOttoCompaction(
  options: Pick<OttoMastraHarnessOptions, "startCompaction" | "finishCompaction"> & {
    readonly memory: Memory;
    readonly warn: (message: string, warning: OttoCompactionWarning) => void;
  },
) {
  const requests = new Map<string, OttoLastRequest>();

  // The provider's count for a thread's latest request, and the estimate of its messages then.
  const reported = new Map<
    string,
    { readonly modelId: string; readonly tokens: number; readonly estimate: number }
  >();

  /** The latest reported request plus an estimate of what was added since, else the estimate. */
  const measure = (threadId: string, modelId: string, messages: ReadonlyArray<MastraDBMessage>) => {
    const estimate = estimateTokens(messages);
    const report = reported.get(threadId);

    return report?.modelId === modelId
      ? report.tokens + Math.max(0, estimate - report.estimate)
      : estimate;
  };

  const recordUsage = (
    args: Pick<ProcessOutputStepArgs, "usage" | "messageList">,
    threadId: string,
    modelId: string,
  ) => {
    reported.delete(threadId);
    reported.set(threadId, {
      modelId,
      tokens: (args.usage.inputTokens ?? 0) + (args.usage.outputTokens ?? 0),
      estimate: estimateTokens(args.messageList.get.all.db()),
    });

    if (reported.size > OTTO_LAST_REQUESTS) reported.delete(reported.keys().next().value!);
  };

  /**
   * Compacts when the next request passes W − 32,768, or at once when `overflowed` (the provider
   * rejected a request as too long). Returns whether a checkpoint replaced the history.
   */
  const compactIfNeeded = async (
    args: Pick<ProcessInputStepArgs, "messageList" | "stepNumber" | "abortSignal" | "state">,
    thread: { readonly threadId: string; readonly resourceId: string },
    modelId: string,
    overflowed = false,
  ): Promise<boolean> => {
    const window = contextWindow(modelId);
    const messages = args.messageList.get.all.db();
    const tokensBefore = measure(thread.threadId, modelId, messages);
    const last = requests.get(thread.threadId);

    if (
      (!overflowed && tokensBefore <= window - OTTO_REPLY_RESERVE_TOKENS) ||
      !last ||
      args.state["failed"]
    ) {
      return false;
    }

    // At a turn's start the last request lacks the previous reply, so that turn stays verbatim.
    const inputIndex = messages.findIndex((message) =>
      args.messageList.get.input.db().some((input) => input.id === message.id),
    );

    const latest =
      args.stepNumber === 0
        ? messages.findLastIndex((message, index) => index < inputIndex && startsTurn(message))
        : inputIndex;

    const kept =
      latest > 0 ? firstKeptIndex(messages, window * OTTO_KEEP_RECENT_RATIO, latest) : undefined;

    if (kept === undefined) return false;

    const firstKept = messages[kept]!;

    const callId = await options
      .startCompaction?.({ threadId: thread.threadId, modelId })
      .catch(() => undefined);

    const result = await requestCheckpoint(last, args.abortSignal);

    if (callId) {
      await options
        .finishCompaction?.({
          callId,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.error ? { error: result.error } : {}),
        })
        .catch(() => undefined);
    }

    if (!result.text) {
      args.state["failed"] = true;
      options.warn("Otto could not compact a chat's history.", {
        threadId: thread.threadId,
        modelId,
        tokensBefore,
        cause: result.error,
      });

      return false;
    }

    const now = DateTime.nowUnsafe();

    const checkpoint: MastraDBMessage = {
      id: NodeCrypto.randomUUID(),
      role: "assistant",
      threadId: thread.threadId,
      resourceId: thread.resourceId,
      createdAt: DateTime.toDate(now),
      content: {
        format: 2,
        parts: [
          {
            type: "text",
            text: [
              "<checkpoint>",
              "The earlier part of this chat was compacted into this checkpoint. The messages after it are verbatim.",
              "",
              result.text,
              "</checkpoint>",
            ].join("\n"),
          },
        ],
        metadata: {
          [OTTO_CHECKPOINT]: {
            firstKeptMessageId: firstKept.id,
            tokensBefore,
            model: modelId,
            createdAt: DateTime.formatIso(now),
          },
        },
      },
    };

    await options.memory.persistMessages([checkpoint]);
    args.messageList.removeByIds(messages.slice(0, kept).map((message) => message.id));
    args.messageList.add(checkpointAsUserMessage(checkpoint, firstKept), "memory");
    requests.delete(thread.threadId);
    reported.delete(thread.threadId);

    return true;
  };

  /** Drops what a rebuilt thread's earlier requests left behind. */
  const forget = (threadId: string) => {
    requests.delete(threadId);
    reported.delete(threadId);
  };

  return { requests, recordUsage, compactIfNeeded, forget };
}
