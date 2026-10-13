import * as NodeCrypto from "node:crypto";
import {
  type BotId,
  type ChatAttachment,
  CommandId,
  isGroupBotMember,
  isGroupPersonMember,
  type MessageId,
  type OrchestrationEvent,
  type ThreadId,
} from "@otto/contracts";
import { makeDrainableWorker } from "@otto/shared/DrainableWorker";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  type GroupBot,
  type GroupTurnReason,
  groupMentions,
  groupRound,
  groupTurnNote,
} from "../groupResponder.ts";
import { forkParked } from "../../serverActivation.ts";
import { GroupRoundReactor, type GroupRoundReactorShape } from "../Services/GroupRoundReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

/** A round starts this long after the latest person message... */
export const GROUP_QUIET_WINDOW = Duration.seconds(2);

/** ...but never later than this after the first one. */
export const GROUP_MAX_WAIT = Duration.seconds(8);

/** Bot-to-bot @mentions one round may follow. */
export const GROUP_MAX_HANDOFFS = 3;

/** A dispatched turn that never starts is given up after this. */
export const GROUP_TURN_START_TIMEOUT = Duration.minutes(1);

interface PersonMessage {
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

interface Round {
  /** Person messages waiting for the next round. */
  batch: PersonMessage[];
  firstAt: number;
  timer: number;
  flushDue: boolean;
  /** Messages the next bot receives; later bots already have them in the history. */
  carry: PersonMessage[];
  anchor: MessageId | null;
  bots: ReadonlyArray<GroupBot>;
  reason: GroupTurnReason;
  queue: Array<{ readonly botId: BotId; readonly reason: GroupTurnReason; readonly from?: string }>;
  running: {
    readonly bot: GroupBot;
    readonly turn: number;
    active: boolean;
    live: boolean;
  } | null;
  turns: number;
  reply: string;
  answered: boolean;
  handoffs: number;
}

type Input =
  | { readonly type: "event"; readonly event: OrchestrationEvent }
  | { readonly type: "flush"; readonly threadId: ThreadId; readonly timer: number }
  | { readonly type: "stall"; readonly threadId: ThreadId; readonly turn: number };

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery;
  const scope = yield* Effect.scope;
  const rounds = new Map<ThreadId, Round>();
  let worker: { readonly enqueue: (input: Input) => Effect.Effect<void> } | undefined;

  const later = (delay: Duration.Input, input: Input) =>
    Effect.sleep(delay).pipe(
      Effect.andThen(Effect.suspend(() => worker?.enqueue(input) ?? Effect.void)),
      Effect.forkIn(scope),
      Effect.asVoid,
    );

  const roundFor = (threadId: ThreadId) => {
    const existing = rounds.get(threadId);

    if (existing) return existing;

    const round: Round = {
      batch: [],
      firstAt: 0,
      timer: 0,
      flushDue: false,
      carry: [],
      anchor: null,
      bots: [],
      reason: "plain",
      queue: [],
      running: null,
      turns: 0,
      reply: "",
      answered: false,
      handoffs: 0,
    };

    rounds.set(threadId, round);

    return round;
  };

  const next = Effect.fnUntraced(function* (threadId: ThreadId, round: Round) {
    for (let item = round.queue.shift(); item; item = round.queue.shift()) {
      const bot = round.bots.find((candidate) => candidate.id === item!.botId);

      if (!bot || round.anchor === null) continue;

      const reason =
        item.reason === "plain" &&
        !round.answered &&
        !round.queue.some((queued) => queued.reason === "plain")
          ? "fallback"
          : item.reason;

      const carried = round.carry.map((message) => message.text).join("\n\n");
      const note = groupTurnNote(reason, item.from);

      const input =
        round.carry.length === 0
          ? note
          : reason === "plain" || reason === "mentioned"
            ? carried
            : `${carried}\n\n${note}`;

      const dispatched = yield* engine
        .dispatch({
          type: "thread.group-turn.start",
          commandId: CommandId.make(`group-turn:${NodeCrypto.randomUUID()}`),
          threadId,
          botId: bot.id,
          messageId: round.anchor,
          input,
          attachments: round.carry.flatMap((message) => message.attachments),
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("group round skipped a bot", { threadId, botId: bot.id, cause }).pipe(
              Effect.as(false),
            ),
          ),
        );

      if (!dispatched) continue;
      round.carry = [];
      round.turns += 1;
      round.running = { bot, turn: round.turns, active: false, live: false };
      round.reply = "";
      yield* later(GROUP_TURN_START_TIMEOUT, { type: "stall", threadId, turn: round.turns });

      return;
    }

    if (round.batch.length === 0) rounds.delete(threadId);
  });

  const startRound = Effect.fnUntraced(function* (threadId: ThreadId, round: Round) {
    const readModel = yield* projection.getCommandReadModel();
    const thread = readModel.threads.find((candidate) => candidate.id === threadId);
    const group = readModel.groups.find((candidate) => candidate.id === thread?.groupId);

    const bots = (group?.members ?? []).filter(isGroupBotMember).flatMap((member) => {
      const bot = readModel.bots.find((candidate) => candidate.id === member.botId);

      return bot && bot.archivedAt === null ? [{ id: bot.id, name: bot.name }] : [];
    });

    const batch = round.batch;

    const peopleNames = (group?.members ?? [])
      .filter(isGroupPersonMember)
      .map((person) => person.displayName);

    const plan = groupRound(bots, batch.map((message) => message.text).join("\n\n"), peopleNames);
    round.batch = [];
    round.flushDue = false;
    round.carry = batch;
    round.anchor = batch.at(-1)?.messageId ?? null;
    round.bots = bots;
    round.reason = plan.reason;
    round.queue = plan.botIds.map((botId) => ({ botId, reason: plan.reason }));
    round.answered = false;
    round.handoffs = 0;
    yield* next(threadId, round);
  });

  const endTurn = Effect.fnUntraced(function* (threadId: ThreadId, round: Round, stopped: boolean) {
    const finished = round.running;
    const reply = round.reply.trim();
    round.running = null;
    round.reply = "";

    if (stopped) round.queue = [];

    if (finished && reply.length > 0 && !stopped) {
      round.answered = true;
      const others = round.bots.filter((bot) => bot.id !== finished.bot.id);

      for (const botId of groupMentions(others, reply)) {
        if (round.handoffs >= GROUP_MAX_HANDOFFS) break;

        if (round.queue.some((queued) => queued.botId === botId)) continue;
        round.queue.push({ botId, reason: "handoff", from: finished.bot.name });
        round.handoffs += 1;
      }
    }

    if (round.batch.length > 0) {
      round.queue = [];

      if (round.flushDue) yield* startRound(threadId, round);

      return;
    }

    yield* next(threadId, round);
  });

  const onPersonMessage = Effect.fnUntraced(function* (threadId: ThreadId, message: PersonMessage) {
    const thread = yield* projection.getThreadShellById(threadId);

    if (Option.isNone(thread) || thread.value.groupId === null) return;
    const round = roundFor(threadId);
    const now = yield* Clock.currentTimeMillis;

    if (round.batch.length === 0) round.firstAt = now;
    round.batch.push(message);
    // A newer message replaces the bots still waiting; the one answering finishes.
    round.queue = [];
    round.flushDue = false;
    round.timer += 1;

    const delay = Math.max(
      0,
      Math.min(
        Duration.toMillis(GROUP_QUIET_WINDOW),
        round.firstAt + Duration.toMillis(GROUP_MAX_WAIT) - now,
      ),
    );

    yield* later(delay, { type: "flush", threadId, timer: round.timer });
  });

  const process = Effect.fnUntraced(function* (input: Input) {
    if (input.type === "flush") {
      const round = rounds.get(input.threadId);

      if (!round || round.timer !== input.timer || round.batch.length === 0) return;
      round.flushDue = true;

      if (round.running === null) yield* startRound(input.threadId, round);

      return;
    }

    if (input.type === "stall") {
      const round = rounds.get(input.threadId);

      if (round?.running?.turn === input.turn && !round.running.active) {
        yield* endTurn(input.threadId, round, false);
      }

      return;
    }

    const event = input.event;

    if (event.type === "thread.message-sent") {
      const { payload } = event;

      if (payload.role === "user" && payload.authorPersonId != null) {
        yield* onPersonMessage(payload.threadId, {
          messageId: payload.messageId,
          // Several people can share a group, so each bot is told who wrote what.
          text: payload.authorDisplayName
            ? `${payload.authorDisplayName}: ${payload.text}`
            : payload.text,
          attachments: payload.attachments ?? [],
        });

        return;
      }

      const round = rounds.get(payload.threadId);

      if (payload.role !== "assistant" || !round?.running) return;

      if (payload.streaming) round.reply += payload.text;
      else if (payload.text.length > 0) round.reply = payload.text;

      return;
    }

    if (event.type !== "thread.session-set") return;
    const round = rounds.get(event.payload.threadId);
    const running = round?.running;

    if (!round || !running) return;
    const status = event.payload.session.status;

    if (status === "starting" || status === "running") {
      running.active = true;
      running.live ||= status === "running";

      return;
    }

    // Switching to this bot's session stops the previous one first; only the turn's own end counts.
    if (status === "error" || (running.live && status !== "idle")) {
      yield* endTurn(
        event.payload.threadId,
        round,
        status === "interrupted" || status === "stopped",
      );
    }
  });

  const drainable = yield* makeDrainableWorker((input: Input) =>
    process(input).pipe(
      Effect.catchCause((cause) => Effect.logWarning("group round failed", { cause })),
    ),
  );

  worker = drainable;

  const start: GroupRoundReactorShape["start"] = Effect.fn("GroupRoundReactor.start")(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        event.type === "thread.message-sent" || event.type === "thread.session-set"
          ? drainable.enqueue({ type: "event", event })
          : Effect.void,
      ),
    );
  });

  return { start, drain: drainable.drain } satisfies GroupRoundReactorShape;
});

export const GroupRoundReactorLive = Layer.effect(GroupRoundReactor, make);
