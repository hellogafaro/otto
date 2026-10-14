import { decodeRoutine, decodeRoutineRun } from "../test-support/fixtures";
import { createTranslator } from "@otto/client-runtime/i18n";
import { RoutineId, ThreadId, type OrchestrationMessage, type RoutineRun } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildBotConversationEntries } from "./botConversationPresentation";
import {
  deriveRoutineReceipts,
  mergeBotConversationTimeline,
  mergeRoutineRunHistory,
} from "./routineReceipts";

const routine = decodeRoutine({
  id: RoutineId.make("routine-1"),
  botId: "bot-1",
  targetThreadId: ThreadId.make("thread-1"),
  projectId: "project-1",
  job: "Daily digest",
  procedure: "Summarize the workspace",
  procedureVersion: 1,
  approvalVersion: 1,
  schedule: { kind: "daily", time: "09:00" },
  timezone: "America/New_York",
  skillAssignmentIds: [],
  connectorDependencies: [],
  sandbox: "local",
  approvalPolicy: "auto",
  delegateToBotId: null,
  enabled: true,
  lifecycle: "enabled",
  nextRunAt: null,
  lastRunAt: null,
  latestResult: null,
  latestFailure: null,
  createdAt: "2026-09-19T08:00:00.000Z",
  updatedAt: "2026-09-19T08:05:00.000Z",
  deletedAt: null,
});

const run = decodeRoutineRun({
  id: "run-1",
  routineId: routine.id,
  trigger: "scheduled",
  scheduledFor: "2026-09-19T09:00:00.000Z",
  procedureVersion: 1,
  status: "completed",
  threadRef: routine.targetThreadId,
  result: { summary: "2 files changed" },
  failure: null,
  usageRef: null,
  startedAt: "2026-09-19T09:00:00.000Z",
  completedAt: "2026-09-19T09:01:00.000Z",
  createdAt: "2026-09-19T09:00:00.000Z",
  updatedAt: "2026-09-19T09:01:00.000Z",
});

describe("deriveRoutineReceipts", () => {
  it("restarts a speaker group after an intervening routine note", () => {
    const messages = [
      { id: "message-1", role: "assistant", createdAt: "2026-09-19T09:00:00.000Z" },
      { id: "message-2", role: "assistant", createdAt: "2026-09-19T09:02:00.000Z" },
    ] as OrchestrationMessage[];

    const entries = buildBotConversationEntries(messages, new Date("2026-09-19T09:02:00.000Z"));
    expect(entries[1]?.startsGroup).toBe(false);

    const timeline = mergeBotConversationTimeline(entries, [
      {
        id: "receipt-1",
        createdAt: "2026-09-19T09:01:00.000Z",
        settledAt: "2026-09-19T09:01:00.000Z",
        routineId: routine.id,
        title: "Daily digest",
        status: "completed",
        text: "“Daily digest” finished",
      },
    ]);

    expect(timeline.map((item) => item.kind)).toEqual(["message", "receipt", "message"]);
    expect(timeline[2]?.kind === "message" && timeline[2].entry.startsGroup).toBe(true);
  });

  it("retains older persisted runs while applying current shell updates", () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      ...run,
      id: `run-${index}`,
    })) as RoutineRun[];

    const latest = { ...history[5]!, status: "failed" as const };
    const merged = mergeRoutineRunHistory(history, [latest]);
    expect(merged).toHaveLength(6);
    expect(merged[0]?.id).toBe("run-0");
    expect(merged[5]?.status).toBe("failed");
  });

  it("keeps creation and run notes for a deleted routine's compact receipt source", () => {
    const receiptSource = {
      id: routine.id,
      targetThreadId: routine.targetThreadId,
      job: routine.job,
      createdAt: routine.createdAt,
    };

    const archived = deriveRoutineReceipts(routine.targetThreadId, [receiptSource], [run]);
    const active = deriveRoutineReceipts(routine.targetThreadId, [routine], [run]);
    expect(archived.map(({ archived: _archived, ...receipt }) => receipt)).toEqual(active);
    expect(archived.every((receipt) => receipt.archived)).toBe(true);
  });

  it("derives one card for the routine and one per run, settled at its latest status", () => {
    expect(deriveRoutineReceipts(routine.targetThreadId, [routine], [run])).toEqual([
      {
        id: "routine-created:routine-1",
        createdAt: "2026-09-19T08:00:00.000Z",
        settledAt: "2026-09-19T08:00:00.000Z",
        routineId: "routine-1",
        title: "Daily digest",
        status: "created",
        text: "Routine “Daily digest” was created",
      },
      {
        id: "routine-run:run-1",
        createdAt: "2026-09-19T09:00:00.000Z",
        settledAt: "2026-09-19T09:01:00.000Z",
        routineId: "routine-1",
        title: "Daily digest",
        status: "completed",
        text: "“Daily digest” finished: 2 files changed",
      },
    ]);
  });

  it("shows a running card while a run is in flight", () => {
    const running = decodeRoutineRun({
      ...run,
      id: "run-2",
      status: "running",
      result: null,
      completedAt: null,
      updatedAt: "2026-09-19T09:00:00.000Z",
    });

    const receipts = deriveRoutineReceipts(routine.targetThreadId, [routine], [running]);
    expect(receipts.map((receipt) => [receipt.id, receipt.status])).toEqual([
      ["routine-created:routine-1", "created"],
      ["routine-run:run-2", "running"],
    ]);
    expect(receipts[1]?.text).toBe("“Daily digest” started a run");
  });

  it("translates the receipt sentence and keeps the routine name and run text as written", () => {
    const i18n = createTranslator("zh-CN", {
      "Routine “{name}” was created": "已创建例行任务“{name}”",
      "“{name}” failed": "“{name}”失败",
      "{summary}: {detail}": "{summary}：{detail}",
    });

    const failed = decodeRoutineRun({
      ...run,
      id: "run-9",
      routineId: routine.id,
      status: "failed",
      createdAt: "2026-09-19T09:00:00.000Z",
      startedAt: "2026-09-19T09:00:00.000Z",
      completedAt: "2026-09-19T09:05:00.000Z",
      updatedAt: "2026-09-19T09:05:00.000Z",
      failure: { kind: "workspace", message: "The workspace is missing" },
      result: null,
    });

    const receipts = deriveRoutineReceipts(routine.targetThreadId, [routine], [failed], i18n);
    expect(receipts.map((receipt) => receipt.text)).toEqual([
      "已创建例行任务“Daily digest”",
      "“Daily digest”失败：The workspace is missing",
    ]);
  });

  it("reports a failed run with its failure message", () => {
    const failed = decodeRoutineRun({
      ...run,
      id: "run-6",
      status: "failed",
      result: null,
      failure: { kind: "workspace", message: "The workspace is missing" },
      completedAt: "2026-09-19T09:02:00.000Z",
    });

    const receipts = deriveRoutineReceipts(routine.targetThreadId, [routine], [failed]);
    expect(receipts[1]).toMatchObject({
      text: "“Daily digest” failed: The workspace is missing",
      status: "failed",
      detail: "The workspace is missing",
    });
  });

  it("drops a server stack stored with a failed run", () => {
    const failed = decodeRoutineRun({
      ...run,
      id: "run-7",
      status: "failed",
      result: null,
      failure: {
        kind: "workspace",
        message:
          "Error: The workspace is missing\n    at readWorkspace (file:///srv/otto/server.ts:1:2)",
      },
      completedAt: "2026-09-19T09:02:00.000Z",
    });

    const receipts = deriveRoutineReceipts(routine.targetThreadId, [routine], [failed]);
    expect(receipts[1]?.detail).toBe("The workspace is missing");
  });

  it("keeps queued and waiting runs out of chat and shows canceled runs as canceled", () => {
    const queued = decodeRoutineRun({
      ...run,
      id: "run-3",
      status: "queued",
      result: null,
      startedAt: null,
      completedAt: null,
    });

    const waiting = decodeRoutineRun({
      ...run,
      id: "run-4",
      status: "waiting-for-approval",
      result: null,
      startedAt: null,
      completedAt: null,
    });

    const canceled = decodeRoutineRun({
      ...run,
      id: "run-5",
      status: "canceled",
      result: null,
      completedAt: "2026-09-19T09:02:00.000Z",
    });

    const receipts = deriveRoutineReceipts(
      routine.targetThreadId,
      [routine],
      [queued, waiting, canceled],
    );

    expect(receipts.map((receipt) => [receipt.id, receipt.status])).toEqual([
      ["routine-created:routine-1", "created"],
      ["routine-run:run-5", "canceled"],
    ]);
    expect(receipts[1]?.text).toBe("“Daily digest” was canceled");
  });
});
