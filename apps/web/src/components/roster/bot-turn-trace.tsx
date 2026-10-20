import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@otto/contracts";
import { useEffect, useState } from "react";
import { formatDuration } from "@otto/shared/orchestrationTiming";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "~/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from "~/components/ui/trace";

import { useI18n } from "../../i18n";
import { formatLoadingElapsed } from "../chat/response-loading-state";
import { environmentMcpServersAtom } from "../../state/mcp-servers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { BotActivitySubject } from "./bot-activity-status.logic";
import type { GroupLiveClock } from "./bot-group-clock.logic";
import type { BotTraceStep, BotTurnTrace as BotTurnTraceData } from "./bot-turn-trace.logic";

type ToolStep = Extract<BotTraceStep, { kind: "tool" }>;

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

function ToolStepRow({
  step,
  environmentId,
}: {
  readonly step: ToolStep;
  readonly environmentId: EnvironmentId | null;
}) {
  const { t } = useI18n();
  const subjectName = useActivitySubjectName(environmentId, step.subject ?? undefined);

  const line = (
    <TraceLine
      {...(step.failed
        ? { status: "error" as const }
        : step.running
          ? { status: "running" as const }
          : {})}
    >
      <TraceTitle>
        {subjectName
          ? t(step.running ? "Using {name}" : "Used {name}", { name: subjectName })
          : t(step.label)}
        {step.detail ? <span className="text-muted-foreground/70"> {step.detail}</span> : null}
      </TraceTitle>
      {step.failed ? <TraceDescription>{t("Failed")}</TraceDescription> : null}
      {!step.failed && step.durationMs !== null ? (
        <TraceDescription>{formatDuration(step.durationMs)}</TraceDescription>
      ) : null}
    </TraceLine>
  );

  if (!step.terminal) return line;

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm">
          <CodeBlockActions>
            <CodeBlockCopyButton value={step.terminal} />
          </CodeBlockActions>
          <CodeBlockContent wrap className="max-h-48">
            {step.terminal}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** A turn's steps in order: each tool call and the thinking between them. */
export function BotTraceSteps({
  steps,
  environmentId,
}: {
  readonly steps: ReadonlyArray<BotTraceStep>;
  readonly environmentId: EnvironmentId | null;
}) {
  const { t } = useI18n();

  return steps.map((step) =>
    step.kind === "thought" ? (
      <TraceLine key={step.id}>
        <TraceTitle>
          {t("Thought for {duration}", { duration: formatDuration(step.durationMs) })}
        </TraceTitle>
      </TraceLine>
    ) : (
      <ToolStepRow key={step.id} step={step} environmentId={environmentId} />
    ),
  );
}

/** "Working for 1m 12s", counting on from `baseMs` and re-rendering only itself each second. */
export function WorkingFor({
  startedAt,
  baseMs = 0,
}: {
  readonly startedAt: number;
  readonly baseMs?: number;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(id);
  }, []);

  return t("Working for {duration}", {
    duration: formatLoadingElapsed(baseMs + Math.max(0, now - startedAt)),
  });
}

/** The status after the name: muted, at the name's weight, shimmering while the bot works. */
export function GroupClockStatus({
  live,
  workedMs,
}: {
  readonly live: GroupLiveClock | null;
  readonly workedMs: number;
}) {
  const { t } = useI18n();

  if (!live) return t("Worked for {duration}", { duration: formatDuration(workedMs) });

  return (
    <span className="shimmer motion-reduce:shimmer-none" data-testid="bot-group-clock-live">
      <WorkingFor startedAt={live.startedAt} baseMs={live.baseMs} />
    </span>
  );
}

/**
 * Otto: One clock per group. A bot's group of replies opens with one header, "Cody · Worked for
 * 24s", the name and the status at one weight with only the status muted. It expands into what
 * the bot did across the group's turns, in order: each tool call in the past tense with what it
 * worked on and how long it took, and the thinking between them. While the bot works on in the
 * same group, the status reads "Working for …", shimmers and counts on from the group's total.
 */
export function BotTurnTrace({
  trace,
  environmentId,
  name,
  live = null,
}: {
  readonly trace: BotTurnTraceData | undefined;
  readonly environmentId: EnvironmentId | null;
  /** Speaker, shown once on the accordion: "Cody · Worked for 24s". */
  readonly name?: string;
  /** Set while the bot is still working in this group. */
  readonly live?: GroupLiveClock | null;
}) {
  if (!trace && !live) return null;

  const title = (
    <TraceLine variant="header">
      <TraceTitle>
        {name ? (
          <>
            <span className="text-foreground">{name}</span>
            <span> · </span>
          </>
        ) : null}
        <GroupClockStatus live={live} workedMs={trace?.workedMs ?? 0} />
      </TraceTitle>
    </TraceLine>
  );

  if (!trace || trace.steps.length === 0) {
    return <Trace data-testid="bot-turn-trace">{title}</Trace>;
  }

  return (
    <Trace data-testid="bot-turn-trace">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{title}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            <BotTraceSteps steps={trace.steps} environmentId={environmentId} />
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
