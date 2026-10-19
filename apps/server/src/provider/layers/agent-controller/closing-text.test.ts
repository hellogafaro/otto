import { describe, expect, it } from "vite-plus/test";

import { withheldClosingText } from "./closing-text.ts";

describe("withheldClosingText", () => {
  it("keeps a closing answer that was written after a progress post", () => {
    expect(
      withheldClosingText({
        posted: true,
        text: " The card now matches the composer. ",
        lastPostedText: "I'll match the card to the composer column.",
      }),
    ).toBe("The card now matches the composer.");
  });

  it("drops a closing answer that repeats the last post", () => {
    expect(
      withheldClosingText({
        posted: true,
        text: "I'll match the card to the composer column.",
        lastPostedText: " I'll match the card to the composer column. ",
      }),
    ).toBeNull();
  });

  it("drops a pass and text from a turn that never posted", () => {
    expect(
      withheldClosingText({ posted: true, text: "NO_REPLY", lastPostedText: null }),
    ).toBeNull();
    expect(
      withheldClosingText({
        posted: false,
        text: "This is posted by the normal path.",
        lastPostedText: null,
      }),
    ).toBeNull();
    expect(withheldClosingText({ posted: true, text: "  ", lastPostedText: null })).toBeNull();
  });
});
