import type { MastraDBMessage } from "@mastra/core/agent-controller";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { GROUP_NO_REPLY, isGroupTurnNote } from "../orchestration/group-responder.ts";

/** Message metadata naming the bot that wrote an assistant reply. */
export const OTTO_REPLY_BOT_NAME = "ottoBotName";

/** Message metadata on a stored checkpoint: a system row that summarises the chat before it. */
export const OTTO_CHECKPOINT = "ottoCheckpoint";

const decodeCheckpoint = Schema.decodeUnknownOption(
  Schema.Struct({
    firstKeptMessageId: Schema.String,
    tokensBefore: Schema.Number,
    model: Schema.String,
    createdAt: Schema.String,
  }),
);

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

function messageText(message: MastraDBMessage): string {
  return message.content.parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

// Mastra stores a user message as a user signal, not a user row.
export function isUserMessage(message: MastraDBMessage): boolean {
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

export function checkpointOf(message: MastraDBMessage) {
  return message.role === "system"
    ? Option.getOrUndefined(decodeCheckpoint(message.content.metadata?.[OTTO_CHECKPOINT]))
    : undefined;
}

/**
 * A checkpoint is sent as a user message (providers reject system messages mid-chat), dated just
 * before the first message it keeps so the message list orders it there.
 */
export function checkpointAsUserMessage(
  checkpoint: MastraDBMessage,
  firstKept: MastraDBMessage,
): MastraDBMessage {
  return {
    ...checkpoint,
    role: "user",
    createdAt: DateTime.toDate(DateTime.makeUnsafe(firstKept.createdAt.getTime() - 1)),
  };
}

/**
 * What the model gets of a stored chat: the newest checkpoint whose first kept message is still
 * stored, then every complete turn from that message on (or from the start), verbatim. Every
 * transform depends on one message alone, so each request starts with the previous request's
 * history and stays cached.
 */
export function projectHistory(
  messages: ReadonlyArray<MastraDBMessage>,
): ReadonlyArray<MastraDBMessage> {
  const ids = new Map(messages.map((message, index) => [message.id, index]));

  const checkpoint = messages.findLast((message) => {
    const value = checkpointOf(message);

    return value !== undefined && ids.has(value.firstKeptMessageId);
  });

  const start = checkpoint ? ids.get(checkpointOf(checkpoint)!.firstKeptMessageId)! : 0;
  const turns: MastraDBMessage[][] = [];

  for (const message of messages.slice(start)) {
    if (message.role === "system") continue;

    if (isUserMessage(message) || turns.length === 0) turns.push([]);
    turns.at(-1)!.push(withoutUnreadableFiles(message));
  }

  const history = turns.flatMap((turn) =>
    turn.some((message) => message.role === "assistant")
      ? turn.filter((message) => !isGroupPass(message))
      : [],
  );

  return checkpoint && history[0]
    ? [checkpointAsUserMessage(checkpoint, history[0]), ...history]
    : history;
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
