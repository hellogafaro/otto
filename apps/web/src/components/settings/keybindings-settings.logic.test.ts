import { describe, expect, it } from "vite-plus/test";
import type { ResolvedKeybindingsConfig } from "@otto/contracts";

import { DEFAULT_RESOLVED_KEYBINDINGS } from "@otto/shared/keybindings";

import {
  buildKeybindingGroups,
  buildKeybindingRows,
  buildKeybindingCommandOptions,
  commandLabel,
  describeWhenExpression,
  isRetiredCommand,
  keybindingConflictLabels,
  keybindingDisplayParts,
  keybindingFromKeyboardEvent,
  keybindingGroupForCommand,
  shortcutToKeybindingInput,
  whenAstToExpression,
} from "./keybindings-settings.logic";

function shortcut(key: string, modifiers: { shift?: boolean; alt?: boolean } = {}) {
  return {
    key,
    modKey: true,
    metaKey: false,
    ctrlKey: false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
  };
}

describe("KeybindingsSettings.logic", () => {
  it("builds rows with readable key and when values", () => {
    const rows = buildKeybindingRows([
      {
        command: "sidebar.toggle",
        shortcut: {
          key: "b",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(rows).toEqual([
      expect.objectContaining({
        command: "sidebar.toggle",
        key: "mod+b",
        when: "!terminalFocus",
        defaultKey: "mod+b",
        defaultWhen: "",
        source: "Custom",
      }),
    ]);
  });

  it("captures platform-specific mod shortcuts", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("mod+shift+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        "Win32",
      ),
    ).toBe("mod+shift+k");
  });

  it("serializes shortcuts and when expressions for upserts", () => {
    expect(
      shortcutToKeybindingInput({
        key: " ",
        modKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("mod+alt+space");

    expect(
      whenAstToExpression({
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      }),
    ).toBe("editorFocus && !terminalFocus");
  });

  it("formats commands as plain-language actions", () => {
    expect(commandLabel("commandPalette.toggle")).toBe("Open command palette");
    expect(commandLabel("themeEditor.toggle")).toBe("Theme Editor: Toggle");
    expect(commandLabel("thread.jump.3")).toBe("Jump to chat 3");
    expect(commandLabel("modelPicker.jump.2")).toBe("Pick model 2");
  });

  it("gives every default command a purpose group and a written title", () => {
    for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
      expect(commandLabel(binding.command)).not.toContain(":");
    }

    expect(keybindingGroupForCommand("commandPalette.toggle")).toBe("general");
    expect(keybindingGroupForCommand("thread.jump.1")).toBe("chats");
    expect(keybindingGroupForCommand("modelPicker.jump.1")).toBe("composer");
    expect(keybindingGroupForCommand("sidebar.toggle")).toBe("layout");
  });

  it("groups default bindings by purpose and collapses numbered series", () => {
    const groups = buildKeybindingGroups(buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS));

    expect(groups.map((group) => group.id)).toEqual([
      "general",
      "navigation",
      "chats",
      "composer",
      "layout",
    ]);
    const chats = groups.find((group) => group.id === "chats");
    expect(chats?.rowCount).toBe(14);
    expect(chats?.items[2]).toEqual(
      expect.objectContaining({
        type: "series",
        series: expect.objectContaining({
          id: "thread.jump",
          title: "Jump to chat 1–9",
          rangeKey: "mod+1–9",
          when: "!desktop",
        }),
      }),
    );
    expect(
      chats?.items.map((item) =>
        item.type === "row" ? [commandLabel(item.row.command), item.row.key] : null,
      ),
    ).toEqual([
      ["Next chat", "j"],
      ["Previous chat", "k"],
      null,
      ["Approve", "mod+enter"],
      ["Allow all", "mod+shift+enter"],
      ["Deny", "mod+shift+backspace"],
    ]);
    const composer = groups.find((group) => group.id === "composer");
    expect(composer?.items.map((item) => item.type)).toEqual(["row", "series"]);
    expect(composer?.items[1]).toEqual(
      expect.objectContaining({
        series: expect.objectContaining({ title: "Pick model 1–9", when: "modelPickerOpen" }),
      }),
    );
    const general = groups.find((group) => group.id === "general");
    expect(
      general?.items.map((item) => (item.type === "row" ? commandLabel(item.row.command) : "")),
    ).toEqual([
      "Open command palette",
      "Open settings",
      "Open settings",
      "Show keyboard shortcuts",
    ]);
    const navigation = groups.find((group) => group.id === "navigation");
    expect(
      navigation?.items.map((item) =>
        item.type === "row" ? [commandLabel(item.row.command), item.row.key] : null,
      ),
    ).toEqual([
      ["Home", "alt+1"],
      ["Chats", "alt+2"],
      ["Routines", "alt+3"],
      ["Tasks", "alt+4"],
      ["Projects", "alt+5"],
      ["Library", "alt+6"],
    ]);
    // No default depends on the removed terminal or browser preview.
    expect(
      groups.flatMap((group) =>
        group.items.flatMap((item) => (item.type === "row" ? [item.row.when] : [])),
      ),
    ).toEqual([
      "",
      "!desktop",
      "desktop",
      "!inputFocus",
      ...Array.from({ length: 6 }, () => ""),
      "!inputFocus",
      "!inputFocus",
      "approvalPending",
      "approvalPending",
      "approvalPending",
      "",
      "",
      "",
    ]);
  });

  it("drops the range shortcut when a series step was customized", () => {
    const rows = buildKeybindingRows([
      { command: "thread.jump.1", shortcut: shortcut("1") },
      { command: "thread.jump.2", shortcut: shortcut("2", { alt: true }) },
    ] satisfies ResolvedKeybindingsConfig);

    const [chats] = buildKeybindingGroups(rows);

    expect(chats?.items).toEqual([
      expect.objectContaining({
        series: expect.objectContaining({ title: "Jump to chat 1–2", rangeKey: null }),
      }),
    ]);
  });

  it("shows a lone matching series step as a plain row", () => {
    const rows = buildKeybindingRows([
      { command: "thread.jump.4", shortcut: shortcut("4") },
    ] satisfies ResolvedKeybindingsConfig);

    const groups = buildKeybindingGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toEqual([
      expect.objectContaining({
        type: "row",
        row: expect.objectContaining({ command: "thread.jump.4" }),
      }),
    ]);
  });

  it("describes when clauses in plain language", () => {
    expect(describeWhenExpression(undefined)).toBeNull();
    expect(describeWhenExpression({ type: "identifier", name: "previewFocus" })).toBe(
      "When the preview is focused",
    );
    expect(
      describeWhenExpression({
        type: "not",
        node: { type: "identifier", name: "modelPickerOpen" },
      }),
    ).toBe("Unless the model picker is open");
    expect(
      describeWhenExpression({
        type: "and",
        left: { type: "identifier", name: "modelPickerOpen" },
        right: { type: "identifier", name: "previewFocus" },
      }),
    ).toBe("modelPickerOpen && previewFocus");
  });

  it("splits shortcuts into key caps in platform modifier order", () => {
    expect(keybindingDisplayParts("mod+shift+k", "MacIntel")).toEqual(["⇧", "⌘", "K"]);
    expect(keybindingDisplayParts("mod+shift+k", "Win32")).toEqual(["Ctrl", "Shift", "K"]);
    expect(keybindingDisplayParts("mod++", "MacIntel")).toEqual(["⌘", "+"]);
    expect(keybindingDisplayParts("mod+alt+arrowup", "Linux x86_64")).toEqual(["Ctrl", "Alt", "↑"]);
    expect(keybindingDisplayParts("mod+1–9", "MacIntel")).toEqual(["⌘", "1–9"]);
    expect(keybindingDisplayParts("", "MacIntel")).toEqual([]);
  });

  it("treats later scoped bindings as overrides rather than conflicts", () => {
    const defaults = buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS);
    expect(defaults.every((row) => row.conflicts.length === 0)).toBe(true);

    // An unscoped binding added after a scoped one shadows it completely.
    const shadowed = buildKeybindingRows([
      {
        command: "rightPanel.toggle",
        shortcut: shortcut("r"),
        whenAst: { type: "identifier", name: "previewFocus" },
      },
      { command: "sidebar.toggle", shortcut: shortcut("r") },
    ] satisfies ResolvedKeybindingsConfig);

    expect(shadowed.map((row) => row.conflicts)).toEqual([
      ["Toggle sidebar"],
      ["Toggle right panel"],
    ]);

    // Drafts are appended on save, so a new scoped binding only overrides.
    expect(
      keybindingConflictLabels(defaults, {
        rowId: "new",
        key: "mod+1",
        when: "previewFocus",
      }),
    ).toEqual([]);
    expect(keybindingConflictLabels(defaults, { rowId: "new", key: "mod+k", when: "" })).toEqual([
      "Open command palette",
    ]);
  });

  it("builds command options from default commands without retired bindings", () => {
    const options = buildKeybindingCommandOptions([
      {
        command: "script.setup-db.run",
        shortcut: {
          key: "r",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(options).toEqual(expect.arrayContaining(["sidebar.toggle", "rightPanel.toggle"]));
    expect(options).not.toContain("script.setup-db.run");
    expect(options).not.toContain("terminal.toggle");
  });

  it("does not expose the retired theme editor through saved shortcuts", () => {
    const saved = [
      { command: "themeEditor.toggle", shortcut: shortcut("t") },
    ] satisfies ResolvedKeybindingsConfig;

    expect(buildKeybindingCommandOptions(saved)).not.toContain("themeEditor.toggle");
    expect(buildKeybindingRows(saved)).toEqual([]);
  });

  it("offers the chat commands that run without a default shortcut and hides new local chat", () => {
    const options = buildKeybindingCommandOptions([]);

    expect(options).toEqual(
      expect.arrayContaining(["chat.new", "thread.previous", "thread.next", "thread.settle"]),
    );
    expect(options).not.toContain("chat.newLocal");
    expect(isRetiredCommand("chat.newLocal")).toBe(true);
    expect(commandLabel("thread.previous")).toBe("Previous chat");
    expect(commandLabel("thread.next")).toBe("Next chat");
  });

  it("hides bindings for retired commands", () => {
    const rows = buildKeybindingRows([
      {
        command: "preview.zoomIn",
        shortcut: {
          key: "=",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: { type: "identifier", name: "previewFocus" },
      },
      {
        command: "preview.zoomIn",
        shortcut: {
          key: "+",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: { type: "identifier", name: "previewFocus" },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(rows).toEqual([]);
  });

  it("reports conflicting shortcuts that share an active when context", () => {
    const rows = buildKeybindingRows([
      {
        command: "chat.new",
        shortcut: {
          key: "n",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
      {
        command: "thread.settle",
        shortcut: {
          key: "n",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(rows[0]?.conflicts).toEqual(["Settle chat"]);
    expect(
      keybindingConflictLabels(rows, {
        rowId: rows[0]?.id ?? "",
        key: "mod+n",
        when: "",
      }),
    ).toEqual(["Settle chat"]);
  });
});
