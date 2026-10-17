import { describe, expect, it } from "vite-plus/test";

import { botMentionPattern } from "./skill-inline-text";

describe("botMentionPattern", () => {
  it("matches @Name for roster bots only, at word starts", () => {
    const pattern = botMentionPattern(["Juno", "Nova"]);
    const text = "@juno please ask (@Nova), not @someone, email@Nova or @Novak";

    expect([...text.matchAll(pattern!)].map((match) => match[2])).toEqual(["juno", "Nova"]);
  });

  it("is null without bots", () => {
    expect(botMentionPattern([])).toBeNull();
  });
});
