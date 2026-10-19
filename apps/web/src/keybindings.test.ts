import { assert, describe, it } from "vite-plus/test";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shouldShowModelPickerJumpHints,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
} from "./keybindings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@otto/shared/keybindings";
import {
  event,
  DEFAULT_BINDINGS,
  compile,
  isOpenFavoriteEditorShortcut,
} from "./keybindings.test-support";

describe("thread navigation helpers", () => {
  it("maps jump commands to visible thread indices", () => {
    assert.strictEqual(threadJumpCommandForIndex(0), "thread.jump.1");
    assert.strictEqual(threadJumpCommandForIndex(2), "thread.jump.3");
    assert.isNull(threadJumpCommandForIndex(9));
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.1"), 0);
    assert.strictEqual(threadJumpIndexFromCommand("thread.jump.3"), 2);
    assert.isNull(threadJumpIndexFromCommand("thread.next"));
  });

  it("shows jump hints only when configured modifiers match", () => {
    assert.isTrue(
      shouldShowThreadJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isFalse(
      shouldShowThreadJumpHints(event({ metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      shouldShowThreadJumpHints(event({ ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });
});

describe("model picker navigation helpers", () => {
  it("maps jump commands to visible model indices", () => {
    assert.strictEqual(modelPickerJumpCommandForIndex(0), "modelPicker.jump.1");
    assert.strictEqual(modelPickerJumpCommandForIndex(2), "modelPicker.jump.3");
    assert.isNull(modelPickerJumpCommandForIndex(9));
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.1"), 0);
    assert.strictEqual(modelPickerJumpIndexFromCommand("modelPicker.jump.3"), 2);
    assert.isNull(modelPickerJumpIndexFromCommand("thread.jump.1"));
  });

  it("shows jump hints only while the model picker context is active", () => {
    assert.isFalse(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: false },
      }),
    );
    assert.isTrue(
      shouldShowModelPickerJumpHints(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { modelPickerOpen: true },
      }),
    );
  });
});

describe("chat/editor shortcuts", () => {
  it("matches editor.openFavorite shortcut", () => {
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(event({ key: "o", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches commandPalette.toggle shortcut outside terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
      "commandPalette.toggle",
    );
    assert.notStrictEqual(
      resolveShortcutCommand(event({ key: "k", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "commandPalette.toggle",
    );
  });

  it("matches filePicker.toggle shortcut outside terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "p", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
      "filePicker.toggle",
    );
    assert.notStrictEqual(
      resolveShortcutCommand(event({ key: "p", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "filePicker.toggle",
    );
  });

  it("matches projectSearch.toggle shortcut outside terminal focus", () => {
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "f", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
      "projectSearch.toggle",
    );
    assert.notStrictEqual(
      resolveShortcutCommand(event({ key: "f", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
      "projectSearch.toggle",
    );
  });

  it("matches themeEditor.toggle on macOS and Windows", () => {
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "t", metaKey: true, altKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        { platform: "MacIntel" },
      ),
      "themeEditor.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "t", ctrlKey: true, altKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        { platform: "Win32" },
      ),
      "themeEditor.toggle",
    );
  });
});

describe("app-wide default shortcuts", () => {
  const mac = { platform: "MacIntel" };

  it("jumps to each sidebar row on Option and the digit key, whatever Option types", () => {
    const rows = [
      ["¡", "Digit1", "thread.jump.1"],
      ["™", "Digit2", "thread.jump.2"],
      ["£", "Digit3", "thread.jump.3"],
      ["¢", "Digit4", "thread.jump.4"],
      ["∞", "Digit5", "thread.jump.5"],
      ["§", "Digit6", "thread.jump.6"],
      ["¶", "Digit7", "thread.jump.7"],
      ["•", "Digit8", "thread.jump.8"],
      ["ª", "Digit9", "thread.jump.9"],
    ] as const;

    for (const [key, code, command] of rows) {
      for (const context of [{}, { desktop: true }]) {
        assert.strictEqual(
          resolveShortcutCommand(event({ key, code, altKey: true }), DEFAULT_RESOLVED_KEYBINDINGS, {
            ...mac,
            context,
          }),
          command,
        );
      }

      assert.isNull(
        resolveShortcutCommand(event({ key, code, altKey: true }), DEFAULT_RESOLVED_KEYBINDINGS, {
          ...mac,
          context: { inputFocus: true },
        }),
      );
    }
  });

  it("types the Option character in a text field and keeps the jump elsewhere", () => {
    const optionTwo = event({ key: "™", code: "Digit2", altKey: true });
    const optionL = event({ key: "¬", code: "KeyL", altKey: true });
    const optionB = event({ key: "∫", code: "KeyB", altKey: true, metaKey: true });

    assert.isNull(
      resolveShortcutCommand(optionTwo, DEFAULT_RESOLVED_KEYBINDINGS, {
        ...mac,
        context: { inputFocus: true },
      }),
    );
    assert.strictEqual(
      resolveShortcutCommand(optionTwo, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "thread.jump.2",
    );
    assert.isNull(
      resolveShortcutCommand(
        optionL,
        compile([
          {
            shortcut: {
              key: "l",
              metaKey: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: true,
              modKey: false,
            },
            command: "item.archive",
          },
        ]),
        { ...mac, context: { inputFocus: true } },
      ),
    );
    assert.strictEqual(
      resolveShortcutCommand(
        optionB,
        compile([
          {
            shortcut: {
              key: "b",
              metaKey: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: true,
              modKey: true,
            },
            command: "rightPanel.toggle",
          },
        ]),
        { ...mac, context: { inputFocus: true } },
      ),
      "rightPanel.toggle",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "2", code: "Digit2", altKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        {
          platform: "Win32",
          context: { inputFocus: true },
        },
      ),
      "thread.jump.2",
    );
  });

  it("opens settings on mod+comma in the desktop app and Option+comma in a browser", () => {
    const optionComma = event({ key: "≤", code: "Comma", altKey: true });
    const cmdComma = event({ key: ",", code: "Comma", metaKey: true });

    assert.strictEqual(
      resolveShortcutCommand(optionComma, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "settings.open",
    );
    assert.isNull(resolveShortcutCommand(cmdComma, DEFAULT_RESOLVED_KEYBINDINGS, mac));
    assert.strictEqual(
      resolveShortcutCommand(cmdComma, DEFAULT_RESOLVED_KEYBINDINGS, {
        ...mac,
        context: { desktop: true },
      }),
      "settings.open",
    );
    assert.isNull(
      resolveShortcutCommand(optionComma, DEFAULT_RESOLVED_KEYBINDINGS, {
        ...mac,
        context: { desktop: true },
      }),
    );
  });

  it("copies the link only when Shift is held with mod+comma", () => {
    const cmdShiftComma = event({ key: "<", code: "Comma", metaKey: true, shiftKey: true });

    assert.strictEqual(
      resolveShortcutCommand(cmdShiftComma, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "item.copyLink",
    );
  });

  it("tells a property key with Shift, and waits while typing", () => {
    const keys = [
      [event({ key: "P", code: "KeyP", shiftKey: true }), "property.project"],
      [event({ key: "R", code: "KeyR", shiftKey: true }), "property.repeat"],
      [event({ key: "D", code: "KeyD", shiftKey: true }), "property.dueDate"],
      [event({ key: "s", code: "KeyS" }), "property.status"],
    ] as const;

    for (const [keyEvent, command] of keys) {
      assert.strictEqual(
        resolveShortcutCommand(keyEvent, DEFAULT_RESOLVED_KEYBINDINGS, mac),
        command,
      );
      assert.isNull(
        resolveShortcutCommand(keyEvent, DEFAULT_RESOLVED_KEYBINDINGS, {
          ...mac,
          context: { inputFocus: true },
        }),
      );
    }
  });

  it("gives no single letter to a verb that changes the item", () => {
    for (const [key, code] of [
      ["e", "KeyE"],
      ["p", "KeyP"],
      ["u", "KeyU"],
      ["h", "KeyH"],
      ["r", "KeyR"],
      ["i", "KeyI"],
    ] as const) {
      assert.isNull(
        resolveShortcutCommand(event({ key, code }), DEFAULT_RESOLVED_KEYBINDINGS, mac),
      );
    }
  });

  it("leaves mod+1–9 to the desktop app's tabs and the browser", () => {
    const cmdOne = event({ key: "1", code: "Digit1", metaKey: true });

    assert.isNull(resolveShortcutCommand(cmdOne, DEFAULT_RESOLVED_KEYBINDINGS, mac));
    assert.isNull(
      resolveShortcutCommand(cmdOne, DEFAULT_RESOLVED_KEYBINDINGS, {
        ...mac,
        context: { desktop: true },
      }),
    );
  });

  it("moves between chats on J and K and shows the sheet on ?, unless focus owns the keys", () => {
    const question = event({ key: "?", code: "Slash", shiftKey: true });
    const spanishQuestion = event({ key: "?", code: "Minus", shiftKey: true });

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "j", code: "KeyJ" }), DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "thread.next",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "k", code: "KeyK" }), DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "thread.previous",
    );
    assert.strictEqual(
      resolveShortcutCommand(question, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "shortcuts.show",
    );
    assert.strictEqual(
      resolveShortcutCommand(spanishQuestion, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "shortcuts.show",
    );
    assert.isNull(
      resolveShortcutCommand(event({ key: "j", code: "KeyJ" }), DEFAULT_RESOLVED_KEYBINDINGS, {
        ...mac,
        context: { inputFocus: true },
      }),
    );
    assert.isNull(
      resolveShortcutCommand(
        event({ key: "J", code: "KeyJ", shiftKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        mac,
      ),
    );
  });

  it("reads modifiers from events whose keys live on the prototype, like a real KeyboardEvent", () => {
    class PrototypeEvent {
      get key() {
        return "?";
      }

      get code() {
        return "Slash";
      }

      get shiftKey() {
        return true;
      }

      get metaKey() {
        return false;
      }

      get ctrlKey() {
        return false;
      }

      get altKey() {
        return false;
      }
    }

    assert.strictEqual(
      resolveShortcutCommand(new PrototypeEvent(), DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "shortcuts.show",
    );
  });
});
