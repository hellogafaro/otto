import { it } from "@effect/vitest";
import {
  AuthSessionId,
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

import { AgentController } from "../../provider/services/agent-controller.ts";
import { GroupRoundReactor } from "../services/group-round-reactor.ts";
import { OrchestrationEngineService } from "../services/orchestration-engine.ts";
import { ProjectionSnapshotQuery } from "../services/projection-snapshot-query.ts";
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
} from "../test-support/group-decider-fixtures.ts";
import { GroupRoundReactorLive } from "./group-round-reactor.ts";

const threadId = ThreadId.make("thread-group");

const ANALYST_ID = BotId.make("bot-analyst");

const SECOND_PERSON_ID = AuthSessionId.make("person-ana");

type GroupTurn = Extract<OrchestrationCommand, { type: "thread.group-turn.start" }>;

type Signal = Parameters<AgentController["Service"]["signalTurn"]>[0];

const makeHarness = (options: { readonly signalTurnDelivers?: boolean } = {}) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<OrchestrationEvent>();
    const turns: GroupTurn[] = [];
    const signals: Signal[] = [];
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
            { kind: "person", personId: SECOND_PERSON_ID, displayName: "Ana" },
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

    const agentController = Layer.mock(AgentController)({
      signalTurn: (input) =>
        Effect.sync(() => {
          signals.push(input);

          return options.signalTurnDelivers === true;
        }),
    });

    const services = yield* Layer.build(
      GroupRoundReactorLive.pipe(
        Layer.provide(Layer.mergeAll(engine, projection, agentController)),
      ),
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

    const person = (text: string, author = { id: PERSON_ID, name: "Member" }) =>
      publish("thread.message-sent", {
        threadId,
        messageId: MessageId.make(`message-${sequence + 1}`),
        role: "user",
        text,
        attachments: [],
        turnId: null,
        authorPersonId: author.id,
        authorDisplayName: author.name,
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

    return { turns, signals, person, session, finishTurn, wait };
  });

const harness = makeHarness();

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
        expect(turns[0]?.input).toBe("Member: hello team\n\nMember: who can fix the login page?");
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
        expect(turns[0]?.input).toBe(
          [0, 1, 2, 3, 4, 5].map((index) => `Member: part ${index}`).join("\n\n"),
        );
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
        expect(turns[1]?.input).toBe("Member: actually, @bot-analyst only");
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

  it.effect("adds a message to the answering bot's turn and drops the bots still waiting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, signals, person, session, wait } = yield* makeHarness({
          signalTurnDelivers: true,
        });

        yield* person("plan the offsite");
        yield* wait(2_000);
        yield* session("running");
        yield* person("wait a minute");
        expect(signals).toEqual([{ threadId, input: "Member: wait a minute", attachments: [] }]);

        yield* wait(8_000);
        yield* session("ready");
        expect(bots(turns)).toEqual([BOSS_ID]);
      }),
    ),
  );

  it.effect("sends @everyone to the answering bot, then asks the others", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, signals, person, session, finishTurn, wait } = yield* makeHarness({
          signalTurnDelivers: true,
        });

        yield* person("@bot-boss draft the agenda");
        yield* wait(2_000);
        yield* session("running");
        yield* person("@everyone add your topics too");
        expect(signals).toHaveLength(1);

        yield* session("ready");
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID]);
        expect(turns[1]?.messageId).not.toBe(turns[0]?.messageId);
        expect(turns[1]?.input).toContain("for everyone");

        yield* finishTurn("Mine is hiring.");
        expect(bots(turns)).toEqual([BOSS_ID, SPECIALIST_ID, ANALYST_ID]);
      }),
    ),
  );

  it.effect("keeps a message for another bot until the answering bot finishes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, signals, person, session, wait } = yield* makeHarness({
          signalTurnDelivers: true,
        });

        yield* person("@bot-boss draft the agenda");
        yield* wait(2_000);
        yield* session("running");
        yield* person("@bot-analyst check the budget");
        expect(signals).toEqual([]);

        yield* wait(2_000);
        yield* session("ready");
        expect(bots(turns)).toEqual([BOSS_ID, ANALYST_ID]);
        expect(turns[1]?.input).toBe("Member: @bot-analyst check the budget");
      }),
    ),
  );

  it.effect("starts a new round when the answering bot cannot take the message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, signals, person, session, wait } = yield* harness;

        yield* person("@bot-boss draft the agenda");
        yield* wait(2_000);
        yield* session("running");
        yield* person("and the budget");
        expect(signals).toHaveLength(1);

        yield* wait(2_000);
        yield* session("ready");
        expect(bots(turns)).toEqual([BOSS_ID, BOSS_ID]);
        expect(turns[1]?.input).toBe("Member: and the budget");
      }),
    ),
  );

  it.effect("adds what two people write to the answering bot's turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { turns, signals, person, session, wait } = yield* makeHarness({
          signalTurnDelivers: true,
        });

        yield* person("@bot-boss draft the agenda");
        yield* wait(2_000);
        yield* session("running");
        yield* person("put lunch first");
        yield* person("and keep it short", { id: SECOND_PERSON_ID, name: "Ana" });
        expect(signals.map((signal) => signal.input)).toEqual([
          "Member: put lunch first",
          "Ana: and keep it short",
        ]);

        yield* wait(8_000);
        yield* session("ready");
        expect(bots(turns)).toEqual([BOSS_ID]);
      }),
    ),
  );
});
