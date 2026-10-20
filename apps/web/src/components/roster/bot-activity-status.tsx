import type { MessageKey } from "@otto/client-runtime/i18n";
import type { EnvironmentId } from "@otto/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "~/components/ui/trace";

import { BotAvatarView } from "./bot-avatar-view";
import type { BotActivity } from "./bot-activity-status.logic";
import { BotTraceSteps, GroupClockStatus } from "./bot-turn-trace";
import type { BotTraceStep } from "./bot-turn-trace.logic";
import type { Bot } from "./types";

/** Playful stand-ins while the bot thinks with no tool running. */
export const THINKING_VERBS = [
  "Thinking",
  "Noodling",
  "Percolating",
  "Mulling it over",
  "Connecting the dots",
  "Rummaging",
  "Pondering",
  "Scheming",
  "Consulting the rubber duck",
  "Untangling",
] as const satisfies readonly MessageKey[];

const THINKING_VERB_MS = 3200;

/** One playful verb at a time, crossfading to the next every few seconds. */
function ThinkingVerb() {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => Math.floor(Date.now() / THINKING_VERB_MS));

  useEffect(() => {
    const id = window.setInterval(() => setIndex((current) => current + 1), THINKING_VERB_MS);

    return () => window.clearInterval(id);
  }, []);

  const verb = t(THINKING_VERBS[index % THINKING_VERBS.length] ?? "Thinking");

  // The fade-in sits on a wrapper: both it and the shimmer are CSS animations on one property.
  return (
    <span key={verb} className="flex min-w-0 motion-fade-in">
      <ShimmerText text={verb} />
    </span>
  );
}

/** Otto: In-progress text runs shadcn's shimmer utility, held still for reduced motion. */
function ShimmerText({ text }: { readonly text: string }) {
  return <span className="min-w-0 truncate shimmer motion-reduce:shimmer-none">{text}</span>;
}

/** Keeps a scrolling list on its newest row until the person scrolls up, and again once back. */
function useFollowNewest(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const node = ref.current;

    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const node = ref.current;

    if (node) following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;
  };

  return { ref, onScroll };
}

/**
 * Otto: A working bot shows itself in the chat history, where its reply will appear: its own 28px
 * avatar in the working pose beside "Cody · Working for 12s", the name and the muted, shimmering
 * status at one weight, the same in a DM and a group. Under it the trace is already open, the same
 * lines the reply's "Worked for" trace keeps: each finished step in the past tense with its time,
 * the running one shimmering in the present tense, and "Thinking" between steps. Before the first
 * step playful verbs rotate there instead. The list shows about seven rows and scrolls inside,
 * following the newest. Once the bot's group has a reply, that group's one header carries the
 * clock, so under the last bubble only the open trace continues, with no second status.
 */
export function BotActivityStatus({
  bot,
  activity,
  steps,
  startedAt,
  environmentId,
  continuesReply = false,
}: {
  readonly bot: Pick<Bot, "name" | "avatar">;
  readonly activity: BotActivity;
  /** What the running turn has done so far. */
  readonly steps: ReadonlyArray<BotTraceStep>;
  /** When the turn started, for the elapsed time. */
  readonly startedAt: string | null;
  readonly environmentId: EnvironmentId | null;
  /** The bot's reply is already streaming above, so the row continues it without the avatar. */
  readonly continuesReply?: boolean;
}) {
  const { t } = useI18n();
  const follow = useFollowNewest(steps.length);
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const running = steps.some((step) => step.kind === "tool" && step.running);

  // A running tool is already the trace's shimmering last line.
  const live = running ? null : activity.thinking ? (
    steps.length === 0 ? (
      <ThinkingVerb />
    ) : (
      <ShimmerText text={t("Thinking")} />
    )
  ) : (
    <ShimmerText key={activity.label} text={t(activity.label)} />
  );

  const lines = (
    <Trace ref={follow.ref} onScroll={follow.onScroll} className="max-h-44 overflow-y-auto">
      <BotTraceSteps steps={steps} environmentId={environmentId} />
      {live ? (
        <TraceLine>
          <span className="flex min-w-0">{live}</span>
        </TraceLine>
      ) : null}
    </Trace>
  );

  // The group's header above already counts this work; only the open trace continues here.
  if (continuesReply) {
    return (
      <div
        aria-live="polite"
        className="motion-message-enter mt-0.5 flex w-full min-w-0 text-sm"
        data-testid="bot-activity-status"
      >
        <span className="sr-only">{t("{name} is working", { name: bot.name })}</span>
        <div className="ml-10 min-w-0 flex-1 border-l pl-3.75" data-testid="bot-live-trace">
          {lines}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="motion-message-enter mt-3 flex w-full min-w-0 items-start gap-3 text-sm"
      data-testid="bot-activity-status"
    >
      <BotAvatarView
        avatar={bot.avatar}
        name={bot.name}
        state="working"
        className="size-7 shrink-0"
      />
      <span className="sr-only">{bot.name}: </span>
      <Trace className="min-w-0 flex-1" data-testid="bot-live-trace">
        <TraceCollapsible defaultOpen>
          <TraceCollapsibleTrigger className="min-h-7">
            <TraceLine variant="header">
              <TraceTitle data-testid="bot-activity-time">
                <span className="text-foreground">{bot.name}</span>
                <span> · </span>
                {Number.isFinite(started) ? (
                  <GroupClockStatus live={{ startedAt: started, baseMs: 0 }} workedMs={0} />
                ) : (
                  <span className="shimmer motion-reduce:shimmer-none">{t("Working")}</span>
                )}
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>{lines}</TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  );
}
