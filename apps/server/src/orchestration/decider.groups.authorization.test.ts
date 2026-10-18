import * as Predicate from "effect/Predicate";
import {
  AuthSessionId,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type GroupMembership,
  type OrchestrationCommand,
} from "@otto/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  makeReadModel,
  makeBot,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  makeGroup,
  PERSON_ID,
  NOW,
  GROUP_ID,
  makeGroupThread,
  startTurnCommand,
} from "./test-support/group-decider-fixtures.ts";

it.layer(NodeServices.layer)("group membership decider", (it) => {
  it.effect("keeps people outside a group from changing it or opening its chats", () =>
    Effect.gen(function* () {
      const outsiderId = AuthSessionId.make("person-outsider");
      const actor = { personId: outsiderId, canManageGroups: false } as const;

      const readModel = {
        ...makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID }),
            makeBot({ id: SPECIALIST_ID }),
            makeBot({ id: OTHER_SPECIALIST_ID }),
          ],
          groups: [
            makeGroup({
              members: [
                { kind: "bot", botId: BOSS_ID, role: "boss" },
                { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
                { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
                { kind: "person", personId: PERSON_ID, displayName: "Member" },
              ],
            }),
          ],
        }),
        projects: [
          {
            id: ProjectId.make("project-1"),
            title: "Project",
            workspaceRoot: "/tmp/project",
            defaultModelSelection: null,
            scripts: [],
            createdAt: NOW,
            updatedAt: NOW,
            deletedAt: null,
          },
        ],
      };

      const results = yield* Effect.all([
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.rename",
              commandId: CommandId.make("cmd-outsider-rename"),
              groupId: GROUP_ID,
              name: "Renamed",
            },
            readModel,
            actor,
          }),
        ),
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.delete",
              commandId: CommandId.make("cmd-outsider-delete"),
              groupId: GROUP_ID,
            },
            readModel,
            actor,
          }),
        ),
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.member.assign",
              commandId: CommandId.make("cmd-outsider-assign"),
              groupId: GROUP_ID,
              botId: SPECIALIST_ID,
              role: "specialist",
            },
            readModel,
            actor,
          }),
        ),
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.member.unassign",
              commandId: CommandId.make("cmd-outsider-unassign"),
              groupId: GROUP_ID,
              botId: SPECIALIST_ID,
            },
            readModel,
            actor,
          }),
        ),
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.boss.set",
              commandId: CommandId.make("cmd-outsider-boss"),
              groupId: GROUP_ID,
              bossBotId: SPECIALIST_ID,
            },
            readModel,
            actor,
          }),
        ),
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "thread.create",
              commandId: CommandId.make("cmd-outsider-thread"),
              threadId: ThreadId.make("thread-outsider"),
              projectId: ProjectId.make("project-1"),
              groupId: GROUP_ID,
              title: "Outsider thread",
              modelSelection: {
                instanceId: ProviderInstanceId.make("default"),
                model: "default-model",
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: NOW,
            },
            readModel,
            actor,
          }),
        ),
      ]);

      expect(results.map((result) => result._tag)).toEqual([
        "Failure",
        "Failure",
        "Failure",
        "Failure",
        "Failure",
        "Failure",
      ]);
    }),
  );

  it.effect("lets an administrator mutate a group without membership", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "group.rename",
          commandId: CommandId.make("cmd-admin-rename"),
          groupId: GROUP_ID,
          name: "Admin renamed",
        },
        readModel: makeReadModel({ groups: [makeGroup()] }),
        actor: {
          personId: AuthSessionId.make("person-admin"),
          canManageGroups: true,
        },
      });

      if (!("type" in result)) throw new Error("Expected one group.renamed event");
      expect(result.type).toBe("group.renamed");
    }),
  );

  it.effect("rejects group-owned thread mutations from an authenticated outsider", () =>
    Effect.gen(function* () {
      const actor = {
        personId: AuthSessionId.make("person-outsider"),
        canManageGroups: false,
      } as const;

      const readModel = makeReadModel({
        groups: [makeGroup()],
        threads: [makeGroupThread()],
      });

      const commands = [
        {
          type: "thread.delete",
          commandId: CommandId.make("cmd-outsider-thread-delete"),
          threadId: ThreadId.make("thread-group"),
        },
        {
          type: "thread.archive",
          commandId: CommandId.make("cmd-outsider-thread-archive"),
          threadId: ThreadId.make("thread-group"),
        },
        {
          type: "thread.unarchive",
          commandId: CommandId.make("cmd-outsider-thread-unarchive"),
          threadId: ThreadId.make("thread-group"),
        },
        {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-outsider-thread-meta"),
          threadId: ThreadId.make("thread-group"),
          title: "Outsider title",
        },
        {
          type: "thread.session.stop",
          commandId: CommandId.make("cmd-outsider-thread-stop"),
          threadId: ThreadId.make("thread-group"),
          createdAt: NOW,
        },
        {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-outsider-thread-reaction"),
          threadId: ThreadId.make("thread-group"),
          messageId: MessageId.make("message-1"),
          botId: BOSS_ID,
          emoji: "👍",
          present: true,
          updatedAt: NOW,
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>;

      const errors = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel, actor }).pipe(Effect.flip),
        ),
      );

      for (const error of errors) {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected group thread authorization error");
        }

        expect(error.detail).toContain(`Person '${actor.personId}' is not a member`);
      }
    }),
  );

  it.effect("lets a member mutate a group-owned thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-member-thread-meta"),
          threadId: ThreadId.make("thread-group"),
          title: "Member title",
        },
        readModel: makeReadModel({ groups: [makeGroup()], threads: [makeGroupThread()] }),
        actor: { personId: PERSON_ID, canManageGroups: false },
      });

      if (!("type" in result)) throw new Error("Expected one thread.meta-updated event");
      expect(result.type).toBe("thread.meta-updated");
    }),
  );

  it.effect("binds client group reactions to the authenticated person", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("message-1");

      const readModel = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
        ],
        groups: [makeGroup()],
        threads: [
          {
            ...makeGroupThread(),
            respondingBotId: BOSS_ID,
            messages: [
              {
                id: messageId,
                role: "user",
                text: "Please investigate.",
                turnId: null,
                streaming: false,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          },
        ],
      });

      const command = {
        type: "thread.message.reaction.set",
        commandId: CommandId.make("cmd-member-thread-reaction"),
        threadId: ThreadId.make("thread-group"),
        messageId,
        botId: SPECIALIST_ID,
        emoji: "👍",
        present: true,
        updatedAt: NOW,
      } as const;

      const result = yield* decideOrchestrationCommand({
        command,
        readModel,
        actor: { personId: PERSON_ID, canManageGroups: false },
      });

      const event = (Array.isArray(result) ? result : [result]).find(
        (candidate) => candidate.type === "thread.message-reaction-set",
      );

      if (event?.type !== "thread.message-reaction-set") {
        throw new Error("Expected thread.message-reaction-set");
      }

      expect(event.payload).toMatchObject({ personId: PERSON_ID, emoji: "👍", present: true });
      expect(event.payload.botId).toBeUndefined();
    }),
  );

  it.effect("keeps trusted internal group reactions bot-authored", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("message-1");

      const readModel = makeReadModel({
        bots: [makeBot({ id: BOSS_ID, groupId: GROUP_ID })],
        groups: [makeGroup()],
        threads: [
          {
            ...makeGroupThread(),
            respondingBotId: BOSS_ID,
            messages: [
              {
                id: messageId,
                role: "user",
                text: "Please investigate.",
                turnId: null,
                streaming: false,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          },
        ],
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-internal-thread-reaction"),
          threadId: ThreadId.make("thread-group"),
          messageId,
          botId: BOSS_ID,
          emoji: "👍",
          present: true,
          updatedAt: NOW,
        },
        readModel,
      });

      const event = (Array.isArray(result) ? result : [result]).find(
        (candidate) => candidate.type === "thread.message-reaction-set",
      );

      if (event?.type !== "thread.message-reaction-set") {
        throw new Error("Expected thread.message-reaction-set");
      }

      expect(event.payload).toMatchObject({ botId: BOSS_ID, emoji: "👍", present: true });
      expect(event.payload.personId).toBeUndefined();
    }),
  );

  it.effect("lets an administrator mutate a group-owned thread without membership", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.delete",
          commandId: CommandId.make("cmd-admin-thread-delete"),
          threadId: ThreadId.make("thread-group"),
        },
        readModel: makeReadModel({ groups: [makeGroup()], threads: [makeGroupThread()] }),
        actor: {
          personId: AuthSessionId.make("person-admin"),
          canManageGroups: true,
        },
      });

      if (!("type" in result)) throw new Error("Expected one thread.deleted event");
      expect(result.type).toBe("thread.deleted");
    }),
  );

  it.effect("keeps trusted internal group-thread mutations actorless", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.stop",
          commandId: CommandId.make("cmd-internal-thread-stop"),
          threadId: ThreadId.make("thread-group"),
          createdAt: NOW,
        },
        readModel: makeReadModel({ groups: [makeGroup()], threads: [makeGroupThread()] }),
      });

      if (!("type" in result)) throw new Error("Expected one thread.session-stop-requested event");
      expect(result.type).toBe("thread.session-stop-requested");
    }),
  );

  it.effect("rejects a group turn from a person who is not a member", () =>
    Effect.gen(function* () {
      const outsiderId = AuthSessionId.make("person-outsider");

      const error = yield* decideOrchestrationCommand({
        command: {
          ...startTurnCommand(),
          senderPersonId: outsiderId,
          senderDisplayName: "Outsider",
        },
        readModel: makeReadModel({
          bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
          groups: [makeGroup()],
          threads: [makeGroupThread()],
        }),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected sender membership invariant error");
      }

      expect(error.detail).toContain(`Person '${outsiderId}' is not a member`);
    }),
  );

  it.effect("keeps an administrator who is not in a group from writing in it", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          ...startTurnCommand(),
          senderPersonId: AuthSessionId.make("person-admin"),
          senderDisplayName: "Owner",
          senderCanManageGroups: true,
        },
        readModel: makeReadModel({
          bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
          groups: [makeGroup()],
          threads: [makeGroupThread()],
        }),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected sender membership invariant error");
      }

      expect(error.detail).toContain("is not a member");
    }),
  );

  it.effect("lets an administrator claim a legacy bot-only group on the first turn", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          ...startTurnCommand(),
          senderCanManageGroups: true,
        },
        readModel: makeReadModel({
          bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
          groups: [
            makeGroup({
              members: [
                { kind: "bot", botId: BOSS_ID, role: "boss" },
                { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
              ],
            }),
          ],
          threads: [makeGroupThread()],
        }),
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "group.person-assigned",
        "thread.message-sent",
      ]);
      const assigned = events[0];

      if (assigned?.type !== "group.person-assigned") {
        throw new Error("Expected group person assignment");
      }

      expect(assigned.payload.person.personId).toBe(PERSON_ID);
      expect(assigned.payload.person.displayName).toBe("Member");
    }),
  );

  it.effect("rejects an ordinary person from a legacy bot-only group", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          ...startTurnCommand(),
          senderCanManageGroups: false,
        },
        readModel: makeReadModel({
          bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
          groups: [
            makeGroup({
              members: [
                { kind: "bot", botId: BOSS_ID, role: "boss" },
                { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
              ],
            }),
          ],
          threads: [makeGroupThread()],
        }),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected sender membership invariant error");
      }

      expect(error.detail).toContain(`Person '${PERSON_ID}' is not a member`);
    }),
  );

  it.effect("rejects a group turn without an authenticated sender", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: startTurnCommand(undefined, null),
        readModel: makeReadModel({
          bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
          groups: [makeGroup()],
          threads: [makeGroupThread()],
        }),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected missing sender invariant error");
      }

      expect(error.detail).toContain("A person member must send turns");
    }),
  );
});

it.layer(NodeServices.layer)("group people", (it) => {
  const ANA = AuthSessionId.make("user-ana");
  const BEN = AuthSessionId.make("user-ben");
  const CY = AuthSessionId.make("user-cy");

  const people = makeReadModel({
    bots: [makeBot({ id: BOSS_ID })],
    groups: [
      makeGroup({
        members: [
          { kind: "bot", botId: BOSS_ID, role: "boss" },
          { kind: "person", personId: ANA, displayName: "Ana" },
          { kind: "person", personId: BEN, displayName: "Ben" },
        ],
      }),
    ],
  });

  const tags = (...results: ReadonlyArray<{ readonly _tag: string }>) =>
    results.map((result) => result._tag);

  it.effect("creates a group with its creator, other people and one bot", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "group.create",
          commandId: CommandId.make("cmd-create-people"),
          groupId: GROUP_ID,
          name: "Team",
          bossBotId: BOSS_ID,
          creator: { kind: "person", personId: ANA, displayName: "Ana" },
          people: [
            { kind: "person", personId: BEN, displayName: "Ben" },
            { kind: "person", personId: ANA, displayName: "Ana" },
          ],
          createdAt: NOW,
        },
        readModel: makeReadModel({ bots: [makeBot({ id: BOSS_ID })] }),
      });

      const [event] = Array.isArray(result) ? result : [result];

      expect(event?.type).toBe("group.created");
      expect(
        event?.type === "group.created"
          ? event.payload.members.map((member: GroupMembership) =>
              member.kind === "person" ? member.personId : member.botId,
            )
          : [],
      ).toEqual([BOSS_ID, ANA, BEN]);
    }),
  );

  it.effect("lets any member add a person once, but not an outsider", () =>
    Effect.gen(function* () {
      const assign = (personId: AuthSessionId, actorId: AuthSessionId) =>
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.person.assign",
              commandId: CommandId.make(`cmd-assign-${personId}-${actorId}`),
              groupId: GROUP_ID,
              person: { kind: "person", personId, displayName: "Someone" },
            },
            readModel: people,
            actor: { personId: actorId, canManageGroups: false },
          }),
        );

      expect(tags(yield* assign(CY, BEN), yield* assign(BEN, ANA), yield* assign(CY, CY))).toEqual([
        "Success",
        "Failure",
        "Failure",
      ]);
    }),
  );

  it.effect("lets any member, not only the group's first person, add a bot", () =>
    Effect.gen(function* () {
      const assign = (actorId: AuthSessionId) =>
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.member.assign",
              commandId: CommandId.make(`cmd-assign-bot-${actorId}`),
              groupId: GROUP_ID,
              botId: SPECIALIST_ID,
              role: "specialist",
            },
            readModel: makeReadModel({
              bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
              groups: people.groups,
            }),
            actor: { personId: actorId, canManageGroups: false },
          }),
        );

      expect(tags(yield* assign(BEN), yield* assign(CY))).toEqual(["Success", "Failure"]);
    }),
  );

  it.effect("lets the group's first person or an admin remove others, and anyone leave", () =>
    Effect.gen(function* () {
      const unassign = (personId: AuthSessionId, actorId: AuthSessionId, admin = false) =>
        Effect.result(
          decideOrchestrationCommand({
            command: {
              type: "group.person.unassign",
              commandId: CommandId.make(`cmd-unassign-${personId}-${actorId}`),
              groupId: GROUP_ID,
              personId,
            },
            readModel: people,
            actor: { personId: actorId, canManageGroups: admin },
          }),
        );

      expect(
        tags(
          yield* unassign(BEN, ANA),
          yield* unassign(ANA, BEN),
          yield* unassign(BEN, BEN),
          yield* unassign(ANA, CY, true),
        ),
      ).toEqual(["Success", "Failure", "Success", "Success"]);
    }),
  );

  it.effect("keeps the last person in a group", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "group.leave",
          commandId: CommandId.make("cmd-last-leave"),
          groupId: GROUP_ID,
          personId: PERSON_ID,
        },
        readModel: makeReadModel({ bots: [makeBot({ id: BOSS_ID })], groups: [makeGroup()] }),
      }).pipe(Effect.flip);

      expect(
        Predicate.isTagged(error, "OrchestrationCommandInvariantError") && error.detail,
      ).toContain("last person");
    }),
  );
});
