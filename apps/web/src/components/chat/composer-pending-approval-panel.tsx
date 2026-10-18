import { RiTimeLine } from "@remixicon/react";
import { Predicate, Schema, Option } from "effect";

import { memo } from "react";
import { createTranslator } from "@otto/client-runtime/i18n";
import { hourlyScheduleText } from "@otto/client-runtime/routines";
import { OTTO_CREATE_ROUTINE_TOOL_NAME } from "@otto/contracts";
import { type PendingApproval } from "../../session-logic";
import { describeCommandApproval } from "~/lib/command-approval-details";
import { useLibraryData } from "../library/use-library";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";

type Translate = ReturnType<typeof useI18n>["t"];

const englishTranslator = createTranslator("en");

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
  hideLabel?: boolean;
}

// The drawer already owns a surface, so the detail well is an inset fill rather
// than a second bordered card.
const DETAIL_SURFACE_CLASS_NAME = "rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5";

function isJsonObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value);
}

function CommandGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.07] font-mono text-10px text-muted-foreground"
    >
      $
    </span>
  );
}

interface RoutineProposalDetails {
  readonly name: string | null;
  readonly instructions: string | null;
  readonly schedule: string | null;
  readonly timezone: string | null;
  readonly uses: ReadonlyArray<string>;
}

function stringField(record: Schema.JsonObject, key: string): string | null {
  const value = record[key];

  return Predicate.isString(value) && value.trim() ? value.trim() : null;
}

function stringList(value: Schema.Json | undefined): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((item): item is string => Predicate.isString(item) && item.trim() !== "")
    : [];
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function routineInstructions(
  instructions: string | null,
  schedule: Schema.Json | undefined,
): string | null {
  if (!instructions) return null;

  if (!schedule || !isJsonObject(schedule)) return instructions;
  const kind = schedule.kind;
  const comma = instructions.indexOf(",");

  if (comma < 0) return instructions;
  const lead = instructions.slice(0, comma).trim();
  const task = instructions.slice(comma + 1).trim();

  if (!task) return instructions;

  const duplicatesSchedule =
    (kind === "daily" && /^(?:every day|every morning|daily)\b/i.test(lead)) ||
    (kind === "weekdays" && /^(?:every weekday|on weekdays|weekdays)\b/i.test(lead)) ||
    (kind === "weekly" &&
      /^every (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lead));

  return duplicatesSchedule ? capitalize(task) : instructions;
}

function weekdayLabel(day: string, t: Translate): string {
  switch (day.toLowerCase()) {
    case "monday":
      return t("Monday");
    case "tuesday":
      return t("Tuesday");
    case "wednesday":
      return t("Wednesday");
    case "thursday":
      return t("Thursday");
    case "friday":
      return t("Friday");
    case "saturday":
      return t("Saturday");
    case "sunday":
      return t("Sunday");
    default:
      return capitalize(day);
  }
}

/** Translates the reviewer signals from `describeCommandApproval`; unknown labels pass through. */
function commandSignalLabel(signal: string, t: Translate): string {
  switch (signal) {
    case "Runs as root":
      return t("Runs as root");
    case "Deletes files":
      return t("Deletes files");
    case "Network access":
      return t("Network access");
    case "Publishes":
      return t("Publishes");
    case "Writes files":
      return t("Writes files");
    case "Changes permissions":
      return t("Changes permissions");
    default:
      return signal;
  }
}

// Describes only what the draft states. An unknown or missing schedule yields
// null rather than a guessed default.
function routineScheduleText(
  schedule: Schema.Json | undefined,
  t: Translate,
  locale: string,
): string | null {
  if (!schedule || !isJsonObject(schedule)) return null;
  const record = schedule;
  const time = stringField(record, "time");

  if (!time) return null;

  if (record.kind === "hourly") {
    return hourlyScheduleText(
      Predicate.isNumber(record.everyHours) ? record.everyHours : 1,
      time,
      t,
    );
  }

  if (record.kind === "daily") return t("Every day at {time}", { time });

  if (record.kind === "weekdays") return t("Weekdays at {time}", { time });

  if (record.kind === "weekly") {
    const days = stringList(record.weekdays).map((day) => weekdayLabel(day, t));

    if (days.length === 0) return null;
    const dayList = new Intl.ListFormat(locale, { type: "conjunction" }).format(days);

    return t("Every {days} at {time}", { days: dayList, time });
  }

  return null;
}

const decodeRoutineArgs = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json));

export function routineProposalDetails(
  args: PendingApproval["args"],
  t: Translate = englishTranslator.translate,
  locale: string = englishTranslator.locale,
): RoutineProposalDetails | null {
  const record = Option.getOrNull(decodeRoutineArgs(args));

  if (!record) return null;

  const details = {
    name: stringField(record, "name"),
    instructions: routineInstructions(stringField(record, "instructions"), record.schedule),
    schedule: routineScheduleText(record.schedule, t, locale),
    timezone: stringField(record, "timezone"),
    uses: [...stringList(record.skillNames), ...stringList(record.connectorNames)],
  };

  return details.name || details.instructions || details.schedule ? details : null;
}

function RoutineProposal({
  args,
  className,
  hideLabel,
  label,
  pendingCount,
}: {
  args: PendingApproval["args"];
  className: string | undefined;
  hideLabel: boolean;
  label: string;
  pendingCount: number;
}) {
  const { t, locale } = useI18n();
  const details = routineProposalDetails(args, t, locale);

  return (
    <div
      aria-label={label}
      className={cn("flex min-w-0 flex-1 flex-col gap-2", className)}
      role="group"
    >
      {!hideLabel ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-foreground">{t("Review routine")}</span>
          {pendingCount > 1 ? (
            <span className="ml-auto text-10px text-muted-foreground tabular-nums">
              1/{pendingCount}
            </span>
          ) : null}
        </div>
      ) : null}
      {details ? (
        <div
          aria-label={t("Routine details")}
          className="flex min-w-0 flex-col gap-2.5"
          data-testid="routine-proposal"
        >
          {details.name ? (
            <p className="min-w-0 text-base font-semibold leading-5 text-foreground">
              {details.name}
            </p>
          ) : null}
          {details.schedule ? (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <RiTimeLine aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {details.schedule}
                {details.timezone ? (
                  <span className="text-muted-foreground"> · {details.timezone}</span>
                ) : null}
              </span>
            </p>
          ) : null}
          {details.instructions ? (
            <div className="min-w-0">
              <p className="text-11px font-medium text-muted-foreground">{t("What it does")}</p>
              <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90">
                {details.instructions}
              </p>
            </div>
          ) : null}
          {details.uses.length > 0 ? (
            <p className="min-w-0 truncate text-11px text-muted-foreground">
              {t("Uses {list}", { list: details.uses.join(", ") })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          {t(
            "The routine details did not come through. Read the bot's last message before creating it.",
          )}
        </p>
      )}
    </div>
  );
}

/** A skill a bot proposes: what it is, who gets it, why, and its instructions. */
export function skillProposalDetails(args: PendingApproval["args"]) {
  const record = Predicate.isObject(args) ? args : {};

  const text = (key: string) =>
    key in record && Predicate.isString(record[key]) ? record[key].trim() : "";

  return {
    name: text("name"),
    team: text("visibility") === "organization",
    personal: text("visibility") === "user",
    description: text("description"),
    reason: text("reason"),
    instructions: text("instructions"),
  };
}

function SkillProposal({
  args,
  className,
  hideLabel,
  label,
  pendingCount,
}: {
  args: PendingApproval["args"];
  className: string | undefined;
  hideLabel: boolean;
  label: string;
  pendingCount: number;
}) {
  const { t } = useI18n();
  const library = useLibraryData();
  const details = skillProposalDetails(args);

  const skillId =
    Predicate.isObject(args) && "skillId" in args && Predicate.isString(args.skillId)
      ? args.skillId
      : null;

  const name = details.name || library.folders.find((folder) => folder.id === skillId)?.title || "";

  return (
    <div
      aria-label={label}
      className={cn("flex min-w-0 flex-1 flex-col gap-2", className)}
      role="group"
    >
      {!hideLabel ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-foreground">{t("Review skill")}</span>
          {pendingCount > 1 ? (
            <span className="ml-auto text-10px text-muted-foreground tabular-nums">
              1/{pendingCount}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        aria-label={t("Skill details")}
        className="flex min-w-0 flex-col gap-2.5"
        data-testid="skill-proposal"
      >
        <p className="min-w-0 text-base font-semibold leading-5 text-foreground">
          {name || t("A change to a skill")}
          {details.team || details.personal ? (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {details.team ? t("Team") : t("Yours")}
            </span>
          ) : null}
        </p>
        {details.description ? (
          <p className="min-w-0 text-sm leading-5 text-foreground/90">{details.description}</p>
        ) : null}
        {details.reason ? (
          <p className="min-w-0 text-11px text-muted-foreground">
            {t("Why: {reason}", { reason: details.reason })}
          </p>
        ) : null}
        {details.instructions ? (
          <div className="min-w-0">
            <p className="text-11px font-medium text-muted-foreground">{t("Instructions")}</p>
            <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90">
              {details.instructions}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The instructions a bot proposes for itself with bot_update; null for any other approval. */
export function proposedInstructions(
  approval: Pick<PendingApproval, "toolName" | "args">,
): string | null {
  return approval.toolName === "bot_update" &&
    Predicate.isObject(approval.args) &&
    Predicate.isString(approval.args.instructions)
    ? approval.args.instructions
    : null;
}

function InstructionsProposal({
  instructions,
  className,
  label,
}: {
  instructions: string;
  className: string | undefined;
  label: string;
}) {
  const { t } = useI18n();

  return (
    <div
      aria-label={label}
      className={cn("flex min-w-0 flex-1 flex-col gap-2", className)}
      data-testid="instructions-proposal"
      role="group"
    >
      <p className="min-w-0 text-11px text-muted-foreground">
        {t("Replaces the bot's instructions for every chat.")}
      </p>
      <p
        className="max-h-60 min-w-0 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        tabIndex={0}
      >
        {instructions}
      </p>
    </div>
  );
}

/** The brief a bot hands another bot: the goal, what done looks like and any context. */
export function delegateProposalDetails(args: PendingApproval["args"]) {
  const record = Predicate.isObject(args) ? args : {};

  const text = (key: string) =>
    key in record && Predicate.isString(record[key]) ? record[key].trim() : "";

  return {
    botId: text("botId"),
    task: text("task"),
    expectedResult: text("expectedResult"),
    context: text("context"),
  };
}

function DelegateProposal({
  args,
  className,
  label,
}: {
  args: PendingApproval["args"];
  className: string | undefined;
  label: string;
}) {
  const { t } = useI18n();
  const details = delegateProposalDetails(args);

  return (
    <div
      aria-label={label}
      className={cn("flex min-w-0 flex-1 flex-col gap-2.5", className)}
      data-testid="delegate-proposal"
      role="group"
    >
      {details.task ? (
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90">
          {details.task}
        </p>
      ) : null}
      {details.expectedResult ? (
        <div className="min-w-0">
          <p className="text-11px font-medium text-muted-foreground">{t("Done when")}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/90">
            {details.expectedResult}
          </p>
        </div>
      ) : null}
      {details.context ? (
        <p className="min-w-0 text-11px text-muted-foreground">
          {t("Context: {context}", { context: details.context })}
        </p>
      ) : null}
    </div>
  );
}

/** A named tool's own arguments, one "name: value" line each, instead of a generic prompt. */
function toolArgumentLines(args: PendingApproval["args"]): string | null {
  if (!Predicate.isObject(args)) return null;

  const lines = Object.entries(args).flatMap(([key, value]) =>
    (Predicate.isString(value) && value.trim()) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value)
      ? [`${key}: ${String(value).trim()}`]
      : [],
  );

  return lines.length > 0 ? lines.join("\n") : null;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
  hideLabel = false,
}: ComposerPendingApprovalPanelProps) {
  const { t, plural } = useI18n();
  const isRoutine = approval.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME;

  const fallbackLabel = isRoutine
    ? t("Routine approval")
    : approval.requestKind === "mcp-elicitation"
      ? t("App access approval")
      : approval.requestKind === "command"
        ? t("Command approval")
        : approval.requestKind === "file-read"
          ? t("File read approval")
          : t("File change approval");

  const detailAriaLabel = isRoutine
    ? t("Routine details")
    : approval.requestKind === "mcp-elicitation"
      ? t("App access request")
      : approval.requestKind === "command"
        ? t("Command")
        : approval.requestKind === "file-read"
          ? t("File to read")
          : t("File change");

  const argsCommand =
    approval.requestKind === "command" &&
    approval.args &&
    Predicate.isObjectOrArray(approval.args) &&
    "command" in approval.args &&
    Predicate.isString(approval.args.command)
      ? approval.args.command
      : null;

  const argsMessage =
    approval.args &&
    Predicate.isObject(approval.args) &&
    "message" in approval.args &&
    Predicate.isString(approval.args.message)
      ? approval.args.message
      : null;

  // A named tool call is a command only when it carries one; otherwise its
  // detail is the request, not something to run in a shell.
  const command =
    approval.requestKind === "command" && (argsCommand !== null || !approval.toolName)
      ? (argsCommand ?? (approval.detail?.trim() ? approval.detail : fallbackLabel))
      : null;

  // A named tool shows what it would do with its own arguments, never the generic
  // "Approve this action with …" prompt the server sends with it.
  const namedTool = approval.requestKind === "command" && approval.toolName !== undefined;

  const detail =
    command ??
    argsMessage ??
    (namedTool ? toolArgumentLines(approval.args) : null) ??
    (namedTool ? null : (approval.detail ?? fallbackLabel));

  const details = command ? describeCommandApproval(command, approval.args) : null;
  const firstLine = detail?.split("\n", 1)[0] ?? "";
  const detailLineCount = detail?.split("\n").length ?? 0;
  // Only hide detail behind a disclosure when there is more than one screenful
  // of it. A one-line path behind "Expand" wastes a click.
  const detailFitsInline = detailLineCount <= 4 && (detail?.length ?? 0) <= 400;

  if (approval.toolName === "skill_create" || approval.toolName === "skill_update") {
    return (
      <SkillProposal
        args={approval.args}
        className={className}
        hideLabel={hideLabel}
        label={t("Skill approval")}
        pendingCount={pendingCount}
      />
    );
  }

  const instructions = proposedInstructions(approval);

  if (instructions !== null) {
    return (
      <InstructionsProposal
        instructions={instructions}
        className={className}
        label={t("Instructions approval")}
      />
    );
  }

  if (approval.toolName === "delegate") {
    return <DelegateProposal args={approval.args} className={className} label={fallbackLabel} />;
  }

  if (isRoutine) {
    return (
      <RoutineProposal
        args={approval.args}
        className={className}
        hideLabel={hideLabel}
        label={fallbackLabel}
        pendingCount={pendingCount}
      />
    );
  }

  return (
    <div
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}
      role="group"
    >
      {!hideLabel ? (
        <div className="flex w-full min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-foreground">{fallbackLabel}</span>
          {approval.appName ? (
            <span className="max-w-32 shrink truncate text-11px text-muted-foreground">
              {approval.appName}
            </span>
          ) : null}
          {pendingCount > 1 ? (
            <span className="ml-auto shrink-0 text-10px font-medium text-muted-foreground tabular-nums">
              1/{pendingCount}
            </span>
          ) : null}
        </div>
      ) : null}
      {command ? (
        <>
          <div
            aria-label={detailAriaLabel}
            className={cn("flex min-w-0 items-start gap-2", DETAIL_SURFACE_CLASS_NAME)}
            role="region"
          >
            <CommandGlyph />
            <code
              className="block max-h-28 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/90 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
              data-approval-detail="complete"
              tabIndex={0}
            >
              {command}
            </code>
          </div>
          {details && (details.signals.length > 0 || details.workingDirectory || details.reason) ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
              {details.signals.map((signal) => (
                <span
                  className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-10px font-medium text-muted-foreground"
                  key={signal}
                >
                  {commandSignalLabel(signal, t)}
                </span>
              ))}
              {details.workingDirectory ? (
                <span className="min-w-0 truncate font-mono text-11px text-muted-foreground">
                  {details.workingDirectory}
                </span>
              ) : null}
              {details.reason ? (
                <span className="min-w-0 truncate text-11px text-muted-foreground">
                  {details.reason}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : detail === null ? null : detailFitsInline ? (
        <div className={cn("flex min-w-0 flex-col", DETAIL_SURFACE_CLASS_NAME)}>
          <code
            aria-label={detailAriaLabel}
            className={cn(
              "block min-w-0 whitespace-pre-wrap break-words leading-5 text-foreground/90",
              argsMessage ? "font-sans text-sm" : "font-mono text-xs",
            )}
            data-approval-detail="complete"
          >
            {detail}
          </code>
        </div>
      ) : (
        <details className="group w-full min-w-0">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-2 marker:content-none",
              DETAIL_SURFACE_CLASS_NAME,
            )}
          >
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
              {firstLine}
            </code>
            <span className="shrink-0 text-11px text-muted-foreground group-open:hidden">
              {plural(detailLineCount, { one: "{count} line", other: "{count} lines" })}
            </span>
            <span className="hidden shrink-0 text-11px text-muted-foreground group-open:inline">
              {t("Collapse")}
            </span>
          </summary>
          <div className="mt-1.5 flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
            <code
              aria-label={detailAriaLabel}
              className="block max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-foreground/90 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
              data-approval-detail="complete"
              tabIndex={0}
            >
              {detail}
            </code>
          </div>
        </details>
      )}
    </div>
  );
});
