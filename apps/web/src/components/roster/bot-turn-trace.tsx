import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@otto/contracts";
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
import { environmentMcpServersAtom } from "../../state/mcp-servers";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import type { BotActivitySubject } from "./bot-activity-status.logic";
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

/**
 * Otto: A finished reply that used tools opens with one quiet "Worked for 24s" line, Capy-style.
 * It expands into what the bot did, in order: each tool call in the past tense with what it
 * worked on and how long it took, and the thinking between them. A command opens into a small
 * terminal block with the command and the start of its output.
 */
export function BotTurnTrace({
  trace,
  environmentId,
}: {
  readonly trace: BotTurnTraceData | undefined;
  readonly environmentId: EnvironmentId | null;
}) {
  const { t } = useI18n();

  if (!trace) return null;

  return (
    <Trace className="mt-1" data-testid="bot-turn-trace">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>
              {t("Worked for {duration}", { duration: formatDuration(trace.workedMs) })}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            <BotTraceSteps steps={trace.steps} environmentId={environmentId} />
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
