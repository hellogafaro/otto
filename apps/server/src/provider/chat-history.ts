import type { MastraDBMessage } from "@mastra/core/agent-controller";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  IMAGE_DIMENSIONS_HEADER_BYTES,
  MODEL_IMAGE_MAX_SIDE,
  readImageDimensions,
} from "@otto/shared/imageDimensions";
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

/** Providers refuse larger inputs, so a bigger attachment reaches the model only as its path. */
export const MODEL_FILE_MAX_BYTES = 8 * 1024 * 1024;

export const modelReadsAttachment = (attachment: {
  readonly mimeType: string;
  readonly sizeBytes: number;
}) => modelReadsFile(attachment.mimeType) && attachment.sizeBytes <= MODEL_FILE_MAX_BYTES;

// Base64 for the header bytes that hold any image's size.
const IMAGE_HEADER_CHARS = Math.ceil(IMAGE_DIMENSIONS_HEADER_BYTES / 3) * 4;

/**
 * Otto: Why a base64 image is too large for the model and what the bot can do about it, or
 * undefined when the model takes it.
 */
export function oversizedImageNote(data: string): string | undefined {
  const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  const size = readImageDimensions(Buffer.from(base64.slice(0, IMAGE_HEADER_CHARS), "base64"));

  if (!size || Math.max(size.width, size.height) <= MODEL_IMAGE_MAX_SIDE) return undefined;

  return `[The image is ${size.width}×${size.height} pixels, so it was left out: models take at most ${MODEL_IMAGE_MAX_SIDE} pixels a side. Scale it down on the computer (for example \`convert in.png -resize ${MODEL_IMAGE_MAX_SIDE}x${MODEL_IMAGE_MAX_SIDE} out.png\`) or crop a tall page into screen-sized pieces, then read those.]`;
}

/**
 * Otto: A screenshot read in an older turn, before images were capped, fails every later
 * request once the chat holds many images. It is sent as the note the bot would get now.
 */
function withoutOversizedImages(message: MastraDBMessage): MastraDBMessage {
  let changed = false;

  const parts = message.content.parts.map((part) => {
    if (part.type !== "tool-invocation") return part;
    const mastra = part.providerMetadata?.["mastra"];
    const output = mastra?.["modelOutput"];

    if (!Predicate.isObject(output) || Array.isArray(output) || output["type"] !== "content") {
      return part;
    }

    const value = output["value"];

    if (!Array.isArray(value)) return part;

    const next = value.map((item) => {
      // Mastra stores a tool's image-data output as `media`.
      if (
        !Predicate.isObject(item) ||
        Array.isArray(item) ||
        (item["type"] !== "image-data" && item["type"] !== "media") ||
        !Predicate.isString(item["mediaType"]) ||
        !item["mediaType"].startsWith("image/")
      ) {
        return item;
      }

      const note = Predicate.isString(item["data"]) ? oversizedImageNote(item["data"]) : undefined;

      return note ? { type: "text", text: note } : item;
    });

    if (next.every((item, index) => item === value[index])) return part;
    changed = true;

    return {
      ...part,
      providerMetadata: {
        ...part.providerMetadata,
        mastra: { ...mastra, modelOutput: { ...output, value: next } },
      },
    };
  });

  return changed ? { ...message, content: { ...message.content, parts } } : message;
}

/**
 * A text file reaches the model whole up to this many characters. A CSV of long tracking URLs
 * runs under two characters a token, so a few megabytes of it overflow any model's window.
 */
export const MODEL_TEXT_MAX_CHARS = 100_000;

/** A longer text file reaches the model as its first lines, up to this many characters. */
export const MODEL_TEXT_PREVIEW_CHARS = 8_000;

/**
 * Otto: A text attachment as the model reads it, fenced: whole, or when it is longer than
 * MODEL_TEXT_MAX_CHARS, its first lines and a note to open the saved file for the rest.
 */
export function inlineTextFile(name: string, text: string): string {
  let header = `[File: ${name}]`;
  let body = text;

  if (text.length > MODEL_TEXT_MAX_CHARS) {
    const cut = text.lastIndexOf("\n", MODEL_TEXT_PREVIEW_CHARS);
    body = text.slice(0, cut > 0 ? cut : MODEL_TEXT_PREVIEW_CHARS);

    const lines = text.replace(/\n$/, "").split("\n").length;
    const shown = body.split("\n").length;
    header = `[File: ${name} (too long to send whole: its first ${shown} of ${lines} lines follow; read the saved file for the rest)]`;
  }

  let longestRun = 0;

  for (const run of body.matchAll(/`+/g)) longestRun = Math.max(longestRun, run[0].length);

  const fence = "`".repeat(Math.max(3, longestRun + 1));

  return `${header}\n${fence}\n${body}\n${fence}`;
}

// A fenced text file inlined into a person's message. The fence is longer than any backtick
// run inside it, so the first line that is exactly the fence closes it.
const INLINE_TEXT_FILE = /\[File: ([^\n]*)\]\n(`{3,})\n([\s\S]*?)\n\2(?!`)/g;

/**
 * Otto: Before text files were capped, a whole file of up to 8 MiB was inlined and stored. Replayed,
 * it overflows every later turn, so the chat could never continue; it is sent as its preview.
 */
function withoutOversizedText(message: MastraDBMessage): MastraDBMessage {
  if (!isUserMessage(message)) return message;

  let changed = false;

  const parts = message.content.parts.map((part) => {
    if (part.type !== "text" || part.text.length <= MODEL_TEXT_MAX_CHARS) return part;

    const text = part.text.replace(INLINE_TEXT_FILE, (block, name: string, _fence, body: string) =>
      body.length > MODEL_TEXT_MAX_CHARS ? inlineTextFile(name, body) : block,
    );

    if (text === part.text) return part;
    changed = true;

    return { ...part, text };
  });

  return changed ? { ...message, content: { ...message.content, parts } } : message;
}

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

/** A person's message or a task event: each starts a turn. */
export function startsTurn(message: MastraDBMessage): boolean {
  if (isUserMessage(message)) return true;

  const signal = message.role === "signal" ? message.content.metadata?.["signal"] : undefined;

  return Predicate.isObject(signal) && "type" in signal && signal.type === "notification";
}

/** A group turn sent as its hidden note alone: it starts the run and is never stored. */
export function isGroupTurnNoteMessage(message: MastraDBMessage): boolean {
  return isUserMessage(message) && isGroupTurnNote(messageText(message));
}

// A group bot that passed left a hidden note and a NO_REPLY that nobody saw.
// Replaying them teaches every bot in the group to pass.
function isGroupPass(message: MastraDBMessage): boolean {
  const text = messageText(message);

  return message.role === "assistant" ? text === GROUP_NO_REPLY : isGroupTurnNote(text);
}

// Mastra's memory neither stores nor recalls system messages, so a checkpoint is stored as an
// assistant message that only its metadata marks.
export function checkpointOf(message: MastraDBMessage) {
  return Option.getOrUndefined(decodeCheckpoint(message.content.metadata?.[OTTO_CHECKPOINT]));
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
    if (checkpointOf(message)) continue;

    if (startsTurn(message) || turns.length === 0) turns.push([]);
    turns
      .at(-1)!
      .push(withoutOversizedImages(withoutOversizedText(withoutUnreadableFiles(message))));
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
