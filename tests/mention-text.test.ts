import { describe, expect, it } from "vitest";
import {
  mentionUserIds,
  parseMentions,
  serializeMention,
} from "../apps/web/src/lib/mention-text";

describe("stored mention grammar", () => {
  it("round trips human labels and identifiers through display and notification parsing", () => {
    for (const label of [
      "Alice ] Doe",
      "[Bob]",
      "Back\\slash",
      "Line\nbreak",
      "Literal\\n",
      "普通名字",
    ]) {
      const item = { type: "user" as const, id: "user:123)percent%", label };
      const text = `Hi ${serializeMention(item)}!`;
      expect(parseMentions(text)).toEqual([
        { ...item, index: 3, length: text.length - 4 },
      ]);
      expect(mentionUserIds(text)).toEqual([item.id]);
    }
  });
  it("reads existing tokens and deduplicates users without counting other domains", () => {
    expect(
      mentionUserIds(
        "@[Alice](user:abc) @[Alice](user:abc) @[Agent](agent:def)",
      ),
    ).toEqual(["abc"]);
    expect(parseMentions("plain @text malformed @[bad](unknown:1)")).toEqual(
      [],
    );
  });
});
