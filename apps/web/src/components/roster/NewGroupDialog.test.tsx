import { describe, expect, it } from "vite-plus/test";

import { canCreateGroup, groupSelectionHint } from "./NewGroupDialog";

describe("new group", () => {
  it("requires a name and two distinct bots", () => {
    expect(canCreateGroup("Launch crew", ["one", "two"])).toBe(true);
    expect(canCreateGroup("Launch crew", ["one"])).toBe(false);
    expect(canCreateGroup("Launch crew", ["one", "one"])).toBe(false);
    expect(canCreateGroup(" ", ["one", "two"])).toBe(false);
  });
});

describe("group selection hint", () => {
  it("asks for two bots until two distinct bots are selected", () => {
    expect(groupSelectionHint([])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one"])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one", "one"])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one", "two"])).toBeNull();
  });
});
