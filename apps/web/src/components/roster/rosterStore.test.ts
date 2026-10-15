import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { flattenPersistedSections, reorderVisibleRosterBots, useRosterStore } from "./rosterStore";
import type { Bot, Group } from "./types";

function bot(id: string, archivedAt: string | null = null): Bot {
  return {
    id,
    name: id,
    title: "Assistant",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
    engine: null,
    sandbox: null,
    runtimeMode: "full-access",
    voiceEnabled: false,
    groupId: null,
    pinned: false,
    archivedAt,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function group(id: string): Group {
  return {
    id,
    name: id,
    bossBotId: null,
    members: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const initialState = useRosterStore.getState();

beforeEach(() => {
  useRosterStore.setState({
    bots: [],
    groups: [],
    lastMessageByBotId: {},
    selectedBotId: null,
    pinnedItems: [],
    unassignedItems: [],
    environmentId: null,
  });
});

afterEach(() => {
  useRosterStore.setState({
    bots: initialState.bots,
    groups: initialState.groups,
    lastMessageByBotId: initialState.lastMessageByBotId,
    selectedBotId: initialState.selectedBotId,
    pinnedItems: initialState.pinnedItems,
    unassignedItems: initialState.unassignedItems,
    environmentId: initialState.environmentId,
  });

  if (typeof window !== "undefined") {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("otto:roster:v1")) window.localStorage.removeItem(key);
    }
  }
});

describe("bot selection", () => {
  it("selects the first available bot when a roster arrives without the active bot", () => {
    useRosterStore.setState({ selectedBotId: "missing" });
    useRosterStore.getState().replaceRoster({
      environmentId: "env-one",
      bots: [bot("archived", "2026-08-20T00:00:00.000Z"), bot("otto")],
      groups: [],
    });

    expect(useRosterStore.getState().selectedBotId).toBe("otto");
  });

  it("updates a bot's roster preview after a local message", () => {
    const message = { text: "Ship it", at: "2026-08-20T00:00:00.000Z" };

    useRosterStore.getState().recordLastMessage("otto", message);

    expect(useRosterStore.getState().lastMessageByBotId.otto).toEqual(message);
  });
});

describe("bot order", () => {
  it("moves a bot downward instead of leaving it in place", () => {
    const bots = [bot("one"), bot("two"), bot("three")];

    const reordered = reorderVisibleRosterBots(bots, ["one", "two", "three"], 0, 2);

    expect(reordered?.map((entry) => entry.id)).toEqual(["two", "three", "one"]);
  });

  it("moves a bot upward", () => {
    const bots = [bot("one"), bot("two"), bot("three")];

    const reordered = reorderVisibleRosterBots(bots, ["one", "two", "three"], 2, 0);

    expect(reordered?.map((entry) => entry.id)).toEqual(["three", "one", "two"]);
  });

  it("keeps filtered bots in place", () => {
    const bots = [bot("one"), bot("hidden"), bot("two"), bot("three")];

    const reordered = reorderVisibleRosterBots(bots, ["one", "two", "three"], 2, 0);

    expect(reordered?.map((entry) => entry.id)).toEqual(["three", "hidden", "one", "two"]);
  });
});

describe("roster pins", () => {
  it("pins bots and groups as separate quick-launch items", () => {
    useRosterStore.getState().setItemPinned({ kind: "bot", id: "one" }, true);
    useRosterStore.getState().setItemPinned({ kind: "group", id: "crew" }, true);
    useRosterStore.getState().setItemPinned({ kind: "bot", id: "one" }, false);

    expect(useRosterStore.getState().pinnedItems).toEqual([{ kind: "group", id: "crew" }]);
  });

  it("nudges bots in the main list without changing group membership", () => {
    useRosterStore.setState({
      bots: [bot("otto"), bot("mori"), bot("scout")],
      groups: [group("crew")],
      unassignedItems: [
        { kind: "bot", id: "otto" },
        { kind: "bot", id: "mori" },
        { kind: "bot", id: "scout" },
      ],
    });

    useRosterStore.getState().nudgeRosterItem({ kind: "bot", id: "mori" }, -1);

    expect(useRosterStore.getState().unassignedItems.map((item) => item.id)).toEqual([
      "mori",
      "otto",
      "scout",
      "crew",
    ]);
    expect(useRosterStore.getState().groups[0]?.members).toEqual([]);
  });

  it("nudges newly live unassigned items omitted from the saved order", () => {
    useRosterStore.setState({
      bots: [bot("otto"), bot("mori")],
      groups: [group("crew")],
      unassignedItems: [{ kind: "bot", id: "otto" }],
    });

    useRosterStore.getState().nudgeRosterItem({ kind: "group", id: "crew" }, -1);
    expect(useRosterStore.getState().unassignedItems).toEqual([
      { kind: "group", id: "crew" },
      { kind: "bot", id: "otto" },
      { kind: "bot", id: "mori" },
    ]);

    useRosterStore.getState().nudgeRosterItem({ kind: "bot", id: "mori" }, -1);
    expect(useRosterStore.getState().unassignedItems).toEqual([
      { kind: "group", id: "crew" },
      { kind: "bot", id: "mori" },
      { kind: "bot", id: "otto" },
    ]);
  });

  it("flattens legacy sections into the main list in their saved order", () => {
    const migrated = flattenPersistedSections({
      sections: [
        {
          id: "first",
          name: "First",
          botIds: ["mori"],
          groupIds: ["crew"],
          items: [
            { kind: "group", id: "crew" },
            { kind: "bot", id: "mori" },
          ],
          collapsed: true,
        },
      ],
      unassignedItems: [
        { kind: "bot", id: "mori" },
        { kind: "bot", id: "otto" },
      ],
    });

    expect(migrated?.sections).toEqual([]);
    expect(migrated?.unassignedItems).toEqual([
      { kind: "group", id: "crew" },
      { kind: "bot", id: "mori" },
      { kind: "bot", id: "otto" },
    ]);
  });
});
