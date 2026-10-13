import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { groupMemberRemovalHint, isGroupMemberRemovalBlocked } from "./GroupDetailsPanel";

/** The panel, the shared details aside, its editor, and the removal rules, which together hold the panel's markup. */
function readGroupDetailsSources(): string {
  return [
    "./GroupDetailsPanel.tsx",
    "../DetailsAside.tsx",
    "./GroupEditor.tsx",
    "./groupMemberRemoval.logic.ts",
  ]
    .map((file) => NodeFS.readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n");
}

describe("GroupDetailsPanel", () => {
  it("uses the bot sidebar behavior and group management commands", () => {
    const source = readGroupDetailsSources();
    expect(source).toContain('resolveShortcutCommand(event, keybindings) !== "rightPanel.toggle"');
    expect(source).toContain("RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY");
    expect(source).toContain("botEnvironment.groups.rename");
    expect(source).toContain("botEnvironment.groups.assignMember");
    expect(source).toContain("botEnvironment.groups.unassignMember");
    expect(source).toContain("botEnvironment.groups.setBoss");
    expect(source).toContain("botEnvironment.groups.delete");
    expect(source).toContain("input.memberCount <= 1");
    expect(source).not.toContain("Invite people");
    expect(source).toContain("dialogs.confirm(");
    expect(source).toContain('confirmLabel: t("Delete group")');
    expect(source).toContain('variant="destructive-outline"');
  });

  it("explains why a bot cannot be removed yet", () => {
    expect(groupMemberRemovalHint({ memberCount: 1, canAddBot: true })).toBe(
      "A group needs at least one bot. Add another bot before you remove this one.",
    );
    expect(groupMemberRemovalHint({ memberCount: 1, canAddBot: false })).toBe(
      "A group needs at least one bot. Create a new bot in the roster before you remove this one.",
    );
    expect(groupMemberRemovalHint({ memberCount: 2, canAddBot: true })).toBeNull();
  });

  it("links the removal hint only to rows it explains", () => {
    expect(isGroupMemberRemovalBlocked(1)).toBe(true);
    expect(isGroupMemberRemovalBlocked(2)).toBe(false);

    const source = readGroupDetailsSources();
    expect(source).toContain("aria-describedby={removalHint && blockedByRule ? removalHintId");
    expect(source).toContain('<DialogTitle>{t("Add members")}</DialogTitle>');
    expect(source).toContain('<DialogTitle>{t("Rename group")}</DialogTitle>');
    expect(source).toContain("<GroupMemberChecklist");
    expect(source).toContain("Everyone is already in this group.");
    expect(source).not.toContain("<Select");
  });

  it("mounts beside the group conversation", () => {
    const source = NodeFS.readFileSync(
      new URL("../../routes/_chat.groups.$groupId.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<GroupThreadLanding");
    expect(source).toContain("<GroupDetailsPanel");
    expect(source).toContain("onDeleted=");
    expect(source).not.toContain("environmentPeopleAtom");
  });
});
