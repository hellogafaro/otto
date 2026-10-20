import {
  AuthSessionId,
  BotId,
  CommandId,
  isSkillFile,
  LIBRARY_SKILLS_FOLDER_ID,
  skillProposal,
  ThreadId,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ActivityStoreLive } from "../activity/activity-store.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineLive } from "../orchestration/layers/orchestration-engine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/layers/projection-pipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/layers/projection-snapshot-query.ts";
import { OrchestrationEngineService } from "../orchestration/services/orchestration-engine.ts";
import * as ThreadBackgroundLiveness from "../orchestration/thread-background-liveness.ts";
import * as ThreadPlanProgress from "../orchestration/thread-plan-progress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/layers/orchestration-command-receipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/layers/orchestration-event-store.ts";
import { ProjectionBotRepositoryLive } from "../persistence/layers/projection-bots.ts";
import { ProjectionGroupRepositoryLive } from "../persistence/layers/projection-groups.ts";
import { ProjectionLibraryRepositoryLive } from "../persistence/layers/projection-library.ts";
import { ProjectionThreadMessageRepositoryLive } from "../persistence/layers/projection-thread-messages.ts";
import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import * as RepositoryIdentityResolver from "../project/repository-identity-resolver.ts";
import { loadLibraryState, readLibraryDocument } from "./library-store.ts";
import { makeLibraryToolRuntime } from "./library-tool-runtime.ts";

const nova = BotId.make("bot-nova");

const ana = {
  kind: "person" as const,
  personId: AuthSessionId.make("user-ana"),
  displayName: "Ana",
};

const ben = { personId: AuthSessionId.make("user-ben"), displayName: "Ben", canWrite: true };

const anaApproves = { personId: ana.personId, displayName: "Ana", canWrite: true };

const caller = { threadId: ThreadId.make("thread-weekly"), botId: nova };

const TestLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      OrchestrationProjectionPipelineLive.pipe(Layer.provideMerge(OrchestrationEventStoreLive)),
      OrchestrationProjectionSnapshotQueryLive,
      OrchestrationCommandReceiptRepositoryLive,
      ActivityStoreLive,
      ProjectionBotRepositoryLive,
      ProjectionGroupRepositoryLive,
      ProjectionLibraryRepositoryLive,
      ProjectionThreadMessageRepositoryLive,
    ).pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "otto-skill-proposals-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
);

/** Nova, owned by Ana, in a fresh database, then the Library tools as Nova. */
const withTools = <A, E, R>(
  test: (tools: Effect.Success<typeof makeLibraryToolRuntime>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const engine = yield* Effect.service(OrchestrationEngineService);

    yield* engine.dispatch({
      type: "bot.create",
      commandId: CommandId.make("proposals-bot-create"),
      botId: nova,
      name: "Nova",
      title: "Agent",
      avatar: { kind: "dither", seed: nova },
      engine: null,
      sandbox: "local",
      runtimeMode: "approval-required",
      groupId: null,
      owner: ana,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    return yield* test(yield* makeLibraryToolRuntime);
  }).pipe(Effect.provide(TestLayer));

const proposal = {
  name: "weekly-report",
  description: "Writes the Monday report from last week's closed tasks.",
  instructions:
    "# Weekly report\n\n1. Search last week's completed tasks.\n2. Group them by project.",
  files: [{ path: "references/format.md", content: "# Format\n\nOne line per task." }],
  visibility: "organization" as const,
  reason: "Ana asked for this report three Mondays in a row.",
};

const skillFiles = Effect.gen(function* () {
  const state = yield* loadLibraryState;
  const skill = state.folders.find((folder) => folder.parentId === LIBRARY_SKILLS_FOLDER_ID);
  const references = state.folders.find((folder) => folder.parentId === skill?.id);
  const main = state.files.find((file) => file.folderId === skill?.id && isSkillFile(file));
  const guide = state.files.find((file) => file.folderId === references?.id);

  return { skill, references, main, guide };
});

it.live("saves an approved skill proposal as the approver, with where it came from", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const saved = yield* tools.proposeSkill(caller, proposal, anaApproves);
      expect(saved).toMatchObject({ saved: true, approvedBy: "Ana" });

      const { skill, references, main, guide } = yield* skillFiles;
      expect(skill).toMatchObject({ title: "weekly-report", visibility: "organization" });
      expect(skill?.createdBy).toMatchObject({ kind: "person", personId: ana.personId });
      expect(references?.title).toBe("references");
      expect(guide).toMatchObject({ title: "format", extension: "md" });

      const content = yield* readLibraryDocument(main!);
      expect(content).toContain("name: weekly-report");
      expect(content).toContain("1. Search last week's completed tasks.");
      expect(skillProposal(content)).toEqual({ botId: nova, threadId: caller.threadId });
    }),
  ),
);

it.live("refuses a proposal nobody may approve", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      expect(yield* tools.proposeSkill(caller, proposal, undefined)).toEqual({
        error: "A person has to approve a skill proposal in the chat.",
      });
      expect(
        yield* tools.proposeSkill(caller, proposal, { ...anaApproves, canWrite: false }),
      ).toEqual({
        error: "Only a workspace member who can make changes can approve a Team skill.",
      });
      expect(yield* tools.proposeSkill(caller, { ...proposal, visibility: "user" }, ben)).toEqual({
        error: "Only this bot's owner can approve a skill for this bot alone.",
      });
      expect(yield* tools.proposeSkill(caller, { ...proposal, name: "git" }, anaApproves)).toEqual({
        error: "git is a built-in skill. Choose another name.",
      });
      expect((yield* skillFiles).skill).toBeUndefined();

      expect(
        yield* tools.proposeSkill(caller, { ...proposal, visibility: "user" }, anaApproves),
      ).toMatchObject({ saved: true });
      expect((yield* skillFiles).skill?.visibility).toBe("user");
    }),
  ),
);

it.live("applies an approved fix only to the version the bot read", () =>
  withTools((tools) =>
    Effect.gen(function* () {
      const { skillId } = (yield* tools.proposeSkill(caller, proposal, anaApproves)) as {
        skillId: string;
      };

      // New skills start off on every bot; Ana turns this one on for Nova.
      yield* (yield* Effect.service(OrchestrationEngineService)).dispatch({
        type: "bot.update",
        commandId: CommandId.make("proposals-skill-on"),
        botId: nova,
        disabledSkillIds: [],
      });

      const read = (yield* tools.readSkillFile(caller, { skillId })) as { updatedAt: string };

      const fix = {
        skillId,
        updatedAt: read.updatedAt,
        instructions: "# Weekly report\n\n1. Search completed tasks since last Monday.",
        reason: "Ana said the report missed Sunday's tasks.",
      };

      expect(yield* tools.updateSkill(caller, { ...fix, skillId: "git" }, anaApproves)).toEqual({
        error: "Built-in skills can't be changed.",
      });
      expect(yield* tools.updateSkill(caller, fix, ben)).toEqual({
        error: "Only someone who can edit this skill can approve a change to it.",
      });
      expect(yield* tools.updateSkill(caller, fix, anaApproves)).toMatchObject({ saved: true });

      const { main } = yield* skillFiles;
      const content = yield* readLibraryDocument(main!);
      expect(content).toContain("since last Monday");
      expect(content).toContain("description: Writes the Monday report");

      expect(yield* tools.updateSkill(caller, fix, anaApproves)).toEqual({
        error: "Changed by Ana, reload.",
      });
    }),
  ),
);
