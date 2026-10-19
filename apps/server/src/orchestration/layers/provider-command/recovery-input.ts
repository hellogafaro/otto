import { asRecord } from "../../activity-payload-bounds.ts";
import * as Predicate from "effect/Predicate";
import type {
  BotId,
  MessageId,
  OrchestrationMessage,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from "@otto/contracts";
import { MANUAL_RECOVERY_INPUT, STARTUP_RECOVERY_INPUT } from "./fields.ts";

/** What a resumed turn needs to know about the run that stopped. */
export interface RecoveryInputContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  /** The message that started the turn, when the projection recorded it. */
  readonly requestMessageId?: MessageId | null;
  readonly requestedAt?: string | null;
  /** In a group, only this bot's replies count as its last update. */
  readonly respondingBotId?: BotId | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

const REQUEST_CHARS = 6_000;

const FOLLOW_UP_CHARS = 1_500;

const MAX_FOLLOW_UPS = 5;

const UPDATE_CHARS = 2_000;

/**
 * The note a turn resumes with after a restart. It quotes the request, the
 * messages the person added while the bot worked and the bot's last finished
 * update, because compaction can fold the request into a summary and a
 * resumed turn must not lose track of its job or pick up another one.
 */
export function startupRecoveryInput(context: RecoveryInputContext): string {
  return recoveryInput(STARTUP_RECOVERY_INPUT, context);
}

/** The same note for a turn the person resumes by hand. */
export function manualRecoveryInput(context: RecoveryInputContext): string {
  return recoveryInput(MANUAL_RECOVERY_INPUT, context);
}

function recoveryInput(lead: string, context: RecoveryInputContext): string {
  const answerPrefix = `user-input:${context.threadId}:`;
  const parts = [lead];

  // A question answered while the turn was still running lives only in the
  // projection until the turn reaches a durable point, so it is repeated here.
  const answers = questionAnswers(context, answerPrefix);

  if (answers.length > 0) {
    parts.push(
      `The person already answered these questions in this request, so use the answers instead of asking again: ${answers.join("; ")}.`,
    );
  }

  const isRequest = (message: OrchestrationMessage) =>
    message.role === "user" &&
    !message.id.startsWith(answerPrefix) &&
    (message.text.trim() !== "" || (message.attachments?.length ?? 0) > 0);

  const requestIndex = findRequestIndex(context, isRequest);

  if (requestIndex < 0) return parts.join("\n\n");

  const request = context.messages[requestIndex]!;
  const later = context.messages.slice(requestIndex + 1);
  const followUps = later.filter(isRequest);

  parts.push(
    [
      "This is the request you were working on. It is context, not a new request: continue it from where you stopped instead of starting over.",
      quote("request", request, REQUEST_CHARS),
    ].join("\n"),
  );

  if (followUps.length > 0) {
    const shown = followUps.slice(-MAX_FOLLOW_UPS);
    const skipped = followUps.length - shown.length;

    parts.push(
      [
        "Messages the person added while you worked, oldest first:",
        ...(skipped > 0
          ? [`[${skipped} earlier messages left out; they are in the conversation]`]
          : []),
        ...shown.map((message) => quote("follow-up", message, FOLLOW_UP_CHARS)),
      ].join("\n"),
    );
  }

  const update = later.findLast(
    (message) =>
      message.role === "assistant" &&
      !message.streaming &&
      message.text.trim() !== "" &&
      (context.respondingBotId == null ||
        message.respondingBotId == null ||
        message.respondingBotId === context.respondingBotId),
  );

  if (update) {
    parts.push(
      [
        "Your last finished update on it. Anything after this point may be half done:",
        `<update>\n${clip(neutralizeTags(update.text), UPDATE_CHARS)}\n</update>`,
      ].join("\n"),
    );
  } else {
    parts.push("You had not posted an update on it yet.");
  }

  return parts.join("\n\n");
}

/**
 * The turn's recorded request message wins. Without it, the first message at
 * or after the turn was requested is the request and later ones are follow-ups.
 * The last message is the final fallback.
 */
function findRequestIndex(
  context: RecoveryInputContext,
  isRequest: (message: OrchestrationMessage) => boolean,
): number {
  const { messages, requestMessageId, requestedAt } = context;

  if (requestMessageId) {
    const index = messages.findLastIndex(
      (message) => message.id === requestMessageId && isRequest(message),
    );

    if (index >= 0) return index;
  }

  if (requestedAt) {
    const index = messages.findIndex(
      (message) => isRequest(message) && message.createdAt >= requestedAt,
    );

    if (index >= 0) return index;
  }

  return messages.findLastIndex(isRequest);
}

function questionAnswers(context: RecoveryInputContext, answerPrefix: string): Array<string> {
  if (context.turnId === null) return [];
  const questions = new Map<string, string>();

  for (const activity of context.activities) {
    if (activity.kind !== "user-input.requested") continue;
    const payload = asRecord(activity.payload);
    const question = asRecord(Array.isArray(payload?.questions) ? payload.questions[0] : null);

    if (Predicate.isString(payload?.requestId) && Predicate.isString(question?.question)) {
      questions.set(payload.requestId, question.question);
    }
  }

  return context.messages.flatMap((message) => {
    if (message.role !== "user" || message.turnId !== context.turnId) return [];

    if (!message.id.startsWith(answerPrefix)) return [];
    const question = questions.get(message.id.slice(answerPrefix.length));

    return [question ? `"${question}" -> ${message.text}` : message.text];
  });
}

function quote(tag: "request" | "follow-up", message: OrchestrationMessage, limit: number) {
  const author = message.authorDisplayName?.replaceAll(/["<>\n]/g, "").trim();
  const opening = author ? `<${tag} from="${author}">` : `<${tag}>`;
  const lines = [opening];
  const text = message.text.trim();

  if (text !== "") lines.push(clip(neutralizeTags(text), limit));

  const files = message.attachments?.map((attachment) => attachment.name) ?? [];

  if (files.length > 0) {
    lines.push(`[Attached: ${files.join(", ")}. The files are in the conversation.]`);
  }

  lines.push(`</${tag}>`);

  return lines.join("\n");
}

/** Quoted text cannot open or close the note's own tags. */
function neutralizeTags(text: string): string {
  return text.replaceAll(/<(\/?)(request|follow-up|update)\b/gi, "&lt;$1$2");
}

/** Keeps the start and end of long text, the end often holding the latest ask. */
function clip(text: string, limit: number): string {
  const chars = Array.from(text);

  if (chars.length <= limit) return text;

  const head = Math.ceil(limit * 0.7);
  const tail = limit - head;

  return [
    chars.slice(0, head).join(""),
    `[${chars.length - limit} characters left out]`,
    chars.slice(-tail).join(""),
  ].join("\n");
}
