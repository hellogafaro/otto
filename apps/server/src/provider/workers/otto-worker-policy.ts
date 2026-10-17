import {
  OttoWorkerId,
  type OttoDelegationAccessGrant,
  type OttoToolId,
  type OttoToolInputSchemas,
  type OttoWorkerPhase,
  type OttoWorkerStatus,
  type ThreadId,
  type TurnId,
} from "@otto/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export class OttoWorkerError extends Schema.TaggedErrorClass<OttoWorkerError>()("OttoWorkerError", {
  reason: Schema.Literals([
    "depth_limit",
    "concurrency_limit",
    "not_found",
    "not_running",
    "start_failed",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** The bot turn that calls Task. Worker threads report depth 1. */
export interface OttoWorkerParent {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly depth: number;
  readonly access: OttoDelegationAccessGrant;
}

export interface OttoWorkerChildSpec {
  readonly parentThreadId: ThreadId;
  readonly workerId: OttoWorkerId;
  readonly title: string;
}

export interface OttoWorkerChildOutcome {
  readonly state: "completed" | "failed";
  readonly summary?: string;
  readonly error?: string;
}

/**
 * Orchestration side effects. `createChild` only creates the hidden thread; the
 * runtime registers it before `messageChild` starts a turn, so the child
 * session always starts with the worker grant. `discardChild` removes a child
 * whose first turn never started, so no orphaned hidden thread remains.
 */
export interface OttoWorkerPort {
  readonly createChild: (spec: OttoWorkerChildSpec) => Effect.Effect<ThreadId, OttoWorkerError>;
  readonly messageChild: (
    childThreadId: ThreadId,
    text: string,
  ) => Effect.Effect<void, OttoWorkerError>;
  readonly interruptChild: (childThreadId: ThreadId) => Effect.Effect<void>;
  readonly discardChild: (childThreadId: ThreadId) => Effect.Effect<void>;
}

export interface OttoWorkerRuntimeOptions {
  readonly maxDepth?: number;
  readonly maxConcurrency?: number;
  readonly timeout?: Duration.Duration;
  readonly makeId?: () => string;
}

/**
 * Tools a worker never receives. Workers do bounded work for one turn, so they
 * cannot start workers, delegate to bots, reach the user, or change bot and
 * channel state.
 */
export const OTTO_WORKER_EXCLUDED_TOOL_IDS: ReadonlySet<OttoToolId> = new Set([
  "Task",
  "CheckSubagent",
  "MessageSubagent",
  "StopSubagent",
  "CreateAgent",
  "CheckAgent",
  "MessageAgent",
  "StopAgent",
  "SendToAgent",
  "SendToUser",
  "ReactToMessage",
  "UpdateBotProfile",
  "SaveToLibrary",
  "UpdateLibraryDocument",
]);

/**
 * A worker runs in a hidden thread where nobody can answer an approval prompt.
 * The `none` ceiling makes approval-gated tools fail fast instead of waiting.
 * The worker keeps the parent's sandbox. Callers pass a top-level bot's local
 * workspace as an explicit `local` sandbox, because a null sandbox on a
 * delegated grant means no workspace at all.
 */
/** Worker chats use this id prefix, so they stay recognizable after a server restart. */
export const WORKER_THREAD_ID_PREFIX = "worker-thread-";

export const isWorkerThreadId = (threadId: ThreadId): boolean =>
  String(threadId).startsWith(WORKER_THREAD_ID_PREFIX);

export function workerAccess(parent: OttoDelegationAccessGrant): OttoDelegationAccessGrant {
  return {
    ...parent,
    allowedToolIds: parent.allowedToolIds.filter(
      (toolId) => !OTTO_WORKER_EXCLUDED_TOOL_IDS.has(toolId),
    ),
    memoryScopes: [],
    hasUserComputer: false,
    approvalCeiling: "none",
  };
}

export function workerInstructions(input: (typeof OttoToolInputSchemas.Task)["Type"]): string {
  return [
    "You are a temporary worker started by a bot for one bounded subtask.",
    `Task: ${input.task}`,
    ...(input.expectedResult ? [`Expected result: ${input.expectedResult}`] : []),
    "Do only this task. End with a concise final result, or a concrete blocker.",
  ].join("\n");
}

export function workerTitle(task: string): string {
  const firstLine = task.split("\n", 1)[0]!.trim();

  return `Worker: ${firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine}`;
}

export interface WorkerEntry {
  readonly workerId: OttoWorkerId;
  readonly parentThreadId: ThreadId;
  readonly parentTurnId: TurnId;
  readonly task: string;
  readonly phase: Ref.Ref<OttoWorkerPhase>;
  readonly done: Deferred.Deferred<OttoWorkerStatus>;
  readonly outcomes: Queue.Queue<OttoWorkerChildOutcome>;
  /** Child turns dispatched but not yet finished: the first task plus each follow-up. */
  readonly openTurns: Ref.Ref<number>;
  readonly access: OttoDelegationAccessGrant;
  fiber: Fiber.Fiber<void> | undefined;
}

export const childThreadOf = (phase: OttoWorkerPhase): ThreadId | null => phase.childThreadId;
