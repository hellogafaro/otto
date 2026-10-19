import type {
  EnvironmentId,
  MessageId,
  OrchestrationMessage,
  ScopedThreadRef,
} from "@otto/contracts";
import type { ReplyPlaybackSession } from "@otto/client-runtime/reply-playback";

import type { BotStepMeterData } from "@otto/client-runtime/bot-step-usage";
import type { BotTurnTrace } from "./bot-turn-trace.logic";
import type { ChannelApprovalTarget } from "./channel-send-approval";
import type { Bot } from "./types";
import type { MessageReactionHandler } from "./use-message-reaction-updater";

export type MessageReplyHandler = (messageId: MessageId, label: string, text: string) => void;

/** Props of the memoized assistant row, compared by `assistantRowPropsEqual`. */
export interface AssistantMessageRowProps {
  readonly message: OrchestrationMessage;
  /** The replying bot, or null when it is no longer available. */
  readonly author: Pick<Bot, "avatar" | "name"> | null;
  readonly testId: string;
  readonly arrived?: boolean;
  /** First reply in a run from the same author: shows the avatar and name. */
  readonly startsGroup: boolean;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly stepMeter: BotStepMeterData | undefined;
  /** What the turn behind this reply did, when it used tools. */
  readonly trace: BotTurnTrace | undefined;
  /** Names the apps and MCP servers in the trace. */
  readonly environmentId: EnvironmentId | null;
  readonly currentPersonId: string | null | undefined;
  readonly playback: ReplyPlaybackSession | null;
  /** Changes when the playback context changes, so the read-aloud action is recomputed. */
  readonly playbackKey: string | null | undefined;
  readonly channelApproval: ChannelApprovalTarget | null;
  readonly onReply: MessageReplyHandler;
  /** Null while the chat has no linked thread to react in. */
  readonly onReactionChange: MessageReactionHandler | null;
}

function shallowEqual<T extends object>(a: T | null | undefined, b: T | null | undefined) {
  if (a === b) return true;

  if (!a || !b) return false;
  // SAFETY: these own enumerable keys are read from the same typed props object for shallow equality.
  const keys = Object.keys(a) as (keyof T)[];

  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

function stepMetersEqual(a: BotStepMeterData | undefined, b: BotStepMeterData | undefined) {
  if (a === b) return true;

  if (!a || !b) return false;

  return a.tokens === b.tokens && a.costUsd === b.costUsd && shallowEqual(a.engine, b.engine);
}

function tracesEqual(a: BotTurnTrace | undefined, b: BotTurnTrace | undefined) {
  if (a === b) return true;

  if (!a || !b || a.workedMs !== b.workedMs || a.steps.length !== b.steps.length) return false;

  return a.steps.every((step, index) => {
    const other = b.steps[index];

    if (!other || step.kind !== other.kind) return false;

    if (step.kind === "thought" || other.kind === "thought") return shallowEqual(step, other);

    return (
      shallowEqual({ ...step, subject: null }, { ...other, subject: null }) &&
      shallowEqual(step.subject, other.subject)
    );
  });
}

export function assistantRowPropsEqual(
  previous: AssistantMessageRowProps,
  next: AssistantMessageRowProps,
) {
  // SAFETY: these own enumerable keys are read from the same typed props object for shallow equality.
  const keys = Object.keys(next) as (keyof AssistantMessageRowProps)[];

  if (keys.length !== Object.keys(previous).length) return false;

  return keys.every((key) => {
    switch (key) {
      case "stepMeter":
        return stepMetersEqual(previous.stepMeter, next.stepMeter);
      case "trace":
        return tracesEqual(previous.trace, next.trace);
      case "channelApproval":
        return shallowEqual(previous.channelApproval, next.channelApproval);
      default:
        return Object.is(previous[key], next[key]);
    }
  });
}
