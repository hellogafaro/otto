import type { ThreadSilentRun } from "@otto/client-runtime/silent-run";
import { BotId, type OrchestrationLatestTurn, type OrchestrationMessage } from "@otto/contracts";
import { useEffect, useReducer } from "react";

import { BotActivityStatus } from "./BotActivityStatus";
import type { BotActivity } from "./botActivityStatus.logic";
import { groupWorkingRows } from "./groupWorkingRows.logic";
import type { Bot } from "./types";

/**
 * A round starts up to eight seconds after the first message of a burst (two after the last), so
 * the bots show as waiting from the moment a message lands until then, with a little slack.
 */
const ROUND_START_MS = 10_000;

/**
 * Otto: Every bot answering a person's message in a group shows at once at the end of the history:
 * the one answering now with its live step and own timer, the ones after it waiting. Each reply
 * lands above the rows as it arrives, and a bot with nothing to add just leaves.
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

  return rows.map((row) => {
    const bot = members.find((member) => member.id === row.botId);

    if (!bot) return null;

    if (row.state === "waiting") {
      return (
        <BotActivityStatus key={row.botId} bot={bot} activity={activity} startedAt={null} waiting />
      );
    }

    return showCurrent ? (
      <BotActivityStatus
        key={row.botId}
        bot={bot}
        activity={activity}
        startedAt={latestTurn?.startedAt ?? latestTurn?.requestedAt ?? null}
        subjectName={subjectName}
        silentRun={silentRun}
        continuesReply={last?.role === "assistant" && last.respondingBotId === bot.id}
      />
    ) : null;
  });
}
