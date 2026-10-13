import { AuthSessionId, BotId, CommandId, GroupId, MessageId, ThreadId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyAuthenticatedCommandActor,
  applyKnownGroupPerson,
  sessionPersonId,
} from "./AuthenticatedCommand.ts";

const currentPersonId = AuthSessionId.make("person-current");

const targetPersonId = AuthSessionId.make("person-target");

const targetPerson = {
  userId: targetPersonId,
  displayName: "Target person",
  email: "target@example.test",
};

describe("authenticated orchestration commands", () => {
  it("replaces spoofed leave identity with the authenticated person", () => {
    const command = applyAuthenticatedCommandActor(
      {
        type: "group.leave",
        commandId: CommandId.make("command-leave"),
        groupId: GroupId.make("group-1"),
        personId: AuthSessionId.make("person-spoofed"),
      },
      { personId: currentPersonId, displayName: "Current person", canManageGroups: false },
    );

    expect(command).toMatchObject({ type: "group.leave", personId: currentPersonId });
  });

  it("stamps group creators and turn senders from the authenticated person", () => {
    const actor = {
      personId: currentPersonId,
      displayName: "Current person",
      canManageGroups: false,
    };

    const group = applyAuthenticatedCommandActor(
      {
        type: "group.create",
        commandId: CommandId.make("command-create"),
        groupId: GroupId.make("group-1"),
        name: "Product",
        bossBotId: BotId.make("bot-1"),
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      actor,
    );

    const turn = applyAuthenticatedCommandActor(
      {
        type: "thread.turn.start",
        commandId: CommandId.make("command-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-1"),
          role: "user",
          text: "Hello",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: "2026-08-31T00:00:00.000Z",
      },
      actor,
    );

    expect(group).toMatchObject({ creator: { personId: currentPersonId } });
    expect(turn).toMatchObject({
      senderPersonId: currentPersonId,
      senderDisplayName: "Current person",
      senderCanManageGroups: false,
    });
  });

  it("uses the organization member's name for group assignment", () => {
    const command = applyKnownGroupPerson(
      {
        type: "group.person.assign",
        commandId: CommandId.make("command-assign"),
        groupId: GroupId.make("group-1"),
        person: {
          kind: "person",
          personId: targetPersonId,
          displayName: "Forged name",
        },
      },
      [targetPerson],
    );

    expect(command).toMatchObject({
      person: { personId: targetPersonId, displayName: "Target person" },
    });
  });

  it("rejects an unknown group person", () => {
    expect(
      applyKnownGroupPerson(
        {
          type: "group.person.assign",
          commandId: CommandId.make("command-unknown"),
          groupId: GroupId.make("group-1"),
          person: {
            kind: "person",
            personId: targetPersonId,
            displayName: "Unknown",
          },
        },
        [],
      ),
    ).toBeNull();
  });

  it("allows an administrator to unassign a revoked person", () => {
    const command = {
      type: "group.person.unassign" as const,
      commandId: CommandId.make("command-unassign-revoked"),
      groupId: GroupId.make("group-1"),
      personId: targetPersonId,
    };

    expect(applyKnownGroupPerson(command, [])).toEqual(command);
  });

  it("adds named organization members to a new group and rejects strangers", () => {
    const create = {
      type: "group.create" as const,
      commandId: CommandId.make("command-create-people"),
      groupId: GroupId.make("group-1"),
      name: "Product",
      bossBotId: BotId.make("bot-1"),
      createdAt: "2026-08-31T00:00:00.000Z",
    };

    const forged = { kind: "person" as const, personId: targetPersonId, displayName: "Forged" };

    expect(applyKnownGroupPerson({ ...create, people: [forged] }, [targetPerson])).toMatchObject({
      people: [{ personId: targetPersonId, displayName: "Target person" }],
    });
    expect(applyKnownGroupPerson({ ...create, people: [forged] }, [])).toBeNull();
  });

  it("treats every session of an account as the same person", () => {
    expect(sessionPersonId({ sessionId: AuthSessionId.make("session-a"), subject: "user-1" })).toBe(
      "user-1",
    );
    expect(
      sessionPersonId({ sessionId: AuthSessionId.make("session-b"), subject: "one-time-token" }),
    ).toBe("session-b");
  });
});
