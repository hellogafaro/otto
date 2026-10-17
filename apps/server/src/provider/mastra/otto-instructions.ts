import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";
import {
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

/** The chat context a thread's model has seen: what was sent first and the updates after it. */
export interface OttoChatContextRecord {
  /** The first history message when the context was sent; a new one means history was rebuilt. */
  readonly firstMessage: string;
  readonly context: string;
  readonly sections: Readonly<Record<string, string>>;
  /** Each update follows the history message it was first sent after. */
  readonly updates: ReadonlyArray<{ readonly after: number; readonly text: string }>;
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
  chats: Map<string, OttoChatContextRecord>,
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

  const transform = (params: OttoCallOptions): OttoCallOptions => {
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
    const firstMessage = JSON.stringify(history[0] ?? null);
    const previous = threadId ? chats.get(threadId) : undefined;

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

    if (threadId) chats.set(threadId, chat);

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
              timezone:
                stateText(requestContext, "timezone") ||
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              notes: stateText(requestContext, "turnContext"),
            }),
          );

    if (!anthropic)
      return { ...params, maxOutputTokens, prompt: [...system, ...conversation, turn] };

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
    doGenerate: (params) => model.doGenerate(transform(params)),
    doStream: (params) => model.doStream(transform(params)),
  };
}
