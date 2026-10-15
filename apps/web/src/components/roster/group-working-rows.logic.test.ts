import { BotId } from "@otto/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupWorkingRows } from "./group-working-rows.logic";

const axo = { id: BotId.make("bot-axo"), name: "Axo" };

const capy = { id: BotId.make("bot-capy"), name: "Capy" };

const ivy = { id: BotId.make("bot-ivy"), name: "Ivy" };

const ask = (text: string, createdAt = "2026-10-15T08:00:00.000Z") => ({
  role: "user" as const,
  text,
  createdAt,
  respondingBotId: null,
});

const reply = (
  bot: { readonly id: BotId },
  text: string,
  createdAt = "2026-10-15T08:00:05.000Z",
) => ({
  role: "assistant" as const,
  text,
  createdAt,
  respondingBotId: bot.id,
});

const running = { requestedAt: "2026-10-15T08:00:01.000Z", completedAt: null };

const rows = (
  messages: Parameters<typeof groupWorkingRows>[0]["messages"],
  respondingBotId: BotId | null,
  turn: Parameters<typeof groupWorkingRows>[0]["turn"] = running,
) =>
  groupWorkingRows({
    bots: [axo, capy, ivy],
    peopleNames: ["Ana Lopez"],
    messages,
    respondingBotId,
    turn,
  });

describe("groupWorkingRows", () => {
  it("shows every bot of the round at once, the answering one first", () => {
    expect(rows([ask("whos here?")], axo.id)).toEqual([
      { botId: axo.id, state: "working" },
      { botId: capy.id, state: "waiting" },
      { botId: ivy.id, state: "waiting" },
    ]);
  });

  it("drops bots that replied or passed before the one answering now", () => {
    expect(rows([ask("whos here?"), reply(axo, "Everyone is here")], ivy.id)).toEqual([
      { botId: ivy.id, state: "working" },
    ]);
  });

  it("keeps only the mentioned bots and the bots a reply hands off to", () => {
    expect(
      rows([ask("@Capy what is 5 plus 5?"), reply(capy, "@Ivy can you check?")], ivy.id),
    ).toEqual([{ botId: ivy.id, state: "working" }]);
  });

  it("waits on every bot while the previous round's bot is still the latest turn", () => {
    expect(
      rows([ask("hello", "2026-10-15T09:00:00.000Z")], ivy.id, {
        requestedAt: "2026-10-15T08:00:01.000Z",
        completedAt: "2026-10-15T08:00:06.000Z",
      }),
    ).toEqual([
      { botId: axo.id, state: "waiting" },
      { botId: capy.id, state: "waiting" },
      { botId: ivy.id, state: "waiting" },
    ]);
  });

  it("keeps only the answering bot when a message joins its turn", () => {
    const messages = [ask("whos here?"), ask("wait a minute", "2026-10-15T08:00:03.000Z")];

    expect(rows(messages, axo.id)).toEqual([{ botId: axo.id, state: "working" }]);
    expect(
      rows([...messages, reply(axo, "Okay, tell me when.", "2026-10-15T08:00:06.000Z")], axo.id, {
        ...running,
        completedAt: "2026-10-15T08:00:06.000Z",
      }),
    ).toEqual([]);
  });

  it("asks the other bots next when a message joining a turn says @everyone", () => {
    expect(
      rows([ask("@Axo plan it"), ask("@everyone add yours", "2026-10-15T08:00:03.000Z")], axo.id),
    ).toEqual([
      { botId: axo.id, state: "working" },
      { botId: capy.id, state: "waiting" },
      { botId: ivy.id, state: "waiting" },
    ]);
  });

  it("holds a message for another bot until the answering bot finishes", () => {
    expect(
      rows([ask("@Axo plan it"), ask("@Ivy check the budget", "2026-10-15T08:00:03.000Z")], axo.id),
    ).toEqual([
      { botId: axo.id, state: "working" },
      { botId: ivy.id, state: "waiting" },
    ]);
  });

  it("shows no rows when a message only mentions a person", () => {
    expect(rows([ask("@Ana Lopez can you check this?")], null)).toEqual([]);
  });
});
