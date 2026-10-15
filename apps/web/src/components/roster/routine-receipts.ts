import { createTranslator } from "@otto/client-runtime/i18n";
import { Match } from "effect";
import { withoutErrorStack } from "@otto/shared/errorText";
import type {
  Routine,
  RoutineId,
  RoutineReceiptSource,
  RoutineRun,
  ThreadId,
} from "@otto/contracts";
import type { BotConversationEntry } from "./bot-conversation-presentation";

export type RoutineReceiptStatus = "created" | "running" | "completed" | "failed" | "canceled";

/** A routine's creation or one of its runs, shown as one card in the routine's chat. */
export interface RoutineReceipt {
  readonly id: string;
  /** When the card enters the timeline: the routine's creation or the run's start. */
  readonly createdAt: string;
  /** When the card reached its current status. */
  readonly settledAt: string;
  readonly routineId: RoutineId;
  readonly title: string;
  readonly status: RoutineReceiptStatus;
  /** The whole note as one sentence, for screen readers. */
  readonly text: string;
  /** Why a run failed. */
  readonly detail?: string;
  readonly archived?: true;
}

export function mergeBotConversationTimeline(
  entries: ReadonlyArray<BotConversationEntry>,
  receipts: ReadonlyArray<RoutineReceipt>,
) {
  const sorted = [
    ...entries.map((entry, index) => ({
      kind: "message" as const,
      createdAt: entry.message.createdAt,
      entry,
      index,
    })),
    ...receipts.map((receipt) => ({
      kind: "receipt" as const,
      createdAt: receipt.createdAt,
      receipt,
    })),
  ].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

  return sorted.map((item, index) =>
    item.kind === "message" && sorted[index - 1]?.kind === "receipt"
      ? { ...item, entry: { ...item.entry, startsGroup: true } }
      : item,
  );
}

type ReceiptTranslator = Pick<ReturnType<typeof createTranslator>, "t">;

export function mergeRoutineRunHistory(
  history: ReadonlyArray<RoutineRun>,
  recent: ReadonlyArray<RoutineRun>,
): RoutineRun[] {
  return [...new Map([...history, ...recent].map((run) => [run.id, run])).values()];
}

const englishTranslator: ReceiptTranslator = createTranslator("en");

/** Routine and run text stay as written; only the sentence around them is translated. */
export function deriveRoutineReceipts(
  threadId: ThreadId,
  routines: ReadonlyArray<Routine | RoutineReceiptSource>,
  runs: ReadonlyArray<RoutineRun>,
  { t }: ReceiptTranslator = englishTranslator,
): RoutineReceipt[] {
  const withDetail = (summary: string, detail: string | undefined) =>
    detail ? t("{summary}: {detail}", { summary, detail }) : summary;

  const threadRoutines = routines.filter((routine) => routine.targetThreadId === threadId);
  const byRoutineId = new Map(threadRoutines.map((routine) => [routine.id, routine]));

  const isArchived = (routine: Routine | RoutineReceiptSource) =>
    !("deletedAt" in routine) || routine.deletedAt !== null;

  const receipts: RoutineReceipt[] = [];

  for (const routine of threadRoutines) {
    receipts.push({
      id: `routine-created:${routine.id}`,
      createdAt: routine.createdAt,
      settledAt: routine.createdAt,
      routineId: routine.id,
      title: routine.job,
      status: "created",
      text: t("Routine “{name}” was created", { name: routine.job }),
      ...(isArchived(routine) ? { archived: true } : {}),
    });
  }

  for (const run of runs) {
    const routine = byRoutineId.get(run.routineId);

    // Queued and waiting runs have not started; the routine page lists them, the chat waits.
    if (!routine || run.startedAt === null) continue;
    const name = routine.job;
    const settledAt = run.completedAt ?? run.updatedAt;

    const note = Match.value(run.status).pipe(
      Match.when("completed", () => ({
        status: "completed" as const,
        settledAt,
        text: withDetail(t("“{name}” finished", { name }), run.result?.summary.trim()),
      })),
      Match.when(Match.is("failed", "blocked"), () => {
        const detail = run.failure
          ? withoutErrorStack(run.failure.message)
              .trim()
              .replace(/[.:。：]$/, "")
          : "";

        return {
          status: "failed" as const,
          settledAt,
          text: withDetail(t("“{name}” failed", { name }), detail),
          ...(detail ? { detail } : {}),
        };
      }),
      Match.when("canceled", () => ({
        status: "canceled" as const,
        settledAt,
        text: t("“{name}” was canceled", { name }),
      })),
      Match.orElse(() => ({
        status: "running" as const,
        settledAt: run.startedAt ?? run.updatedAt,
        text: t("“{name}” started a run", { name }),
      })),
    );

    receipts.push({
      id: `routine-run:${run.id}`,
      createdAt: run.startedAt,
      routineId: routine.id,
      title: name,
      ...note,
      ...(isArchived(routine) ? { archived: true } : {}),
    });
  }

  return receipts.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}
