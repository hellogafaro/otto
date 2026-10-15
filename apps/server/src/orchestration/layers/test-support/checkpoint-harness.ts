import type { ActivityRecord } from "../../activity-payload-bounds.ts";
import { type OrchestrationReadModel, type OrchestrationEvent } from "@otto/contracts";
import { createObservationHistory } from "../../test-support/observations.ts";

interface CheckpointObservation {
  engine: OrchestrationEngineShape;
  readModel: () => Promise<OrchestrationReadModel>;
  drain: () => Promise<void>;
  waitForReceipt: (
    predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
  ) => Promise<OrchestrationRuntimeReceipt>;
}

import {
  normalizeFixtureEvent,
  type LegacyProviderRuntimeEvent,
} from "../../test-support/provider-fixture-events.ts";

export type {
  LegacyProviderRuntimeEvent,
  FixtureProviderRuntimeEvent,
} from "../../test-support/provider-fixture-events.ts";

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import {
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderInstanceId,
} from "@otto/contracts";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  TurnId,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";
import * as CheckpointStore from "../../../checkpointing/checkpoint-store.ts";
import * as VcsDriverRegistry from "../../../vcs/vcs-driver-registry.ts";
import * as VcsProcess from "../../../vcs/vcs-process.ts";
import * as GitVcsDriver from "../../../vcs/git-vcs-driver.ts";
import * as RepositoryIdentityResolver from "../../../project/repository-identity-resolver.ts";
import { CheckpointReactorLive } from "../checkpoint-reactor.ts";
import { OrchestrationEngineLive } from "../orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../projection-snapshot-query.ts";
import * as ThreadBackgroundLiveness from "../../thread-background-liveness.ts";
import * as ThreadPlanProgress from "../../thread-plan-progress.ts";
import { RuntimeReceiptBusTest } from "../runtime-receipt-bus.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../../services/runtime-receipt-bus.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/layers/orchestration-event-store.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/layers/orchestration-command-receipts.ts";
import { SqlitePersistenceMemory } from "../../../persistence/layers/sqlite.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../services/orchestration-engine.ts";
import { CheckpointReactor } from "../../services/checkpoint-reactor.ts";
import { ProjectionSnapshotQuery } from "../../services/projection-snapshot-query.ts";
import {
  AgentController,
  type AgentControllerShape,
} from "../../../provider/services/agent-controller.ts";
import { checkpointRefForThreadTurn } from "../../../checkpointing/utils.ts";
import { type AgentControllerError } from "../../../provider/errors.ts";
import { ServerConfig } from "../../../config.ts";
import * as WorkspaceEntries from "../../../workspace/workspace-entries.ts";
import * as WorkspacePaths from "../../../workspace/workspace-paths.ts";

export const asProjectId = (value: string): ProjectId => ProjectId.make(value);

export const asTurnId = (value: string): TurnId => TurnId.make(value);

export function createAgentControllerHarness(
  cwd: string,
  hasSession = true,
  sessionCwd = cwd,
  providerName: ProviderSession["provider"] = ProviderDriverKind.make("codex"),
) {
  const now = "2026-01-01T00:00:00.000Z";
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());

  const rollbackConversation = vi.fn(
    (_input: {
      readonly threadId: ThreadId;
      readonly numTurns: number;
    }): Effect.Effect<void, AgentControllerError> => Effect.void,
  );

  const unsupported = <A>() =>
    Effect.die(new Error("Unsupported provider call in test")) as Effect.Effect<A, never>;

  const listSessions = () =>
    hasSession
      ? Effect.succeed([
          {
            provider: providerName,
            status: "ready",
            runtimeMode: "full-access",
            threadId: ThreadId.make("thread-1"),
            cwd: sessionCwd,
            createdAt: now,
            updatedAt: now,
          },
        ] satisfies ReadonlyArray<ProviderSession>)
      : Effect.succeed([] as ReadonlyArray<ProviderSession>);

  const service: AgentControllerShape = {
    authenticateMcpServer: () => unsupported(),
    resolveEngine: () => unsupported(),
    inspectEngine: () => unsupported(),
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    signalTurn: () => Effect.succeed(false),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions,
    rollbackConversation,
    uploadFeedback: () => unsupported(),
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, normalizeFixtureEvent(event)));
  };

  const emitUnsafe = (event: ActivityRecord) => {
    // SAFETY: This boundary deliberately publishes an obsolete event to test rejection.
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as ProviderRuntimeEvent));
  };

  return {
    service,
    rollbackConversation,
    emitUnsafe,
    emit,
  };
}

export async function waitForThread(
  harness: CheckpointObservation,
  predicate: (thread: OrchestrationReadModel["threads"][number]) => boolean,
) {
  await harness.drain();

  const thread = (await harness.readModel()).threads.find(
    (thread) => thread.id === ThreadId.make("thread-1"),
  );

  if (!thread || !predicate(thread))
    throw new Error("Expected checkpoint thread state after drain");

  return thread;
}

export async function waitForEvent(
  harness: CheckpointObservation,
  predicate: (event: OrchestrationEvent) => boolean,
) {
  await harness.drain();

  const events = await Effect.runPromise(
    Stream.runCollect(harness.engine.readEvents(0)).pipe(
      Effect.map((events) => Array.from(events)),
    ),
  );

  if (!events.some(predicate)) throw new Error("Expected checkpoint event after drain");

  return events;
}

export function runGit(cwd: string, args: ReadonlyArray<string>) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

export function createGitRepository() {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ottoLegacy-checkpoint-handler-"));
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v1\n", "utf8");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);

  return cwd;
}

export function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);

    return true;
  } catch {
    return false;
  }
}

export function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

export async function waitForGitRefExists(
  harness: CheckpointObservation,
  cwd: string,
  ref: string,
) {
  if (!gitRefExists(cwd, ref))
    await harness.waitForReceipt(
      (receipt) => receipt.type !== "turn.processing.quiesced" && receipt.checkpointRef === ref,
    );

  if (!gitRefExists(cwd, ref)) throw new Error("Checkpoint receipt did not create " + ref);
}

export function createCheckpointHarness() {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | CheckpointReactor
    | CheckpointStore.CheckpointStore
    | ProjectionSnapshotQuery
    | RuntimeReceiptBus,
    unknown
  > | null = null;

  let scope: Scope.Closeable | null = null;

  const tempDirs: string[] = [];

  async function createHarness(options?: {
    readonly hasSession?: boolean;
    readonly seedFilesystemCheckpoints?: boolean;
    readonly initializeGit?: boolean;
    readonly projectWorkspaceRoot?: string;
    readonly threadWorktreePath?: string | null;
    readonly threadBranch?: string | null;
    readonly secondThreadSharingWorktree?: boolean;
    readonly localStatusRefName?: string | null;
    readonly providerSessionCwd?: string;
    readonly providerName?: ProviderDriverKind;
    readonly gitStatusRefreshCalls?: Array<string>;
    readonly gitStatusRefresh?: Effect.Effect<void>;
  }) {
    const cwd = createGitRepository();

    if (options?.initializeGit === false) {
      NodeFS.rmSync(NodePath.join(cwd, ".git"), { recursive: true });
    }

    tempDirs.push(cwd);

    const provider = createAgentControllerHarness(
      cwd,
      options?.hasSession ?? true,
      options?.providerSessionCwd ?? cwd,
      options?.providerName ?? ProviderDriverKind.make("codex"),
    );

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );

    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );

    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "ottoLegacy-checkpoint-reactor-test-",
    });

    const gitVcsDriverLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      statusDetailsLocal: (cwd: string) =>
        Effect.sync(() => {
          options?.gitStatusRefreshCalls?.push(cwd);
        }).pipe(
          Effect.andThen(options?.gitStatusRefresh ?? Effect.void),
          Effect.as({
            isRepo: true,
            hasOriginRemote: false,
            isDefaultBranch: true,
            branch: options?.localStatusRefName !== undefined ? options.localStatusRefName : "main",
            upstreamRef: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            aheadOfDefaultCount: 0,
          }),
        ),
    });

    const layer = CheckpointReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(RuntimeReceiptBusTest),
      Layer.provideMerge(Layer.succeed(AgentController, provider.service)),
      Layer.provideMerge(gitVcsDriverLayer),
      Layer.provideMerge(CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer))),
      Layer.provideMerge(
        WorkspaceEntries.layer.pipe(
          Layer.provide(WorkspacePaths.layer),
          Layer.provideMerge(VcsDriverRegistry.layer),
        ),
      ),
      Layer.provideMerge(WorkspacePaths.layer),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(CheckpointReactor));

    const checkpointStore = await runtime.runPromise(
      Effect.service(CheckpointStore.CheckpointStore),
    );

    const receiptBus = await runtime.runPromise(Effect.service(RuntimeReceiptBus));
    const testScope = await Effect.runPromise(Scope.make("sequential"));
    scope = testScope;
    const receiptHistory = createObservationHistory<OrchestrationRuntimeReceipt>();

    const receipts = await Effect.runPromise(
      Effect.gen(function* () {
        const receipts = yield* Queue.unbounded<OrchestrationRuntimeReceipt>();

        const receiptStream = yield* receiptBus.subscribeEventsForTest!.pipe(
          Scope.provide(testScope),
        );

        yield* Stream.runForEach(receiptStream, (receipt) =>
          receiptHistory.publish(receipt).pipe(Effect.andThen(Queue.offer(receipts, receipt))),
        ).pipe(Effect.forkIn(testScope));
        yield* reactor.start().pipe(Scope.provide(testScope));

        return receipts;
      }),
    );

    const drain = () => Effect.runPromise(reactor.drain);
    const nextReceipt = Queue.take(receipts);

    const createdAt = "2026-01-01T00:00:00.000Z";
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Test Project",
        workspaceRoot: options?.projectWorkspaceRoot ?? cwd,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create"),
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: options?.threadBranch ?? null,
          worktreePath: options?.threadWorktreePath ?? cwd,
          createdAt,
        })
        .pipe(
          options?.secondThreadSharingWorktree
            ? Effect.andThen(
                engine.dispatch({
                  type: "thread.create",
                  commandId: CommandId.make("cmd-thread-create-2"),
                  threadId: ThreadId.make("thread-2"),
                  projectId: asProjectId("project-1"),
                  title: "Thread 2",
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5-codex",
                  },
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  runtimeMode: "approval-required",
                  branch: null,
                  worktreePath: options?.threadWorktreePath ?? cwd,
                  createdAt,
                }),
              )
            : Effect.asVoid,
        ),
    );

    if (options?.seedFilesystemCheckpoints ?? true) {
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v2\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v3\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2),
        }),
      );
    }

    return {
      run: <A, E>(effect: Effect.Effect<A, E>) => runtime!.runPromise(effect),
      engine,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      provider,
      cwd,
      drain,
      nextReceipt,
      waitForReceipt: (predicate: (receipt: OrchestrationRuntimeReceipt) => boolean) =>
        runtime!.runPromise(receiptHistory.waitFor(predicate, "checkpoint receipt", 15000)),
    };
  }

  async function seedTwoTurnsAndRevertToFirst(harness: Awaited<ReturnType<typeof createHarness>>) {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    for (const turnCount of [1, 2]) {
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.diff.complete",
          commandId: CommandId.make(`cmd-diff-${turnCount}`),
          threadId,
          turnId: asTurnId(`turn-${turnCount}`),
          completedAt: createdAt,
          checkpointRef: checkpointRefForThreadTurn(threadId, turnCount),
          status: "ready",
          files: [],
          checkpointTurnCount: turnCount,
          createdAt,
        }),
      );
    }

    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("cmd-revert-request"),
        threadId,
        turnCount: 1,
        createdAt,
      }),
    );
  }

  const dispose = async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }

    scope = null;

    if (runtime) {
      await runtime.dispose();
    }

    runtime = null;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();

      if (dir) {
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    }
  };

  return {
    createHarness,
    seedTwoTurnsAndRevertToFirst,
    tempDirs,
    dispose,
    get runtime() {
      return runtime;
    },
    get scope() {
      return scope;
    },
  };
}
