import { describe, expect, it } from "vite-plus/test";

import { groupCandidates } from "./GroupMemberChecklist";
import { canCreateGroup, groupSelectionHint } from "./NewGroupDialog";
import type { Bot } from "./types";

describe("new group", () => {
  it("requires a name and a bot", () => {
    expect(canCreateGroup("Launch crew", ["one", "two"])).toBe(true);
    expect(canCreateGroup("Launch crew", ["one"])).toBe(true);
    expect(canCreateGroup("Launch crew", [])).toBe(false);
    expect(canCreateGroup(" ", ["one", "two"])).toBe(false);
  });
});

describe("group selection hint", () => {
  it("asks for a bot until one is selected", () => {
    expect(groupSelectionHint([])).toBe("Select at least one bot.");
    expect(groupSelectionHint(["one"])).toBeNull();
  });
});

describe("group candidates", () => {
  it("mixes bots and people in one alphabetical list", () => {
    // SAFETY: only id and name are read when ordering candidates.
    const bot = (id: string, name: string) => ({ id, name }) as Bot;

    const names = groupCandidates(
      [bot("bot-nova", "Nova"), bot("bot-axo", "Axo")],
      [
        { personId: "user-ana", displayName: "ana Lopez" },
        { personId: "user-ben", displayName: "Ben" },
      ],
    ).map((candidate) => `${candidate.kind}:${candidate.name}`);

    expect(names).toEqual(["person:ana Lopez", "bot:Axo", "person:Ben", "bot:Nova"]);
  });
});
