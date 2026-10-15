import type { ThreadSilentRun } from "@otto/client-runtime/silent-run";
import { BotId, type OrchestrationLatestTurn, type OrchestrationMessage } from "@otto/contracts";
import { useEffect, useReducer } from "react";

import { BotActivityStatus } from "./bot-activity-status";
import type { BotActivity } from "./bot-activity-status.logic";
import { groupWorkingRows } from "./group-working-rows.logic";
import type { Bot } from "./types";

/**
 * A round starts up to eight seconds after the first message of a burst (two after the last), so
 * the bots show as waiting from the moment a message lands until then, with a little slack.
 */
const ROUND_START_MS = 10_000;

/** Before the round's first turn starts, its first bot simply thinks, as a DM's bot does. */
const ROUND_STARTING: BotActivity = { label: "Working", thinking: true };

/**
 * Otto: A group shows the same working row as a DM, at the end of the history: the bot answering
 * now, with its live step and own timer. Each reply lands above it, and the next bot in the round
 * takes the row when its turn starts; a bot with nothing to add just finishes.
 */
export function GroupWorkingRows({
  members,
  peopleNames,
  messages,
  respondingBotId,
  latestTurn,
  activity,
  subjectName,
  silentRun,
  working,
  showCurrent,
}: {
  readonly members: ReadonlyArray<Bot>;
  readonly peopleNames: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly respondingBotId: BotId | null;
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly activity: BotActivity;
  readonly subjectName: string | null;
  readonly silentRun: ThreadSilentRun | null;
  /** A bot turn is running or being sent. */
  readonly working: boolean;
  /** False while the answering bot waits on an approval or a question shown elsewhere. */
  readonly showCurrent: boolean;
}) {
  const last = messages.at(-1);
  const roundStartBy = last?.role === "user" ? Date.parse(last.createdAt) + ROUND_START_MS : 0;
  const [, recheck] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const wait = roundStartBy - Date.now();

    if (working || wait <= 0) return;
    const id = window.setTimeout(recheck, wait);

    return () => window.clearTimeout(id);
  }, [roundStartBy, working]);

  if (!working && Date.now() >= roundStartBy) return null;

  const rows = groupWorkingRows({
    bots: members.map((member) => ({ id: BotId.make(member.id), name: member.name })),
    peopleNames,
    messages,
    respondingBotId,
    turn: latestTurn
      ? { requestedAt: latestTurn.requestedAt, completedAt: latestTurn.completedAt }
      : null,
  });

  // Only the bot answering now shows, exactly as in a DM. Bots later in the round show once
  // their turn starts; listing them earlier promised replies a bot with nothing to add never sends.
  const [current] = rows;
  const bot = members.find((member) => member.id === current?.botId);

  if (!current || !bot || !showCurrent) return null;

  const started = current.state === "working" && latestTurn && !latestTurn.completedAt;

  return (
    <BotActivityStatus
      key={bot.id}
      bot={bot}
      activity={started ? activity : ROUND_STARTING}
      startedAt={
        // Otto: A finished turn's start would flash a stale time before the new turn lands.
        started ? (latestTurn.startedAt ?? latestTurn.requestedAt ?? null) : null
      }
      subjectName={started ? subjectName : null}
      silentRun={started ? silentRun : null}
      continuesReply={last?.role === "assistant" && last.respondingBotId === bot.id}
    />
  );
}
