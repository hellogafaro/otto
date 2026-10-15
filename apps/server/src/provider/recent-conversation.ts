import type { MastraDBMessage } from "@mastra/core/agent-controller";
import * as Predicate from "effect/Predicate";
import { GROUP_NO_REPLY, isGroupTurnNote } from "../orchestration/group-responder.ts";

export const OTTO_RECENT_TURN_LIMIT = 30;

export const OTTO_RECENT_TOKEN_LIMIT = 64_000;

/** Message metadata naming the bot that wrote an assistant reply. */
export const OTTO_REPLY_BOT_NAME = "ottoBotName";

interface ConversationTurn {
  readonly messages: ReadonlyArray<MastraDBMessage>;
  readonly estimatedTokens: number;
  readonly required: boolean;
}

/** Otto: The files a model reads directly; any other attachment reaches it as its saved path. */
export const modelReadsFile = (mediaType: string) =>
  mediaType.startsWith("image/") || mediaType === "application/pdf";

/**
 * Otto: A file the model can't read, saved in an older turn, would fail every later turn that
 * replays it. Its path line stays in the message text, so the bot can still open it.
 */
function withoutUnreadableFiles(message: MastraDBMessage): MastraDBMessage {
  const parts = message.content.parts.filter(
    (part) => part.type !== "file" || modelReadsFile(part.mimeType),
  );

  const attachments = message.content.experimental_attachments?.filter((attachment) =>
    modelReadsFile(attachment.contentType ?? ""),
  );

  if (
    parts.length === message.content.parts.length &&
    attachments?.length === message.content.experimental_attachments?.length
  ) {
    return message;
  }

  return {
    ...message,
    content: {
      ...message.content,
      parts,
      ...(attachments ? { experimental_attachments: attachments } : {}),
    },
  };
}

function estimatedTokens(message: MastraDBMessage): number {
  return Math.ceil(JSON.stringify(message.content).length / 4);
}

function messageText(message: MastraDBMessage): string {
  return message.content.parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

// Mastra stores a user message as a user signal, not a user row.
function isUserMessage(message: MastraDBMessage): boolean {
  if (message.role === "user") return true;

  if (message.role !== "signal") return false;
  const signal = message.content.metadata?.["signal"];

  return Predicate.isObject(signal) && "type" in signal && signal.type === "user";
}

// A group bot that passed left a hidden note and a NO_REPLY that nobody saw.
// Replaying them teaches every bot in the group to pass.
function isGroupPass(message: MastraDBMessage): boolean {
  const text = messageText(message);

  return message.role === "assistant" ? text === GROUP_NO_REPLY : isGroupTurnNote(text);
}

function conversationTurns(
  messages: ReadonlyArray<MastraDBMessage>,
  requiredMessageIds: ReadonlySet<string>,
): ReadonlyArray<ConversationTurn> {
  const turns: MastraDBMessage[][] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (isUserMessage(message) || turns.length === 0) turns.push([]);
    turns.at(-1)!.push(withoutUnreadableFiles(message));
  }

  return turns.flatMap((turn) => {
    const required = turn.some((message) => requiredMessageIds.has(message.id));
    const complete = turn.some((message) => message.role === "assistant");
    const kept = turn.filter((message) => !isGroupPass(message));

    return (complete || required) && kept.length > 0
      ? [
          {
            messages: kept,
            estimatedTokens: kept.reduce((total, message) => total + estimatedTokens(message), 0),
            required,
          },
        ]
      : [];
  });
}

export function selectRecentConversation(
  messages: ReadonlyArray<MastraDBMessage>,
  options: {
    readonly requiredMessageIds?: ReadonlySet<string>;
    readonly turnLimit?: number;
    readonly tokenLimit?: number;
  } = {},
): ReadonlyArray<MastraDBMessage> {
  const requiredMessageIds = options.requiredMessageIds ?? new Set<string>();
  const turnLimit = options.turnLimit ?? OTTO_RECENT_TURN_LIMIT;
  const tokenLimit = options.tokenLimit ?? OTTO_RECENT_TOKEN_LIMIT;
  const turns = conversationTurns(messages, requiredMessageIds);
  const selected = new Set<number>();
  let selectedTokens = 0;
  let optionalTurns = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const isNewest = index === turns.length - 1;
    const withinTurnLimit = optionalTurns < turnLimit;
    const withinTokenLimit = selectedTokens + turn.estimatedTokens <= tokenLimit;

    if (!turn.required && !isNewest && (!withinTurnLimit || !withinTokenLimit)) continue;
    selected.add(index);
    selectedTokens += turn.estimatedTokens;

    if (!turn.required) optionalTurns += 1;
  }

  return turns.flatMap((turn, index) => (selected.has(index) ? turn.messages : []));
}

/**
 * Group bots share one history. A reply another bot wrote reads as that bot
 * speaking, the way people's messages do, so no bot takes it for its own.
 * Replies saved before replies were named may be any bot's.
 */
export function attributeGroupReplies(
  messages: ReadonlyArray<MastraDBMessage>,
  botName: string,
): ReadonlyArray<MastraDBMessage> {
  return messages.flatMap((message) => {
    const named = message.content.metadata?.[OTTO_REPLY_BOT_NAME];
    const author = Predicate.isString(named) ? named : "A bot";

    if (message.role !== "assistant" || author === botName) return [message];

    const text = messageText(message);

    if (text.length === 0) return [];

    return [
      {
        ...message,
        role: "user",
        content: { format: 2, parts: [{ type: "text", text: `${author}: ${text}` }] },
      },
    ];
  });
}
