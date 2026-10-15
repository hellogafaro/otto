import { useAtomValue } from "@effect/atom-react";
import type { MessageKey } from "@otto/client-runtime/i18n";
import type { ThreadSilentRun } from "@otto/client-runtime/silent-run";
import type { EnvironmentId } from "@otto/contracts";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { environmentMcpServersAtom } from "../../state/mcpServers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { cn } from "~/lib/utils";

import { formatLoadingElapsed, ResponseLoadingState } from "../chat/ResponseLoadingState";
import { BotAvatarView } from "./BotAvatarView";
import type { BotActivity, BotActivitySubject } from "./botActivityStatus.logic";
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

// SAFETY: An empty id names no environment; the atom and query hold nothing for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** The connected app's or MCP server's name a running tool works on, once known. */
export function useActivitySubjectName(
  environmentId: EnvironmentId | null,
  subject: BotActivitySubject | undefined,
): string | null {
  const servers = useAtomValue(environmentMcpServersAtom(environmentId ?? NO_ENVIRONMENT));

  const composio = useEnvironmentQuery(
    environmentId && subject?.kind === "app"
      ? serverEnvironment.composioStatus({ environmentId, input: {} })
      : null,
  );

  if (subject?.kind === "server") {
    return servers.find((server) => server.id === subject.id)?.name ?? null;
  }

  if (subject?.kind !== "app") return null;

  return (
    composio.data?.connections.find((connection) => connection.toolkitSlug === subject.slug)
      ?.toolkitName ?? null
  );
}

/** Runs this short need no timer; past it, each row shows how long its bot has been at it. */
export const ACTIVITY_TIMER_AFTER_MS = 10_000;

/** One playful verb at a time, crossfading to the next every few seconds. */
function ThinkingVerb() {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => Math.floor(Date.now() / THINKING_VERB_MS));

  useEffect(() => {
    const id = window.setInterval(() => setIndex((current) => current + 1), THINKING_VERB_MS);

    return () => window.clearInterval(id);
  }, []);

  const verb = t(THINKING_VERBS[index % THINKING_VERBS.length] ?? "Thinking");

  return <ShimmerText key={verb} className="motion-fade-in" text={verb} />;
}

/** Text with a soft sheen sweeping across it while work is in progress. */
function ShimmerText({ text, className }: { readonly text: string; readonly className?: string }) {
  return (
    <span className={cn("bot-shimmer-text min-w-0 truncate", className)}>
      {text}
      <span aria-hidden="true" className="bot-shimmer-sheen">
        <span className="bot-shimmer-sheen-text">{text}</span>
      </span>
    </span>
  );
}

/** Time since the turn started, appearing once it passes ten seconds; ticks without committing React. */
function ActivityElapsed({ startedAt }: { readonly startedAt: number }) {
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      const node = textRef.current;

      if (!node) return;
      const elapsed = Date.now() - startedAt;

      node.hidden = elapsed < ACTIVITY_TIMER_AFTER_MS;
      node.textContent = formatLoadingElapsed(elapsed);
    };

    update();
    const id = window.setInterval(update, 1000);

    return () => window.clearInterval(id);
  }, [startedAt]);

  const elapsed = Date.now() - startedAt;

  return (
    <span
      ref={textRef}
      hidden={elapsed < ACTIVITY_TIMER_AFTER_MS}
      className="shrink-0 text-xs tabular-nums text-muted-foreground"
      data-testid="bot-activity-time"
    >
      {formatLoadingElapsed(elapsed)}
    </span>
  );
}

/**
 * Otto: A working bot shows itself in the chat history, where its reply will appear: its own 28px
 * avatar in the working pose, then one shimmering line, without trailing dots, saying what the run
 * is really doing ("Reading a skill", "Using Google Calendar"). A bot queued behind it in a group
 * round shows a still avatar and a muted "Waiting to reply". Under the bot's own streaming reply the avatar
 * gives way to the message's indent. While it only thinks, playful verbs rotate in that line.
 * Past ten seconds the row shows its own elapsed time. A run its provider went quiet on instead
 * shows the stalled timer counting from the last output.
 */
export function BotActivityStatus({
  bot,
  activity,
  startedAt,
  subjectName = null,
  silentRun = null,
  continuesReply = false,
  waiting = false,
}: {
  readonly bot: Pick<Bot, "name" | "avatar">;
  readonly activity: BotActivity;
  /** When the turn started, for the elapsed time. */
  readonly startedAt: string | null;
  /** The app's or MCP server's name for a tool working on one. */
  readonly subjectName?: string | null;
  readonly silentRun?: ThreadSilentRun | null;
  /** The bot's reply is already streaming above, so the row continues it without the avatar. */
  readonly continuesReply?: boolean;
  /** Queued behind another bot in a group round: still, muted and without a timer. */
  readonly waiting?: boolean;
}) {
  const { t } = useI18n();

  const rowClass = cn(
    "motion-message-enter flex w-full min-w-0 items-center gap-3 text-sm",
    continuesReply ? "mt-1" : "mt-3",
  );

  const started = startedAt ? Date.parse(startedAt) : Number.NaN;

  const avatar = continuesReply ? (
    <span aria-hidden="true" className="size-7 shrink-0" />
  ) : (
    <BotAvatarView
      avatar={bot.avatar}
      name={bot.name}
      state={waiting ? "idle" : "working"}
      className="size-7 shrink-0"
    />
  );

  if (waiting) {
    return (
      <div className={rowClass} data-testid="bot-activity-status" data-waiting="">
        {avatar}
        <span className="sr-only">{bot.name}: </span>
        <span className="min-w-0 truncate text-muted-foreground">{t("Waiting to reply")}</span>
      </div>
    );
  }

  if (silentRun) {
    return (
      <div className={rowClass} data-testid="bot-activity-status" data-silent-run="">
        {avatar}
        <ResponseLoadingState
          createdAt={silentRun.lastActivityAt}
          label={t("No response from {provider}", { provider: silentRun.providerName })}
          stalled
        />
      </div>
    );
  }

  const label =
    activity.subject && subjectName ? t("Using {name}", { name: subjectName }) : t(activity.label);

  return (
    <div aria-live="polite" className={rowClass} data-testid="bot-activity-status">
      {avatar}
      <span className="sr-only">{bot.name}: </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-foreground">
        {activity.thinking ? <ThinkingVerb /> : <ShimmerText key={label} text={label} />}
        {Number.isFinite(started) ? <ActivityElapsed startedAt={started} /> : null}
      </span>
    </div>
  );
}
