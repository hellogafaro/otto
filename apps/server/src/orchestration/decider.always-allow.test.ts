import {
  ApprovalRequestId,
  AuthSessionId,
  BotId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationBot,
  type OrchestrationReadModel,
  type ProviderApprovalDecision,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

const NOW = "2026-10-17T10:00:00.000Z";

const THREAD_ID = ThreadId.make("thread-ops");

const BOT_ID = BotId.make("bot-ops");

const owner = { personId: AuthSessionId.make("person-ana"), displayName: "Ana" };

const member = { personId: AuthSessionId.make("person-ben"), displayName: "Ben" };

const bot: OrchestrationBot = {
  id: BOT_ID,
  name: "Ops",
  title: "Operator",
  label: null,
  description: null,
  instructions: null,
  disabledMcpServerIds: [],
  owner: { kind: "person", ...owner },
  avatar: { kind: "dither", seed: BOT_ID },
  engine: null,
  imageProvider: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  channelBindings: [],
  groupId: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const readModel: OrchestrationReadModel = {
  ...createEmptyReadModel(NOW),
  bots: [bot],
  threads: [
    {
      id: THREAD_ID,
      projectId: ProjectId.make("project-1"),
      botId: BOT_ID,
      groupId: null,
      respondingBotId: null,
      title: "Ops chat",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
};

const respond = (decision: ProviderApprovalDecision, responder: typeof owner) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.approval.respond",
      commandId: CommandId.make(`approval-${decision}-${responder.personId}`),
      threadId: THREAD_ID,
      requestId: ApprovalRequestId.make("shell-1"),
      decision,
      responder: { ...responder, canWrite: false },
      createdAt: NOW,
    },
    readModel,
  });

const rule = (by: typeof owner) => ({
  toolName: "shell",
  action: null,
  createdBy: by,
  createdAt: NOW,
});

it.layer(NodeServices.layer)("Always allow authority", (it) => {
  it.effect("refuses Always allow from someone who is not the bot's owner", () =>
    Effect.gen(function* () {
      const error = yield* respond("acceptAlways", member).pipe(Effect.flip);

      expect(String(error)).toContain("Only the bot's owner can choose Always allow");
    }),
  );

  it.effect("lets the owner choose Always allow and anyone answer once or never", () =>
    Effect.gen(function* () {
      for (const [decision, responder] of [
        ["acceptAlways", owner],
        ["accept", member],
        ["decline", member],
      ] as const) {
        const decided = yield* respond(decision, responder);
        const events = Array.isArray(decided) ? decided : [decided];

        expect(events.map((event) => event.type)).toEqual(["thread.approval-response-requested"]);
      }
    }),
  );

  it.effect("saves an Always allow rule only as the bot's owner", () =>
    Effect.gen(function* () {
      const update = (by: typeof owner | undefined) =>
        decideOrchestrationCommand({
          command: {
            type: "bot.update",
            commandId: CommandId.make(`allow-${by?.personId ?? "nobody"}`),
            botId: BOT_ID,
            alwaysAllow: rule(by ?? member),
            ...(by ? { by: { kind: "person" as const, ...by } } : {}),
          },
          readModel,
        });

      for (const by of [member, undefined]) {
        const error = yield* update(by).pipe(Effect.flip);

        expect(String(error)).toContain("Only the bot's owner can choose Always allow");
      }

      const decided = yield* update(owner);
      const events = Array.isArray(decided) ? decided : [decided];

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "bot.updated",
          payload: expect.objectContaining({ alwaysAllowed: [rule(owner)] }),
        }),
      );
    }),
  );
});

it.layer(NodeServices.layer)("Bot visibility authority", (it) => {
  it.effect("lets only the bot's owner change who sees it", () =>
    Effect.gen(function* () {
      const update = (by: typeof owner | undefined) =>
        decideOrchestrationCommand({
          command: {
            type: "bot.update",
            commandId: CommandId.make(`visibility-${by?.personId ?? "nobody"}`),
            botId: BOT_ID,
            visibility: "user",
            ...(by ? { by: { kind: "person" as const, ...by } } : {}),
          },
          readModel,
        });

      for (const by of [member, undefined]) {
        const error = yield* update(by).pipe(Effect.flip);

        expect(String(error)).toContain("Only the bot's owner can change who sees it");
      }

      const decided = yield* update(owner);
      const events = Array.isArray(decided) ? decided : [decided];

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "bot.updated",
          payload: expect.objectContaining({ visibility: "user" }),
        }),
      );
    }),
  );
});
