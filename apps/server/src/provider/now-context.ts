import type {
  BotId,
  OrchestrationBot,
  OrchestrationTask,
  OttoDelegationRecord,
  Routine,
  ThreadId,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const LIST_LIMIT = 10;

const TEXT_LIMIT = 120;

const OPEN_TASK = new Set<OrchestrationTask["status"]>(["backlog", "pending", "in_progress"]);

const short = (text: string) => {
  const line = text.trim().replace(/\s+/g, " ");

  return line.length > TEXT_LIMIT ? `${line.slice(0, TEXT_LIMIT)}…` : line;
};

const localTime = (iso: string, timeZone: string) => {
  const instant = DateTime.makeUnsafe(iso);

  const zoned = Option.getOrElse(DateTime.makeZoned(instant, { timeZone }), () =>
    DateTime.toUtc(instant),
  );

  return DateTime.format(zoned, {
    locale: "en-US",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
};

/**
 * Otto: what is going on for a bot right now, read fresh for every turn and never stored:
 * its open tasks, the bots working for this chat, the routines that post here and whether
 * anything here waits for an approval. Empty when there is nothing.
 */
export function nowContext(input: {
  readonly threadId: ThreadId;
  readonly botId: BotId;
  readonly tasks: ReadonlyArray<
    Pick<OrchestrationTask, "id" | "title" | "status" | "dueDate" | "assignees">
  >;
  readonly delegations: ReadonlyArray<
    Pick<OttoDelegationRecord, "parentThreadId" | "childBotId" | "task"> & {
      readonly phase: Pick<OttoDelegationRecord["phase"], "_tag">;
    }
  >;
  readonly routines: ReadonlyArray<
    Pick<Routine, "job" | "targetThreadId" | "enabled" | "deletedAt" | "nextRunAt">
  >;
  readonly bots: ReadonlyArray<Pick<OrchestrationBot, "id" | "name">>;
  readonly pendingApprovals: boolean;
  readonly timeZone: string;
}): string {
  const tasks = input.tasks
    .filter(
      (task) =>
        OPEN_TASK.has(task.status) &&
        task.assignees.some(
          (assignee) => assignee.kind === "bot" && assignee.botId === input.botId,
        ),
    )
    .toSorted((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, LIST_LIMIT)
    .map(
      (task) =>
        `- ${short(task.title)} (${task.status.replace("_", " ")}${task.dueDate ? `, due ${task.dueDate}` : ""}, taskId ${task.id})`,
    );

  const helpers = input.delegations
    .filter(
      (delegation) =>
        delegation.parentThreadId === input.threadId &&
        ["Queued", "Running", "Blocked"].includes(delegation.phase._tag),
    )
    .slice(0, LIST_LIMIT)
    .map((delegation) => {
      const name =
        input.bots.find((bot) => bot.id === delegation.childBotId)?.name ?? delegation.childBotId;

      return `- ${name}: ${short(delegation.task)} (${delegation.phase._tag.toLowerCase()})`;
    });

  const routines = input.routines
    .filter(
      (routine) =>
        routine.targetThreadId === input.threadId &&
        routine.enabled &&
        routine.deletedAt === null &&
        routine.nextRunAt !== null,
    )
    .toSorted((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))
    .slice(0, LIST_LIMIT)
    .map(
      (routine) =>
        `- ${short(routine.job)} (next ${localTime(routine.nextRunAt ?? "", input.timeZone)})`,
    );

  const lines = [
    ...(tasks.length > 0 ? ["Your open tasks:", ...tasks] : []),
    ...(helpers.length > 0 ? ["Bots working for this chat:", ...helpers] : []),
    ...(routines.length > 0 ? ["Routines that post here:", ...routines] : []),
    ...(input.pendingApprovals
      ? ["Something in this chat is waiting for a person's approval."]
      : []),
  ];

  return lines.length > 0 ? `<now>\n${lines.join("\n")}\n</now>` : "";
}
