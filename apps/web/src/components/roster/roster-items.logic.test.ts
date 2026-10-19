import { describe, expect, it } from "vite-plus/test";

import { isRosterPinnable, moveRosterItemInOrder, type RosterItemRef } from "./roster-items.logic";

const otto: RosterItemRef = { kind: "bot", id: "otto" };

const mori: RosterItemRef = { kind: "bot", id: "mori" };

const crew: RosterItemRef = { kind: "group", id: "crew" };

describe("roster item order", () => {
  it("nudges an item one slot without wrapping past the ends", () => {
    const order = [otto, mori, crew];
    expect(moveRosterItemInOrder(order, mori, -1)?.map((item) => item.id)).toEqual([
      "mori",
      "otto",
      "crew",
    ]);
    expect(moveRosterItemInOrder(order, otto, -1)).toBeNull();
    expect(moveRosterItemInOrder(order, crew, 1)).toBeNull();
  });

  it("lets groups and chats pin, and not bots", () => {
    expect(isRosterPinnable(crew)).toBe(true);
    expect(isRosterPinnable({ kind: "chat", id: "thread-1" })).toBe(true);
    expect(isRosterPinnable(otto)).toBe(false);
  });
});
