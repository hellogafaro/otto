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
import { event, DEFAULT_BINDINGS, isOpenFavoriteEditorShortcut } from "./keybindings.test-support";

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

  it("goes to each place on Option and the digit key, whatever Option types", () => {
    const places = [
      ["¡", "Digit1", "navigation.home"],
      ["™", "Digit2", "navigation.notifications"],
      ["£", "Digit3", "navigation.chats"],
      ["¢", "Digit4", "navigation.routines"],
      ["∞", "Digit5", "navigation.tasks"],
      ["§", "Digit6", "navigation.projects"],
      ["¶", "Digit7", "navigation.library"],
    ] as const;

    for (const [key, code, command] of places) {
      assert.strictEqual(
        resolveShortcutCommand(
          event({ key, code, altKey: true }),
          DEFAULT_RESOLVED_KEYBINDINGS,
          mac,
        ),
        command,
      );
    }
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

  it("leaves mod+1–9 to the desktop app's tabs", () => {
    const cmdOne = event({ key: "1", code: "Digit1", metaKey: true });

    assert.strictEqual(
      resolveShortcutCommand(cmdOne, DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "thread.jump.1",
    );
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
