import {
  AuthSessionId,
  BotId,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  canSeeDirectChat,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
} from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { chatPeople, visibleShellSnapshot } from "./group-visibility.ts";

const NOW = "2026-10-20T00:00:00.000Z";

const ANA = AuthSessionId.make("user-ana");

const BEN = AuthSessionId.make("user-ben");

const CAL = AuthSessionId.make("user-cal");

const project = { id: ProjectId.make("project-1"), deletedAt: null } as never;

const personDm: OrchestrationThread = {
  id: ThreadId.make("thread-person-dm"),
  projectId: ProjectId.make("project-1"),
  personId: BEN,
  createdBy: ANA,
  visibility: "user",
  title: "Lunch",
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

const readModelWith = (threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel => ({
  snapshotSequence: 0,
  bots: [],
  groups: [],
  delegations: [],
  projects: [project],
  threads: [...threads],
  updatedAt: NOW,
});

const create = (fields: { createdBy?: AuthSessionId; botId?: BotId }) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.create",
      commandId: CommandId.make("cmd-create"),
      threadId: ThreadId.make("thread-new"),
      projectId: personDm.projectId,
      personId: BEN,
      title: "New",
      modelSelection: personDm.modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
      ...fields,
    },
    readModel: readModelWith([]),
  });

const send = (senderPersonId: AuthSessionId) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.turn.start",
      commandId: CommandId.make(`cmd-send-${senderPersonId}`),
      threadId: personDm.id,
      message: {
        messageId: MessageId.make(`message-${senderPersonId}`),
        role: "user",
        text: "Pizza?",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      senderPersonId,
      senderDisplayName: "Someone",
      createdAt: NOW,
    } as never,
    readModel: readModelWith([personDm]),
  });

it.layer(NodeServices.layer)("person DMs", (it) => {
  it.effect("starts a DM between its creator and the other person", () =>
    Effect.gen(function* () {
      const result = yield* create({ createdBy: ANA });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event).toMatchObject({
        type: "thread.created",
        payload: { personId: BEN, createdBy: ANA, botId: null, groupId: null },
      });
    }),
  );

  it.effect("refuses a DM with yourself, with no creator, or with a bot in it", () =>
    Effect.gen(function* () {
      const refusals = yield* Effect.all(
        [
          create({ createdBy: BEN }),
          create({}),
          create({ createdBy: ANA, botId: BotId.make("bot-1") }),
        ].map((attempt) => Effect.flip(attempt)),
      );

      expect(refusals).toHaveLength(3);
    }),
  );

  it.effect("lets either person write and starts no bot turn", () =>
    Effect.gen(function* () {
      for (const sender of [ANA, BEN]) {
        const result = yield* send(sender);
        const events = Array.isArray(result) ? result : [result];
        const types = events.map((event) => event.type);

        expect(types).toContain("thread.message-sent");
        expect(types).not.toContain("thread.turn-start-requested");
      }
    }),
  );

  it.effect("refuses anyone else's message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(send(CAL));

      expect(String(error)).toContain("Only the two people");
    }),
  );
});

it("shows a person DM to its two people only, whatever its visibility", () => {
  for (const visibility of ["user", "organization"] as const) {
    const chat = { ...personDm, visibility };

    expect(canSeeDirectChat(chat, { kind: "person", personId: ANA })).toBe(true);
    expect(canSeeDirectChat(chat, { kind: "person", personId: BEN })).toBe(true);
    expect(canSeeDirectChat(chat, { kind: "person", personId: CAL })).toBe(false);
    expect(canSeeDirectChat(chat, { kind: "bot", botId: BotId.make("bot-1") })).toBe(false);
  }

  const shell: OrchestrationShellSnapshot = {
    snapshotSequence: 1,
    projects: [],
    bots: [],
    groups: [],
    delegations: [],
    threads: [{ ...personDm, session: null } as never],
    updatedAt: NOW,
  };

  expect(visibleShellSnapshot(shell, BEN).threads).toHaveLength(1);
  expect(visibleShellSnapshot(shell, CAL).threads).toHaveLength(0);
});

it("names both people as who a person DM reaches", () => {
  expect(chatPeople(personDm, [])).toEqual([ANA, BEN]);
});
