import { assert, it } from "@effect/vitest";
import { RoutineId, RoutineRunId, ThreadId } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import { RoutineRepository } from "./repository.ts";
import { RoutineRepositoryLive } from "./repository-live.ts";

const layer = RoutineRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.layer(layer)("RoutineRepository.listThreadRuns", (it) => {
  it.effect("bounds each page and reaches older runs from deleted routines", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* RoutineRepository;
      const threadId = ThreadId.make("paged-routine-thread");
      const otherThreadId = ThreadId.make("other-routine-thread");

      for (const [routineId, targetThreadId, lifecycle] of [
        ["paged-routine", threadId, "deleted"],
        ["other-routine", otherThreadId, "enabled"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_routines (
            routine_id, bot_id, target_thread_id, project_id, job, procedure,
            procedure_version, schedule_json, timezone, sandbox, approval_policy,
            lifecycle, created_at, updated_at
          ) VALUES (
            ${routineId}, 'bot-1', ${targetThreadId}, 'project-1', 'Daily note', 'Write a note',
            1, '{"kind":"daily","time":"09:00"}', 'UTC', 'local', 'approval-required',
            ${lifecycle}, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
          )
        `;
      }

      for (let index = 0; index < 151; index++) {
        const runId = `paged-run-${String(index).padStart(3, "0")}`;
        const createdAt = new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString();
        yield* sql`
          INSERT INTO projection_routine_runs (
            run_id, routine_id, procedure_version, trigger, status, created_at, updated_at
          ) VALUES (${runId}, 'paged-routine', 1, 'manual', 'completed', ${createdAt}, ${createdAt})
        `;
      }

      yield* sql`
        INSERT INTO projection_routine_runs (
          run_id, routine_id, procedure_version, trigger, status, created_at, updated_at
        ) VALUES (
          'other-run', 'other-routine', 1, 'manual', 'completed',
          '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'
        )
      `;

      const first = yield* repository.listThreadRuns(threadId);
      assert.equal(first.runs.length, 100);
      assert.equal(first.runs[0]?.id, RoutineRunId.make("paged-run-150"));
      assert.equal(first.nextCursor, RoutineRunId.make("paged-run-051"));
      const second = yield* repository.listThreadRuns(threadId, first.nextCursor!);
      assert.equal(second.runs.length, 51);
      assert.equal(second.runs.at(-1)?.id, RoutineRunId.make("paged-run-000"));
      assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.runs, ...second.runs].map((run) => run.id)).size, 151);
    }),
  );
});

it.layer(layer)("RoutineRepository.getLatestThreadRef", (it) => {
  it.effect("returns the chat of the newest run that has one", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* RoutineRepository;

      for (const [runId, threadRef, createdAt] of [
        ["latest-run-1", "routine-chat-old", "2026-09-01T00:00:00.000Z"],
        ["latest-run-2", "routine-chat-new", "2026-09-02T00:00:00.000Z"],
        ["latest-run-3", null, "2026-09-03T00:00:00.000Z"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_routine_runs (
            run_id, routine_id, procedure_version, trigger, status, thread_ref, created_at,
            updated_at
          ) VALUES (
            ${runId}, 'latest-routine', 1, 'manual', 'completed', ${threadRef}, ${createdAt},
            ${createdAt}
          )
        `;
      }

      assert.equal(
        yield* repository.getLatestThreadRef(RoutineId.make("latest-routine")),
        ThreadId.make("routine-chat-new"),
      );
      assert.isNull(yield* repository.getLatestThreadRef(RoutineId.make("no-runs")));
    }),
  );
});

it.layer(layer)("RoutineRepository run history", (it) => {
  it.effect("keeps every open run beside each routine's newest runs, newest first", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* RoutineRepository;

      for (let index = 0; index < 8; index++) {
        const createdAt = new Date(Date.UTC(2026, 8, 1, index)).toISOString();
        const status = index === 0 ? "running" : "completed";
        const scheduledFor = index % 2 === 0 ? createdAt : null;
        const trigger = scheduledFor === null ? "manual" : "scheduled";
        yield* sql`
          INSERT INTO projection_routine_runs (
            run_id, routine_id, procedure_version, trigger, scheduled_for, status, created_at,
            updated_at
          ) VALUES (
            ${`history-run-${index}`}, 'history-routine', 1, ${trigger}, ${scheduledFor}, ${status},
            ${createdAt}, ${createdAt}
          )
        `;
      }

      const loaded = (yield* repository.listAllRuns)
        .filter((run) => run.routineId === "history-routine")
        .map((run) => run.id);

      assert.isTrue(loaded.includes(RoutineRunId.make("history-run-0")));
      assert.lengthOf(loaded, 6);

      const history = yield* repository.listRuns(RoutineId.make("history-routine"));
      assert.deepEqual(
        history.slice(0, 3).map((run) => run.id),
        ["history-run-7", "history-run-6", "history-run-5"],
      );
    }),
  );
});

it.layer(layer)("RoutineRepository app routines", (it) => {
  it.effect("reads a routine's app trigger and keeps an app run's event with its claim", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* RoutineRepository;

      const trigger = {
        type: "app",
        app: "gmail",
        event: "GMAIL_NEW_GMAIL_MESSAGE",
        title: "New Gmail message",
        connectionId: "gmail-ana",
        config: {},
        triggerId: "trigger-1",
      } as const;

      for (const [routineId, triggerJson] of [
        ["app-routine", JSON.stringify(trigger)],
        ["schedule-routine", null],
      ] as const) {
        yield* sql`
          INSERT INTO projection_routines (
            routine_id, bot_id, target_thread_id, project_id, job, procedure,
            procedure_version, schedule_json, timezone, trigger_json, sandbox, approval_policy,
            lifecycle, created_at, updated_at
          ) VALUES (
            ${routineId}, 'bot-1', 'thread-1', 'project-1', 'Triage', 'File invoices',
            1, '{"kind":"daily","time":"09:00"}', 'UTC', ${triggerJson}, 'local',
            'approval-required', 'enabled', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
          )
        `;
      }

      assert.deepEqual(
        (yield* repository.getById(RoutineId.make("app-routine")))?.trigger,
        trigger,
      );
      assert.deepEqual((yield* repository.getById(RoutineId.make("schedule-routine")))?.trigger, {
        type: "schedule",
      });

      const claim = {
        runId: RoutineRunId.make("routine:app-routine:app:msg_1"),
        routineId: RoutineId.make("app-routine"),
        trigger: "app" as const,
        scheduledFor: null,
        claimedAt: "2026-09-01T00:00:00.000Z",
        event: { id: "msg_1", data: { subject: "Invoice" } },
      };

      assert.isTrue(yield* repository.claim(claim));
      assert.isFalse(yield* repository.claim(claim));

      const recoverable = (yield* repository.listRecoverable).find(
        (candidate) => candidate.runId === claim.runId,
      );

      assert.deepEqual(recoverable?.event, claim.event);
    }),
  );
});
