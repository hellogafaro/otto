import { describe, expect, it } from "vite-plus/test";

import {
  activePageActions,
  pageActionForCommand,
  registerPageActions,
} from "./page-actions-registry";

const action = (id: string, shortcutCommand?: "item.archive") => ({
  id,
  title: id,
  searchTerms: [],
  ...(shortcutCommand ? { shortcutCommand } : {}),
  run: () => {},
});

describe("page actions registry", () => {
  it("publishes the newest owner's actions and falls back when it leaves", () => {
    const outer = Symbol("outer");
    const inner = Symbol("inner");
    const clearOuter = registerPageActions(outer, { label: "Tasks", actions: [action("new")] });

    const clearInner = registerPageActions(inner, {
      label: "This chat",
      actions: [action("archive", "item.archive")],
    });

    expect(activePageActions().label).toBe("This chat");
    expect(pageActionForCommand("item.archive")?.id).toBe("archive");
    clearInner();
    expect(activePageActions().label).toBe("Tasks");
    expect(pageActionForCommand("item.archive")).toBeNull();
    clearOuter();
    expect(activePageActions().actions).toEqual([]);
  });

  it("updates an owner's entry in place", () => {
    const owner = Symbol("owner");
    registerPageActions(owner, { label: "This chat", actions: [action("pin")] });
    const clear = registerPageActions(owner, { label: "This chat", actions: [action("unpin")] });

    expect(activePageActions().actions.map((entry) => entry.id)).toEqual(["unpin"]);
    clear();
    expect(activePageActions().actions).toEqual([]);
  });
});
