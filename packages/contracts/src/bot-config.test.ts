import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BOT_INSTRUCTIONS_MAX_CHARS,
  BotCreatedPayload,
  BotUpdatedPayload,
} from "./orchestration.ts";

const decodeCreated = Schema.decodeUnknownSync(BotCreatedPayload);

const decodeUpdated = Schema.decodeUnknownSync(BotUpdatedPayload);

describe("BotCreatedPayload", () => {
  it("defaults old bot events to full access", () => {
    const bot = decodeCreated({
      botId: "bot-old",
      name: "Old bot",
      title: "Generalist",
      avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
      engine: null,
      sandbox: null,
      groupId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(bot.runtimeMode).toBe("full-access");
    expect(bot.label).toBeNull();
    expect(bot.description).toBeNull();
    expect(bot.disabledMcpServerIds).toEqual([]);
    expect(bot.voiceEnabled).toBe(false);
    expect(bot.instructions).toBeNull();
  });

  it("drops the retired personality tone from older bot events", () => {
    const bot = decodeCreated({
      botId: "bot-toned",
      name: "Toned bot",
      title: "Generalist",
      avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
      engine: null,
      sandbox: null,
      personalityTone: 80,
      groupId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const update = decodeUpdated({
      botId: "bot-toned",
      personalityTone: 20,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(bot).not.toHaveProperty("personalityTone");
    expect(update).not.toHaveProperty("personalityTone");
  });

  it("ignores the retired token cap on older bot events", () => {
    const bot = decodeCreated({
      botId: "bot-capped",
      name: "Capped bot",
      title: "Generalist",
      avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
      engine: null,
      sandbox: null,
      usageCap: { unit: "tokens", limit: 50_000 },
      groupId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(bot).not.toHaveProperty("usageCap");
  });

  it("accepts cloud sandbox providers on bot events", () => {
    for (const sandbox of ["local", "e2b", "daytona", "vercel", "railway", "boat"] as const) {
      expect(
        decodeCreated({
          botId: "bot-sandbox",
          name: "Sandbox bot",
          title: "Generalist",
          avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
          engine: null,
          sandbox,
          groupId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }).sandbox,
      ).toBe(sandbox);
    }
  });
});

describe("BotUpdatedPayload instructions", () => {
  it("accepts instructions up to the limit and rejects longer ones", () => {
    const at = "2026-01-02T00:00:00.000Z";
    const limit = "a".repeat(BOT_INSTRUCTIONS_MAX_CHARS);

    expect(decodeUpdated({ botId: "bot-1", instructions: limit, updatedAt: at }).instructions).toBe(
      limit,
    );
    expect(decodeUpdated({ botId: "bot-1", instructions: null, updatedAt: at }).instructions).toBe(
      null,
    );
    expect(() =>
      decodeUpdated({ botId: "bot-1", instructions: `${limit}a`, updatedAt: at }),
    ).toThrow();
  });
});
