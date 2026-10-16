import { AuthSessionId, BotId, type WorkParticipant } from "@otto/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe } from "vite-plus/test";

import { SqlitePersistenceMemory } from "../persistence/layers/sqlite.ts";
import {
  chatMentionRecipients,
  commentRecipients,
  taskChangeRecipients,
} from "./notification-reactor.ts";
import { NotificationStore, NotificationStoreLive } from "./notification-store.ts";

const ada = AuthSessionId.make("session-ada");

const bob = AuthSessionId.make("session-bob");

const cy = AuthSessionId.make("session-cy");

const person = (personId: AuthSessionId, displayName: string): WorkParticipant => ({
  kind: "person",
  personId,
  displayName,
});

const adaPerson = person(ada, "Ada");

const bobPerson = person(bob, "Bob");

const cyPerson = person(cy, "Cy");

const task = (owner: WorkParticipant | null, assignees: ReadonlyArray<WorkParticipant>) => ({
  owner,
  assignees,
});

describe("taskChangeRecipients", () => {
  it("tells a new task's owner and assignees, never its creator", () => {
    expect(
      taskChangeRecipients({
        task: task(bobPerson, [adaPerson, cyPerson]),
        actor: { type: "person", id: ada },
        changes: undefined,
        created: true,
      }),
    ).toEqual([
      { personId: bob, type: "owner" },
      { personId: cy, type: "assigned" },
    ]);
  });

  it("tells only people newly assigned on an update", () => {
    expect(
      taskChangeRecipients({
        task: task(adaPerson, [bobPerson, cyPerson]),
        actor: { type: "person", id: ada },
        changes: { assignees: { from: [bobPerson], to: [bobPerson, cyPerson] } },
        created: false,
      }),
    ).toEqual([{ personId: cy, type: "assigned" }]);
  });

  it("tells nobody when an update leaves the people alone", () => {
    expect(
      taskChangeRecipients({
        task: task(bobPerson, [cyPerson]),
        actor: { type: "person", id: ada },
        changes: { title: { from: "Old", to: "New" } },
        created: false,
      }),
    ).toEqual([]);
  });
});

describe("commentRecipients", () => {
  it("gives each person one reason, strongest first, and skips the author", () => {
    expect(
      commentRecipients({
        content: `Hi <mention type="person" id="${cy}">Cy</mention> and <mention type="person" id="${ada}">Ada</mention>`,
        actor: { type: "person", id: ada },
        repliedAuthor: { type: "person", id: bob },
        participants: [adaPerson, bobPerson, cyPerson],
      }),
    ).toEqual([
      { personId: cy, type: "mention" },
      { personId: bob, type: "reply" },
    ]);
  });

  it("tells a task's people about a bot's comment", () => {
    expect(
      commentRecipients({
        content: "Done.",
        actor: { type: "bot", id: BotId.make("bot-nova") },
        repliedAuthor: null,
        participants: [bobPerson, null],
      }),
    ).toEqual([{ personId: bob, type: "comment" }]);
  });
});

describe("chatMentionRecipients", () => {
  const people = [
    { personId: ada, displayName: "Ada" },
    { personId: bob, displayName: "Bob Ray" },
  ];

  it("matches whole @names and never the author", () => {
    expect(
      chatMentionRecipients({ text: "@Ada and @bob ray, look", authorPersonId: ada, people }),
    ).toEqual([bob]);

    expect(chatMentionRecipients({ text: "email@Adams", authorPersonId: bob, people })).toEqual([]);
  });
});

it.layer(
  NotificationStoreLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(NodeServices.layer),
  ),
)("NotificationStore", (it) => {
  it.effect("keeps each person's notifications apart and counts what is unread", () =>
    Effect.gen(function* () {
      const store = yield* NotificationStore;

      const row = {
        type: "mention" as const,
        actor: { type: "person" as const, id: ada },
        entityType: "task" as const,
        entityId: "task-1",
        title: "Draft",
        excerpt: "hi",
      };

      yield* store.insert({
        ...row,
        id: "n1",
        personId: bob,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      yield* store.insert({
        ...row,
        id: "n1",
        personId: bob,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      yield* store.insert({
        ...row,
        id: "n2",
        personId: bob,
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      yield* store.insert({
        ...row,
        id: "n3",
        personId: cy,
        createdAt: "2026-01-02T00:00:00.000Z",
      });

      const listed = yield* store.list(bob);

      expect(listed.unread).toBe(2);

      expect(listed.notifications.map((notification) => notification.id)).toEqual(["n2", "n1"]);

      yield* store.markRead({ personId: cy, ids: ["n1"] });

      expect((yield* store.list(bob)).unread).toBe(2);

      yield* store.markRead({ personId: bob, ids: ["n2"] });

      expect((yield* store.list(bob)).unread).toBe(1);

      yield* store.markRead({ personId: bob });

      expect((yield* store.list(bob)).unread).toBe(0);

      expect((yield* store.list(cy)).unread).toBe(1);
    }),
  );
});
