import { describe, expect, it } from "vite-plus/test";

import {
  parseRosterBotDragId,
  parseRosterGroupDropId,
  planRosterDrop,
  planRosterSectionDrop,
  moveRosterItemInOrder,
  rosterItemsForZone,
  buildRosterListItems,
  resolveRosterDropTarget,
  rosterBotDragId,
  rosterEntryId,
  rosterGroupDropId,
  rosterMarkerId,
  rosterZoneHasVisibleEntries,
} from "./rosterDrop.logic";

describe("roster drag ids", () => {
  it("keeps bot and group targets distinct", () => {
    expect(parseRosterBotDragId(rosterBotDragId("same"))).toBe("same");
    expect(parseRosterGroupDropId(rosterGroupDropId("same"))).toBe("same");
    expect(parseRosterBotDragId(rosterGroupDropId("same"))).toBeNull();
    expect(parseRosterGroupDropId(rosterBotDragId("same"))).toBeNull();
    expect(parseRosterBotDragId("bot:")).toBeNull();
    expect(parseRosterGroupDropId("group:")).toBeNull();
  });
});

describe("roster drag drop planning", () => {
  const otto = { kind: "bot" as const, id: "otto" };
  const mori = { kind: "bot" as const, id: "mori" };
  const crew = { kind: "group" as const, id: "crew" };

  const items = buildRosterListItems({
    pinnedItems: [otto],
    sections: [{ id: "news", name: "News", items: [crew], collapsed: false }],
    unassignedItems: [mori],
  });

  it("builds pinned, named-section, and unassigned targets including empty placeholders", () => {
    expect(items.map((item) => (item.kind === "marker" ? item.marker : item.item.id))).toEqual([
      "pinned-header",
      "otto",
      "pinned-divider",
      { kind: "section-header", sectionId: "news" },
      { kind: "section-placeholder", sectionId: "news" },
      "crew",
      "unassigned-header",
      "unassigned-placeholder",
      "mori",
    ]);
  });

  it("pins an unassigned bot dropped on the Pins label", () => {
    const target = resolveRosterDropTarget(
      items,
      rosterEntryId(mori),
      rosterMarkerId("pinned-header"),
      "news",
    );

    expect(target?.zone).toBe("pinned");
    expect(target?.order).toEqual([mori, otto]);
    expect(
      planRosterDrop({
        activeId: rosterEntryId(mori),
        from: "unassigned",
        target: target!,
        pinnedOrder: [otto],
      }),
    ).toEqual({ kind: "pin", item: mori, order: [mori, otto] });
  });

  it("unpins a bot dropped into Unassigned and keeps the named section as a move", () => {
    const unpin = resolveRosterDropTarget(
      items,
      rosterEntryId(otto),
      rosterMarkerId("unassigned-placeholder"),
      "news",
    );

    expect(unpin?.zone).toBe("unassigned");
    expect(
      planRosterDrop({
        activeId: rosterEntryId(otto),
        from: "pinned",
        target: unpin!,
        pinnedOrder: [otto],
      }),
    ).toEqual({
      kind: "move",
      item: otto,
      zone: "unassigned",
      order: [otto, mori],
      unpin: true,
    });
  });

  it("keeps a collapsed or emptied section droppable after its last item leaves", () => {
    const onlyCrew = buildRosterListItems({
      pinnedItems: [],
      sections: [{ id: "news", name: "News", items: [crew], collapsed: false }],
      unassignedItems: [],
    });

    expect(rosterZoneHasVisibleEntries(onlyCrew, { sectionId: "news" }, crew)).toBe(false);

    const target = resolveRosterDropTarget(
      onlyCrew,
      rosterEntryId(crew),
      rosterMarkerId({ kind: "section-placeholder", sectionId: "news" }),
      "news",
    );

    expect(target?.zone).toEqual({ sectionId: "news" });
    expect(target?.order).toEqual([crew]);
  });

  it("reorders named sections onto Unassigned without touching group membership", () => {
    expect(
      planRosterSectionDrop({
        sectionIds: ["news", "ops"],
        activeSectionId: "news",
        overId: rosterMarkerId("unassigned-header"),
      }),
    ).toEqual({ kind: "reorder-section", fromIndex: 0, toIndex: 1 });
  });

  it("does not plan a no-op pin reorder", () => {
    const target = resolveRosterDropTarget(items, rosterEntryId(otto), rosterEntryId(otto), "news");

    expect(
      planRosterDrop({
        activeId: rosterEntryId(otto),
        from: "pinned",
        target: target!,
        pinnedOrder: [otto],
      }).kind,
    ).toBe("none");
  });

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

  it("resolves the visible order for each roster zone", () => {
    const layout = {
      pinnedItems: [otto],
      sections: [{ id: "news", items: [mori] }],
      unassignedItems: [crew],
    };

    expect(rosterItemsForZone("pinned", layout)).toEqual([otto]);
    expect(rosterItemsForZone("unassigned", layout)).toEqual([crew]);
    expect(rosterItemsForZone({ sectionId: "news" }, layout)).toEqual([mori]);
    expect(rosterItemsForZone({ sectionId: "missing" }, layout)).toEqual([]);
  });
});
