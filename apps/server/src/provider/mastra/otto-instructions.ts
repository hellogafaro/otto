import * as NodeCrypto from "node:crypto";

import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import type { Memory } from "@mastra/memory";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  chatTimeZone,
  createOttoChatContext,
  createOttoChatContextUpdate,
  createOttoInstructions,
  createOttoTurn,
  OTTO_CHAT_CONTEXT_SECTIONS,
} from "../otto-agent-instructions.ts";
import { replyTokenLimit } from "./otto-compaction.ts";
import { controllerContext, controllerModelId, controllerResourceId } from "./otto-memory.ts";

/** The native AI SDK v3 model; Mastra's own v3 wrapper streams from doGenerate too. */
export type OttoLanguageModel = Extract<
  MastraModelConfig,
  {
    readonly specificationVersion: "v3";
    doGenerate: (...args: never[]) => PromiseLike<{ readonly content: ReadonlyArray<object> }>;
  }
>;

export type OttoCallOptions = Parameters<OttoLanguageModel["doStream"]>[0];

type OttoPromptMessage = OttoCallOptions["prompt"][number];

/** Marks the last prompt message as a compaction instruction, sent in place of the turn block. */
export const OTTO_COMPACTION_INSTRUCTION = { otto: { compaction: true } };

/**
 * The chat context a thread's model has seen: what was sent first and the updates after it,
 * each following the history message it was first sent after. `firstMessage` hashes the first
 * history message's content when the context was sent; a new one means history was rebuilt.
 */
export const OttoChatContextRecord = Schema.Struct({
  firstMessage: Schema.String,
  context: Schema.String,
  sections: Schema.Record(Schema.String, Schema.String),
  updates: Schema.Array(Schema.Struct({ after: Schema.Number, text: Schema.String })),
});

export type OttoChatContextRecord = typeof OttoChatContextRecord.Type;

/**
 * Where each thread's record is kept, one per bot (`botId` is empty outside bot chats), so the
 * bots of a group never rewrite each other's prompt prefix. It must outlive the process for the
 * prompt to cache.
 */
export interface OttoChatContexts {
  get(threadId: string, botId: string): Promise<OttoChatContextRecord | undefined>;
  set(threadId: string, botId: string, record: OttoChatContextRecord): Promise<void>;
}

const CHAT_CONTEXT_KEY = "ottoChatContext";

const chatContextKey = (botId: string) =>
  botId ? `${CHAT_CONTEXT_KEY}:${botId}` : CHAT_CONTEXT_KEY;

const decodeChatContextRecord = Schema.decodeUnknownOption(OttoChatContextRecord);

/** Keeps each thread's record in its stored metadata, so a restarted server sends the same prompt. */
export function storedChatContexts(
  memory: Pick<Memory, "getThreadById" | "updateThread">,
): OttoChatContexts {
  return {
    get: async (threadId, botId) => {
      const thread = await memory.getThreadById({ threadId });

      return Option.getOrUndefined(
        decodeChatContextRecord(thread?.metadata?.[chatContextKey(botId)]),
      );
    },
    set: async (threadId, botId, record) => {
      const thread = await memory.getThreadById({ threadId });

      if (!thread) return;

      await memory.updateThread({
        id: threadId,
        metadata: { ...thread.metadata, [chatContextKey(botId)]: record },
      });
    },
  };
}

const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } };

function stateText(requestContext: RequestContext, key: string): string {
  const state = controllerContext(requestContext)?.state;
  const value = Predicate.isObject(state) ? state[key] : undefined;

  return Predicate.isString(value) ? value : "";
}

export function isV3Model(model: MastraModelConfig): model is OttoLanguageModel {
  return (
    Predicate.isObject(model) &&
    "specificationVersion" in model &&
    model.specificationVersion === "v3"
  );
}

function cached<
  Message extends { readonly providerOptions?: OttoPromptMessage["providerOptions"] },
>(message: Message): Message {
  return { ...message, providerOptions: { ...message.providerOptions, ...ANTHROPIC_CACHE } };
}

/**
 * Lays out every bot request so that it caches: the static prompt, then the chat context,
 * then history with context updates where they were first sent, then this turn's block.
 * Only the turn block changes from one request to the next. Anthropic requests also mark
 * the system prompt, the last tool and the last history message for its cache.
 */
export function withOttoPrompt(
  model: MastraModelConfig,
  requestContext: RequestContext,
  chats: OttoChatContexts,
  now: () => DateTime.DateTime = DateTime.nowUnsafe,
): MastraModelConfig {
  if (!isV3Model(model)) return model;

  const anthropic = model.provider.startsWith("anthropic");
  const bot = controllerContext(requestContext)?.state;
  const botConversation = Predicate.isObject(bot) && bot["botConversation"] === true;

  const note = (text: string): OttoPromptMessage =>
    anthropic
      ? { role: "user", content: [{ type: "text", text }] }
      : { role: "system", content: text };

  // Room for one reply is reserved below the window, so no request asks for more than that.
  const maxOutputTokens = replyTokenLimit(controllerModelId(requestContext));

  const transform = async (params: OttoCallOptions): Promise<OttoCallOptions> => {
    const instructions = createOttoInstructions({
      name: botConversation ? stateText(requestContext, "botName") : "Otto",
      ...(botConversation && stateText(requestContext, "botId")
        ? {
            coAuthor: `Co-authored-by: ${stateText(requestContext, "botName")} from Otto <${stateText(requestContext, "botId")}@bots.otto.invalid>`,
          }
        : {}),
      workspaceName: stateText(requestContext, "workspaceName"),
      instructions: botConversation ? stateText(requestContext, "botInstructions") : "",
      tools: (params.tools ?? []).map((tool) => tool.name),
      skills: stateText(requestContext, "skillsContext"),
      mcpInstructions: stateText(requestContext, "mcpInstructions"),
    });

    const sections = {
      workspace: stateText(requestContext, "workspaceContext"),
      project: botConversation ? stateText(requestContext, "projectContext") : "",
      chat: botConversation ? stateText(requestContext, "groupContext") : "",
      memory: stateText(requestContext, "persistentMemoryContext"),
    };

    const last = params.prompt.at(-1);
    const instruction = last?.role === "user" && last.providerOptions?.["otto"]?.["compaction"];
    const prompt = instruction ? params.prompt.slice(0, -1) : params.prompt;

    const ownSystem = prompt.filter(
      (message) => message.role === "system" && message.content.trim() !== "",
    );

    const history = prompt.filter((message) => message.role !== "system");
    const threadId = controllerResourceId(requestContext);
    const botId = botConversation ? stateText(requestContext, "botId") : "";

    // Mastra stamps each loaded message's provider options with a fresh createdAt.
    const firstMessage = NodeCrypto.createHash("sha256")
      .update(
        JSON.stringify(history[0] ?? null, (key, value) =>
          key === "providerOptions" ? undefined : value,
        ),
      )
      .digest("hex");

    const previous = threadId ? await chats.get(threadId, botId) : undefined;

    const changes = OTTO_CHAT_CONTEXT_SECTIONS.flatMap((name) =>
      previous && previous.sections[name] !== sections[name]
        ? [[name, sections[name] ?? ""] as const]
        : [],
    );

    const contextUpdate = previous ? createOttoChatContextUpdate(changes, previous.sections) : "";

    const chat: OttoChatContextRecord =
      !previous ||
      previous.firstMessage !== firstMessage ||
      previous.updates.some((update) => update.after > history.length)
        ? { firstMessage, context: createOttoChatContext(sections), sections, updates: [] }
        : changes.length === 0
          ? previous
          : {
              ...previous,
              sections,
              updates: contextUpdate
                ? [...previous.updates, { after: history.length, text: contextUpdate }]
                : previous.updates,
            };

    if (threadId && chat !== previous) await chats.set(threadId, botId, chat);

    const conversation = history.flatMap((message, index) => [
      message,
      ...chat.updates
        .filter((update) => update.after === index + 1)
        .map((update) => note(update.text)),
    ]);

    const system: ReadonlyArray<OttoPromptMessage> = [
      { role: "system", content: instructions },
      ...(chat.context ? [{ role: "system" as const, content: chat.context }] : []),
      ...ownSystem,
    ];

    // A compaction request is the last request with its instruction in place of the turn block.
    const turn: OttoPromptMessage =
      instruction && last.role === "user"
        ? { role: "user", content: last.content }
        : note(
            createOttoTurn({
              now: now(),
              timezone: chatTimeZone(stateText(requestContext, "timezone")),
              notes: stateText(requestContext, "turnContext"),
            }),
          );

    // Each bot of a group has its own prompt prefix, so it gets its own OpenAI prompt cache.
    if (!anthropic)
      return {
        ...params,
        maxOutputTokens,
        prompt: [...system, ...conversation, turn],
        ...(threadId && botId
          ? {
              providerOptions: {
                ...params.providerOptions,
                openai: {
                  ...params.providerOptions?.openai,
                  promptCacheKey: `${threadId}:${botId}`,
                },
              },
            }
          : {}),
      };

    const tools = params.tools ?? [];

    // Deferred tools stay out of the cached prefix, so the mark goes on the last loaded tool.
    const lastLoaded = tools.findLastIndex(
      (tool) => tool.type === "function" && tool.providerOptions?.anthropic?.deferLoading !== true,
    );

    return {
      ...params,
      maxOutputTokens,
      prompt: [
        ...system.map((message, index) =>
          index === system.length - 1 ? cached(message) : message,
        ),
        ...conversation.map((message, index) =>
          index === conversation.length - 1 ? cached(message) : message,
        ),
        turn,
      ],
      ...(tools.length > 0
        ? {
            tools: tools.map((tool, index) =>
              index === lastLoaded && tool.type === "function" ? cached(tool) : tool,
            ),
          }
        : {}),
    };
  };

  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (params) => model.doGenerate(await transform(params)),
    doStream: async (params) => model.doStream(await transform(params)),
  };
}
