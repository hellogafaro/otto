import { describe, expect, it } from "vite-plus/test";
import { resolvePageLabel, resolveWindowTitle } from "./window-title";

describe("window titles", () => {
  it.each([
    ["/", "Home"],
    ["/tasks", "Tasks"],
    ["/tasks/", "Tasks"],
    ["/tasks/task-1", "Tasks"],
    ["/projects/project-1", "Projects"],
    ["/routines/routine-1", "Routines"],
    ["/library/file-1", "Library"],
    ["/notifications", "Notifications"],
    ["/settings/bots/bot-1", "Settings"],
    ["/customize/apps", "Customize"],
    ["/plugins", "Apps"],
    ["/login", "Sign in"],
    ["/setup", "Set up"],
    ["/reset-password", "Reset"],
    ["/invite/invitation-1", "Sign in"],
    ["/chats/chat-1", "Chats"],
    ["/bots/bot-1", "Chats"],
    ["/tasks-other", "Chats"],
  ])("names %s", (pathname, label) => {
    expect(resolvePageLabel(pathname)).toBe(label);
    expect(resolveWindowTitle({ pageLabel: label, appName: "Otto" })).toBe(`${label} | Otto`);
  });

  it("uses a detail page title when available", () => {
    expect(
      resolveWindowTitle({ pageTitle: " Fix login ", pageLabel: "Tasks", appName: "Otto" }),
    ).toBe("Fix login | Otto");
  });

  it("falls back to the page label while a detail title is unavailable", () => {
    expect(resolveWindowTitle({ pageTitle: "  ", pageLabel: "Tasks", appName: "Otto" })).toBe(
      "Tasks | Otto",
    );
  });

  it("preserves the development app distinction", () => {
    expect(resolveWindowTitle({ pageLabel: "Tasks", appName: "Otto (Dev)" })).toBe(
      "Tasks | Otto (Dev)",
    );
  });
});
