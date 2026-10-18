import {
  AuthSessionId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationThread,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { decideOrchestrationCommand } from "./decider.ts";
import { canSeeRoutine, visibleShellSnapshot, withGroupVisibility } from "./group-visibility.ts";

const NOW = "2026-10-15T00:00:00.000Z";

const ANA = AuthSessionId.make("user-ana");

const BEN = AuthSessionId.make("user-ben");

const dm: OrchestrationThread = {
  id: ThreadId.make("thread-dm"),
  projectId: ProjectId.make("project-1"),
  createdBy: ANA,
  visibility: "organization",
  title: "Plans",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const readModelWith = (thread: OrchestrationThread): OrchestrationReadModel => ({
  snapshotSequence: 0,
  bots: [],
  groups: [],
  delegations: [],
  projects: [],
  threads: [thread],
  updatedAt: NOW,
});

const makePrivate = (thread: OrchestrationThread, by: AuthSessionId) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.meta.update",
      commandId: CommandId.make("cmd-private"),
      threadId: thread.id,
      visibility: "user",
      by,
    },
    readModel: readModelWith(thread),
  });

it.layer(NodeServices.layer)("chat visibility", (it) => {
  it.effect("starts a DM private to the person who started it", () =>
    Effect.gen(function* () {
      const project = { id: dm.projectId, deletedAt: null } as never;

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-create"),
          threadId: ThreadId.make("thread-new"),
          projectId: dm.projectId,
          createdBy: ANA,
          title: "New",
          modelSelection: dm.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        readModel: { ...readModelWith(dm), projects: [project] },
      });

      const event = Array.isArray(result) ? result[0] : result;

      expect(event).toMatchObject({ payload: { visibility: "user", createdBy: ANA } });
    }),
  );

  it.effect("lets the person who started a chat make it private", () =>
    Effect.gen(function* () {
      const result = yield* makePrivate(dm, ANA);

      const event = Array.isArray(result) ? result[0] : result;

      expect(event).toMatchObject({
        type: "thread.meta-updated",
        payload: { threadId: dm.id, visibility: "user" },
      });
    }),
  );

  it.effect("refuses anyone else and a chat nobody started", () =>
    Effect.gen(function* () {
      const refusals = yield* Effect.all(
        [makePrivate(dm, BEN), makePrivate({ ...dm, createdBy: null }, ANA)].map((attempt) =>
          Effect.flip(attempt),
        ),
      );

      for (const error of refusals) {
        expect(String(error)).toContain("Only the person who started this chat");
      }
    }),
  );
});

const shellWith = (thread: OrchestrationThread): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: [],
  bots: [],
  groups: [],
  delegations: [],
  threads: [{ ...thread, session: null } as never],
  updatedAt: NOW,
});

it("keeps a private routine to its creator and its bot", () => {
  const routine = { createdBy: ANA, botId: null as never, visibility: "user" as const };

  expect(canSeeRoutine(routine, ANA)).toBe(true);
  expect(canSeeRoutine(routine, BEN)).toBe(false);
  expect(canSeeRoutine({ ...routine, visibility: "organization" }, BEN)).toBe(true);
});

it("keeps a private chat in its creator's shell only", () => {
  const privateDm = shellWith({ ...dm, visibility: "user" });

  expect(visibleShellSnapshot(privateDm, ANA).threads).toHaveLength(1);
  expect(visibleShellSnapshot(privateDm, BEN).threads).toHaveLength(0);
  expect(visibleShellSnapshot(shellWith(dm), BEN).threads).toHaveLength(1);
});

it.effect("removes a chat from everyone else's list when it turns private", () =>
  Effect.gen(function* () {
    const items: ReadonlyArray<OrchestrationShellStreamItem> = [
      { kind: "snapshot", snapshot: shellWith(dm) },
      {
        kind: "thread-upserted",
        sequence: 2,
        thread: shellWith({ ...dm, visibility: "user" }).threads[0]!,
      },
    ];

    const deliveredTo = (personId: AuthSessionId) =>
      withGroupVisibility({
        stream: Stream.fromIterable(items),
        personId,
        loadSnapshot: Effect.succeed(shellWith(dm)),
        loadChatThreads: Effect.succeed([]),
        loadLibraryFolders: Effect.succeed([]),
        resuming: false,
      }).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.map((delivered) => delivered.map((item) => item.kind)),
      );

    expect(yield* deliveredTo(ANA)).toEqual(["snapshot", "thread-upserted"]);
    expect(yield* deliveredTo(BEN)).toEqual(["snapshot", "thread-removed"]);
  }),
);
