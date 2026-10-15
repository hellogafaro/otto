import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./base-schemas.ts";

/** Workers run at depth 1 under a bot turn and cannot start workers of their own. */
export const OTTO_WORKER_MAX_DEPTH = 1;

/** Running workers one bot turn may own at the same time. */
export const OTTO_WORKER_MAX_CONCURRENCY = 3;

/** A worker that has not produced a result by this deadline fails with `timeout`. */
export const OTTO_WORKER_TIMEOUT_MS = 10 * 60 * 1000;

export const OTTO_WORKER_TASK_MAX_CHARS = 16_000;

export const OttoWorkerId = TrimmedNonEmptyString.pipe(Schema.brand("OttoWorkerId"));

export type OttoWorkerId = typeof OttoWorkerId.Type;

const WorkerText = TrimmedNonEmptyString.check(Schema.isMaxLength(OTTO_WORKER_TASK_MAX_CHARS));

export const OttoWorkerTaskInput = Schema.Struct({
  task: WorkerText,
  expectedResult: Schema.optional(WorkerText),
  /** Return immediately with a Running status instead of waiting for the result. */
  background: Schema.optional(Schema.Boolean),
});

export const OttoWorkerCheckInput = Schema.Struct({
  workerId: OttoWorkerId,
  /** Wait until the worker reaches a terminal state. */
  wait: Schema.optional(Schema.Boolean),
});

export const OttoWorkerMessageInput = Schema.Struct({
  workerId: OttoWorkerId,
  message: WorkerText,
});

export const OttoWorkerStopInput = Schema.Struct({ workerId: OttoWorkerId });

export const OttoWorkerFailureCode = Schema.Literals(["timeout", "worker_failed", "internal"]);

export type OttoWorkerFailureCode = typeof OttoWorkerFailureCode.Type;

export const OttoWorkerPhase = Schema.TaggedUnion({
  Running: {
    childThreadId: Schema.NullOr(ThreadId),
    startedAt: IsoDateTime,
  },
  Completed: {
    childThreadId: ThreadId,
    startedAt: IsoDateTime,
    completedAt: IsoDateTime,
    result: TrimmedNonEmptyString,
  },
  Failed: {
    childThreadId: Schema.NullOr(ThreadId),
    startedAt: IsoDateTime,
    completedAt: IsoDateTime,
    failureCode: OttoWorkerFailureCode,
    message: TrimmedNonEmptyString,
  },
  Canceled: {
    childThreadId: Schema.NullOr(ThreadId),
    startedAt: IsoDateTime,
    completedAt: IsoDateTime,
    canceledBy: Schema.Literals(["stop", "parent-turn-ended"]),
  },
});

export type OttoWorkerPhase = typeof OttoWorkerPhase.Type;

/** Result of Task, CheckSubagent, MessageSubagent, and StopSubagent. */
export const OttoWorkerStatus = Schema.Struct({
  workerId: OttoWorkerId,
  task: TrimmedNonEmptyString,
  phase: OttoWorkerPhase,
});

export type OttoWorkerStatus = typeof OttoWorkerStatus.Type;

export const isOttoWorkerTerminal = (phase: OttoWorkerPhase): boolean =>
  !Predicate.isTagged(phase, "Running");
