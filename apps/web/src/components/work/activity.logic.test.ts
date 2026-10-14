import { describe, expect, it } from "vite-plus/test";

import { type MentionTarget, parseActivityContent, toActivityContent } from "./activity.logic";

const targets: ReadonlyArray<MentionTarget> = [
  { type: "person", id: "session-ana", label: "Ana Lopez" },
  { type: "person", id: "session-an", label: "Ana" },
  { type: "bot", id: "bot-nova", label: "Nova" },
];

describe("toActivityContent", () => {
  it("tags known people and bots, preferring the longest name", () => {
    expect(toActivityContent("@Ana Lopez and @nova, take a look", targets)).toBe(
      '<mention type="person" id="session-ana">Ana Lopez</mention> and ' +
        '<mention type="bot" id="bot-nova">Nova</mention>, take a look',
    );
  });

  it("tags a bot picked by id", () => {
    expect(toActivityContent("ask @bot:bot-nova", targets)).toBe(
      'ask <mention type="bot" id="bot-nova">Nova</mention>',
    );
  });

  it("escapes typed markup and leaves unknown names and emails alone", () => {
    expect(
      toActivityContent('<mention type="bot" id="x">X</mention> ana@Nova.dev @Zed', targets),
    ).toBe('&lt;mention type="bot" id="x"&gt;X&lt;/mention&gt; ana@Nova.dev @Zed');
  });
});

describe("parseActivityContent", () => {
  it("round-trips text and mentions", () => {
    const content = toActivityContent("Hi @Ana & <team>, ping @Nova", targets);

    expect(parseActivityContent(content)).toEqual([
      expect.objectContaining({ type: "text", text: "Hi " }),
      expect.objectContaining({
        type: "mention",
        mentionType: "person",
        id: "session-an",
        label: "Ana",
      }),
      expect.objectContaining({ type: "text", text: " & <team>, ping " }),
      expect.objectContaining({
        type: "mention",
        mentionType: "bot",
        id: "bot-nova",
        label: "Nova",
      }),
    ]);
  });
});
