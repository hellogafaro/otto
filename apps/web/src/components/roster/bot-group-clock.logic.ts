import type { OrchestrationMessage } from "@otto/contracts";

import type { BotTraceStep, BotTurnTrace } from "./bot-turn-trace.logic";

interface ClockMessage {
  readonly id: string;
  readonly role: OrchestrationMessage["role"];
  readonly turnId: string | null;
}

/** A group's live clock: when its running turn started and the work its earlier turns did. */
export interface GroupLiveClock {
  readonly startedAt: number;
  readonly baseMs: number;
}

/**
 * Otto: One clock per group. A run of replies from one bot (a group) carries a single
 * "Worked for" line on its first reply: the work of every turn in the group added up, with
 * their steps in order, so a continuation counts on instead of starting a second clock.
 * `skipTurnId` leaves out the running turn, whose time the live header counts itself.
 */
export function buildGroupClocks(
  entries: ReadonlyArray<{ readonly message: ClockMessage; readonly startsGroup: boolean }>,
  traces: ReadonlyMap<string, BotTurnTrace>,
  skipTurnId: string | null = null,
): ReadonlyMap<string, BotTurnTrace> {
  const clocks = new Map<string, BotTurnTrace>();
  let head: string | null = null;
  let turns = new Set<string>();

  for (const { message, startsGroup } of entries) {
    if (message.role !== "assistant") {
      head = null;
      continue;
    }

    if (startsGroup || head === null) {
      head = message.id;
      turns = new Set();
    }

    const turnId = message.turnId;

    if (!turnId || turnId === skipTurnId || turns.has(turnId)) continue;
    turns.add(turnId);
    const trace = traces.get(turnId);

    if (!trace) continue;
    const previous = clocks.get(head);

    // Step ids repeat across turns ("thought:reply"), so each is scoped to its turn.
    const steps: BotTraceStep[] = trace.steps.map((step) => ({
      ...step,
      id: `${turnId}:${step.id}`,
    }));

    clocks.set(
      head,
      previous
        ? { workedMs: previous.workedMs + trace.workedMs, steps: [...previous.steps, ...steps] }
        : { workedMs: trace.workedMs, steps },
    );
  }

  return clocks;
}

/** The first reply of the last group, when the transcript ends on that bot's group. */
export function lastGroupHead(
  entries: ReadonlyArray<{ readonly message: ClockMessage; readonly startsGroup: boolean }>,
): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (!entry || entry.message.role !== "assistant") return null;

    if (entry.startsGroup) return entry.message.id;
  }

  return null;
}

/**
 * The live clock for the transcript's trailing group, when the running turn continues it: it
 * counts from the running turn's start on top of the work the group's earlier turns did.
 */
export function liveGroupClock(input: {
  readonly entries: ReadonlyArray<{
    readonly message: ClockMessage;
    readonly startsGroup: boolean;
  }>;
  readonly traces: ReadonlyMap<string, BotTurnTrace>;
  readonly turn: {
    readonly turnId: string;
    readonly state: string;
    readonly startedAt: string | null;
    readonly requestedAt: string;
  } | null;
}): { readonly headId: string; readonly clock: GroupLiveClock } | null {
  const turn = input.turn;

  if (!turn || turn.state !== "running") return null;
  const headId = lastGroupHead(input.entries);

  if (!headId) return null;

  const startedAt = Date.parse(turn.startedAt ?? turn.requestedAt);

  if (!Number.isFinite(startedAt)) return null;
  const earlier = buildGroupClocks(input.entries, input.traces, turn.turnId).get(headId);

  return { headId, clock: { startedAt, baseMs: earlier?.workedMs ?? 0 } };
}
