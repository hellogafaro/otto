import { describe, expect, it } from "vite-plus/test";

import {
  DESKTOP_TAB_HISTORY_LIMIT,
  canGoBack,
  canGoForward,
  recordTabHistory,
  stepTabHistory,
  tabHistoryOf,
} from "./desktop-tab-history";

describe("tab history", () => {
  it("starts at the current page when a saved tab has no history", () => {
    const history = tabHistoryOf({ href: "/chats/thread-1" });

    expect(history).toEqual({ entries: ["/chats/thread-1"], index: 0 });
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);
  });

  it("pushes a navigation and drops the forward stack", () => {
    const start = tabHistoryOf({ href: "/a", history: ["/a", "/b", "/c"], index: 1 });
    const next = recordTabHistory(start, "/d");

    expect(next).toEqual({ entries: ["/a", "/b", "/d"], index: 2 });
    expect(canGoBack(next)).toBe(true);
    expect(canGoForward(next)).toBe(false);
  });

  it("does not record the page the tab is already on", () => {
    const current = tabHistoryOf({ href: "/b", history: ["/a", "/b"], index: 1 });

    expect(recordTabHistory(current, "/b")).toBe(current);
  });

  it("steps back and forward without leaving the stack", () => {
    const history = tabHistoryOf({ href: "/b", history: ["/a", "/b", "/c"], index: 1 });

    expect(stepTabHistory(history, "back")).toEqual({
      entries: ["/a", "/b", "/c"],
      index: 0,
    });
    expect(stepTabHistory(history, "forward")).toEqual({
      entries: ["/a", "/b", "/c"],
      index: 2,
    });
    expect(stepTabHistory({ entries: ["/a"], index: 0 }, "back")).toBeNull();
    expect(stepTabHistory({ entries: ["/a"], index: 0 }, "forward")).toBeNull();
  });

  it("keeps only the newest entries", () => {
    let history = tabHistoryOf({ href: "/0" });

    for (let index = 1; index <= DESKTOP_TAB_HISTORY_LIMIT + 5; index += 1) {
      history = recordTabHistory(history, `/${index}`);
    }

    expect(history.entries).toHaveLength(DESKTOP_TAB_HISTORY_LIMIT);
    expect(history.entries[0]).toBe("/6");
    expect(history.index).toBe(DESKTOP_TAB_HISTORY_LIMIT - 1);
  });
});
