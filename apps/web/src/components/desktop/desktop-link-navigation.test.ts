import { describe, expect, it } from "vite-plus/test";

import {
  desktopHistoryShortcut,
  desktopLinkAction,
  type DesktopLinkClick,
} from "./desktop-link-navigation";

const BASE = "otto://app/#/chats/thread-1";

function click(overrides: Partial<DesktopLinkClick> = {}): DesktopLinkClick {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    platform: "MacIntel",
    ...overrides,
  };
}

function action(href: string, overrides: Partial<Parameters<typeof desktopLinkAction>[0]> = {}) {
  return desktopLinkAction({
    href,
    baseHref: BASE,
    target: "_blank",
    download: false,
    editable: false,
    electron: true,
    click: click(),
    ...overrides,
  });
}

describe("desktopLinkAction", () => {
  it("opens an in-app link in the current tab, and a new tab with ⌘ or a middle-click", () => {
    expect(action("/tasks/task-1")).toEqual({ type: "same-tab", route: "/tasks/task-1" });
    expect(action("/tasks/task-1", { click: click({ metaKey: true }) })).toEqual({
      type: "new-tab",
      route: "/tasks/task-1",
    });
    expect(action("/tasks/task-1", { click: click({ button: 1 }) })).toEqual({
      type: "new-tab",
      route: "/tasks/task-1",
    });
    expect(action("/tasks/task-1", { click: click({ platform: "Win32", ctrlKey: true }) })).toEqual(
      { type: "new-tab", route: "/tasks/task-1" },
    );
  });

  it("leaves a plain click on a hash-router link to the router", () => {
    expect(action("#/tasks/task-1", { target: "" })).toEqual({ type: "ignore" });
    expect(action("#/tasks/task-1", { target: "", click: click({ metaKey: true }) })).toEqual({
      type: "new-tab",
      route: "/tasks/task-1",
    });
  });

  it("opens an external web link in the system browser and ignores files", () => {
    expect(action("https://example.com/docs")).toEqual({
      type: "external",
      url: "https://example.com/docs",
    });
    expect(action("/Users/ada/project/src/main.ts")).toEqual({ type: "ignore" });
    expect(action("#section")).toEqual({ type: "ignore" });
    expect(action("https://example.com/docs", { electron: false })).toEqual({ type: "ignore" });
    expect(action("/tasks/task-1", { click: click({ shiftKey: true }) })).toEqual({
      type: "ignore",
    });
  });
});

describe("desktopHistoryShortcut", () => {
  it("goes back on ⌘ < and ⌘ [, and forward on ⌘ > and ⌘ ]", () => {
    expect(
      desktopHistoryShortcut(
        { key: "<", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("back");
    expect(
      desktopHistoryShortcut(
        { key: "<", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("back");
    expect(
      desktopHistoryShortcut(
        { key: ">", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("forward");
    expect(
      desktopHistoryShortcut(
        { key: "[", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("back");
    expect(
      desktopHistoryShortcut(
        { key: "]", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("forward");
    expect(
      desktopHistoryShortcut(
        { key: "[", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBeNull();
    expect(
      desktopHistoryShortcut(
        { key: "<", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Win32",
      ),
    ).toBe("back");
    expect(
      desktopHistoryShortcut(
        { key: "<", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBeNull();
    expect(
      desktopHistoryShortcut(
        { key: "ArrowLeft", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("back");
    expect(
      desktopHistoryShortcut(
        { key: "ArrowRight", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("forward");
    expect(
      desktopHistoryShortcut(
        { key: "ArrowLeft", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
        { typing: true },
      ),
    ).toBeNull();
    expect(
      desktopHistoryShortcut(
        { key: "ArrowLeft", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBeNull();
    expect(
      desktopHistoryShortcut(
        { key: "ArrowLeft", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Win32",
      ),
    ).toBeNull();
  });
});
