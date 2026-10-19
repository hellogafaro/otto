import { describe, expect, it } from "vite-plus/test";

import { isAppRouteHref, resolveInAppRoute, safeWebUrl } from "./app-routes";

const DESKTOP = "otto://app/#/chats/thread-1";

describe("resolveInAppRoute", () => {
  it("resolves a relative app path against the desktop origin", () => {
    expect(resolveInAppRoute("/tasks/task-1", DESKTOP)).toBe("/tasks/task-1");
    expect(resolveInAppRoute("/tasks/task-1?tab=activity", DESKTOP)).toBe(
      "/tasks/task-1?tab=activity",
    );
  });

  it("reads a hash route and an otto app URL", () => {
    expect(resolveInAppRoute("#/tasks/task-1", DESKTOP)).toBe("/tasks/task-1");
    expect(resolveInAppRoute("otto://app/tasks/task-1", DESKTOP)).toBe("/tasks/task-1");
    expect(resolveInAppRoute("otto-dev://app/#/library/file-1", DESKTOP)).toBe("/library/file-1");
  });

  it("leaves fragments, files, and other origins alone", () => {
    expect(resolveInAppRoute("#section", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("/Users/ada/project/src/main.ts", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("/tmp/notes.txt", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("https://example.com/tasks/task-1", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("otto://evil/tasks/task-1", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("mailto:ada@example.com", DESKTOP)).toBeNull();
    expect(resolveInAppRoute("javascript:alert(1)", DESKTOP)).toBeNull();
  });
});

describe("isAppRouteHref", () => {
  it("recognizes app hrefs and not file or web hrefs", () => {
    expect(isAppRouteHref("/tasks/task-1")).toBe(true);
    expect(isAppRouteHref("#/chats/thread-1")).toBe(true);
    expect(isAppRouteHref("otto://app/#/settings")).toBe(true);
    expect(isAppRouteHref("/Users/ada/main.ts")).toBe(false);
    expect(isAppRouteHref("https://example.com/docs")).toBe(false);
    expect(isAppRouteHref("#section")).toBe(false);
  });
});

describe("safeWebUrl", () => {
  it("accepts http(s) and rejects the app scheme", () => {
    expect(safeWebUrl("https://example.com/docs", DESKTOP)).toBe("https://example.com/docs");
    expect(safeWebUrl("otto://app/tasks/task-1", DESKTOP)).toBeNull();
    expect(safeWebUrl("/tasks/task-1", DESKTOP)).toBeNull();
  });
});
