import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationTask, OttoDelegationRecord } from "@otto/contracts";
import { BotId, TaskId, ThreadId } from "@otto/contracts";

import { nowContext } from "./now-context.ts";

const juno = BotId.make("bot-juno");

const mina = BotId.make("bot-mina");

const thread = ThreadId.make("thread-1");

const task = (
  title: string,
  status: OrchestrationTask["status"],
  dueDate: string | null,
  botId = juno,
) => ({
  id: TaskId.make(`task-${title}`),
  title,
  status,
  dueDate,
  assignees: [{ kind: "bot" as const, botId }],
});

const delegation = (tag: OttoDelegationRecord["phase"]["_tag"], parentThreadId = thread) => ({
  parentThreadId,
  childBotId: mina,
  task: "Summarize the logs",
  phase: { _tag: tag },
});

const routine = (job: string, nextRunAt: string | null, targetThreadId = thread) => ({
  job,
  targetThreadId,
  enabled: true,
  deletedAt: null,
  nextRunAt,
});

const empty = {
  threadId: thread,
  botId: juno,
  tasks: [],
  delegations: [],
  routines: [],
  bots: [{ id: mina, name: "Mina" }],
  pendingApprovals: false,
  timeZone: "UTC",
};

describe("nowContext", () => {
  it("is empty when nothing is going on", () => {
    expect(nowContext(empty)).toBe("");
  });

  it("lists the bot's open tasks, this chat's helpers and routines, and waiting approvals", () => {
    const text = nowContext({
      ...empty,
      tasks: [
        task("Later", "pending", null),
        task("Soon", "in_progress", "2026-10-20"),
        task("Done", "completed", "2026-10-01"),
        task("Mina's", "pending", "2026-10-01", mina),
      ],
      delegations: [
        delegation("Running"),
        delegation("Completed"),
        delegation("Running", ThreadId.make("other")),
      ],
      routines: [
        routine("Post the standup", "2026-10-19T09:00:00.000Z"),
        routine("Elsewhere", "2026-10-19T09:00:00.000Z", ThreadId.make("other")),
        routine("Paused", null),
      ],
      pendingApprovals: true,
    });

    expect(text).toBe(
      [
        "<now>",
        "Your open tasks:",
        "- Soon (in progress, due 2026-10-20, taskId task-Soon)",
        "- Later (pending, taskId task-Later)",
        "Bots working for this chat:",
        "- Mina: Summarize the logs (running)",
        "Routines that post here:",
        "- Post the standup (next Oct 19, 09:00)",
        "Something in this chat is waiting for a person's approval.",
        "</now>",
      ].join("\n"),
    );
  });
});
