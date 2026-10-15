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
import { useActivitySubjectName } from "./BotActivityStatus";
import type { BotTraceStep, BotTurnTrace as BotTurnTraceData } from "./botTurnTrace.logic";

type ToolStep = Extract<BotTraceStep, { kind: "tool" }>;

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
    <TraceLine {...(step.failed ? { status: "error" as const } : {})}>
      <TraceTitle>
        {subjectName ? t("Used {name}", { name: subjectName }) : t(step.label)}
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
            {trace.steps.map((step) =>
              step.kind === "thought" ? (
                <TraceLine key={step.id}>
                  <TraceTitle>
                    {t("Thought for {duration}", { duration: formatDuration(step.durationMs) })}
                  </TraceTitle>
                </TraceLine>
              ) : (
                <ToolStepRow key={step.id} step={step} environmentId={environmentId} />
              ),
            )}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
