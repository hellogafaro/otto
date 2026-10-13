import { it } from "@effect/vitest";
import {
  BotId,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationSession,
  ThreadId,
} from "@otto/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import { GroupRoundReactor } from "../Services/GroupRoundReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  PERSON_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import { GroupRoundReactorLive } from "./GroupRoundReactor.ts";

const threadId = ThreadId.make("thread-group");

const ANALYST_ID = BotId.make("bot-analyst");

type GroupTurn = Extract<OrchestrationCommand, { type: "thread.group-turn.start" }>;

const harness = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<OrchestrationEvent>();
  const turns: GroupTurn[] = [];
  let sequence = 0;

  const readModel = makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
      makeBot({ id: ANALYST_ID, groupId: GROUP_ID }),
    ],
    groups: [
      makeGroup({
        members: [
          { kind: "bot", botId: BOSS_ID, role: "boss" },
          { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
          { kind: "bot", botId: ANALYST_ID, role: "specialist" },
          { kind: "person", personId: PERSON_ID, displayName: "Member" },
        ],
      }),
    ],
    threads: [makeGroupThread()],
  });

  const engine = Layer.mock(OrchestrationEngineService)({
    dispatch: (command) =>
      Effect.sync(() => {
        if (command.type === "thread.group-turn.start") turns.push(command);

        return { sequence };
      }),
    subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
  });

  const projection = Layer.mock(ProjectionSnapshotQuery)({
    getThreadShellById: () =>
      Effect.succeed(
        Option.some({
          ...makeGroupThread(),
          session: null,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
        }),
      ),
    getCommandReadModel: () => Effect.succeed(readModel),
  });

  const services = yield* Layer.build(
    GroupRoundReactorLive.pipe(Layer.provide(Layer.merge(engine, projection))),
  );

  const reactor = Context.get(services, GroupRoundReactor);

  yield* reactor.start();

  const publish = (type: OrchestrationEvent["type"], payload: OrchestrationEvent["payload"]) =>
    Effect.gen(function* () {
      sequence += 1;
      yield* PubSub.publish(events, {
        sequence,
        eventId: EventId.make(`event-${sequence}`),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: NOW,
        commandId: CommandId.make(`command-${sequence}`),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type,
        payload,
        // SAFETY: Each call pairs a type with its own payload shape below.
      } as OrchestrationEvent);
      yield* Effect.yieldNow;
      yield* reactor.drain;
    });

  const person = (text: string) =>
    publish("thread.message-sent", {
      threadId,
      messageId: MessageId.make(`message-${sequence + 1}`),
      role: "user",
      text,
      attachments: [],
      turnId: null,
      authorPersonId: PERSON_ID,
      authorDisplayName: "Member",
      streaming: false,
      createdAt: NOW,
      updatedAt: NOW,
    });

  const session = (status: OrchestrationSession["status"]) =>
    publish("thread.session-set", {
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });

  /** Runs the current bot's turn to the end, with or without a visible reply. */
  const finishTurn = (reply: string | null, end: OrchestrationSession["status"] = "ready") =>
    Effect.gen(function* () {
      // Like the live server: the previous bot's session stops before this bot's turn runs.
      yield* session("starting");
      yield* session("stopped");
      yield* session("ready");
      yield* session("running");

      if (reply !== null) {
        yield* publish("thread.message-sent", {
          threadId,
          messageId: MessageId.make(`reply-${sequence + 1}`),
          role: "assistant",
          text: reply,
          turnId: null,
          streaming: true,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }

      yield* session(end);
    });

  const wait = (millis: number) =>
    TestClock.adjust(millis).pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(reactor.drain));

  return { turns, person, finishTurn, wait };
});

const bots = (turns: ReadonlyArray<GroupTurn>) => turns.map((turn) => turn.botId);

describe("GroupRoundReactor", () => {
  it.effect("waits for a quiet moment, then asks every bot in roster order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("hello team");
        yield* wait(1_000);
        yield* person("who can fix the login page?");
        yield* wait(1_900);
        expect(turns).toEqual([]);

        yield* wait(100);
        expect(bots(turns)).toEqual([BOSS_ID]);
        expect(turns[0]?.input).toBe("hello team\n\nwho can fix the login page?");
        expect(turns[0]?.messageId).toBe("message-2");

        yield* finishTurn(null);
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID]);
        expect(turns[1]?.input).toContain("NO_REPLY");

        yield* finishTurn("I can fix it.");
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID, ANALYST_ID]);
        expect(turns[2]?.input).toContain("NO_REPLY");
        expect(turns[2]?.input).not.toContain("no other bot answered");

        yield* finishTurn(null);
        expect(turns).toHaveLength(3);
      }),
    ),
  );

  it.effect("makes the last bot answer when every other bot passes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("anyone?");
        yield* wait(2_000);
        yield* finishTurn(null);
        yield* finishTurn(null);
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID, ANALYST_ID]);
        expect(turns[2]?.input).toContain("no other bot answered");
      }),
    ),
  );

  it.effect("asks only mentioned bots, and every bot for @everyone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("@bot-analyst and @bot-specialist, check the numbers");
        yield* wait(2_000);
        yield* finishTurn("Numbers look fine.");
        yield* finishTurn("Agreed.");
        expect(bots(turns)).toEqual([ANALYST_ID, SPECIALIST_ID]);

        yield* person("@everyone standup");
        yield* wait(2_000);
        yield* finishTurn("Done.");
        yield* finishTurn("Done.");
        yield* finishTurn("Done.");
        expect(bots(turns).slice(2)).toEqual([BOSS_ID, SPECIALIST_ID, ANALYST_ID]);
      }),
    ),
  );

  it.effect("follows bot-to-bot mentions up to the cap", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("@bot-boss plan this");
        yield* wait(2_000);
        yield* finishTurn("@bot-specialist build it");
        yield* finishTurn("@bot-boss done, and @bot-analyst please review");
        yield* finishTurn("@bot-specialist one fix");
        yield* finishTurn("@bot-boss fixed");
        yield* finishTurn("@bot-specialist thanks");
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID, BOSS_ID, ANALYST_ID]);
        expect(turns[1]?.input).toContain("bot-boss mentioned you");
      }),
    ),
  );

  it.effect("starts by the maximum wait even while a person keeps typing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, wait } = yield* harness;

        for (let index = 0; index < 6; index += 1) {
          yield* person(`part ${index}`);
          yield* wait(1_500);
        }

        expect(bots(turns)).toEqual([BOSS_ID]);
        expect(turns[0]?.input).toBe("part 0\n\npart 1\n\npart 2\n\npart 3\n\npart 4\n\npart 5");
      }),
    ),
  );

  it.effect("lets the answering bot finish, then starts over with a newer message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("first question");
        yield* wait(2_000);
        yield* person("actually, @bot-analyst only");
        yield* wait(2_000);
        expect(bots(turns)).toEqual([BOSS_ID]);

        yield* finishTurn(null);
        expect(bots(turns)).toEqual([BOSS_ID, ANALYST_ID]);
        expect(turns[1]?.input).toBe("actually, @bot-analyst only");
      }),
    ),
  );

  it.effect("drops the waiting bots when a person stops the round", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, person, finishTurn, wait } = yield* harness;

        yield* person("@everyone go");
        yield* wait(2_000);
        yield* finishTurn(null, "interrupted");
        expect(bots(turns)).toEqual([BOSS_ID]);
      }),
    ),
  );
});
