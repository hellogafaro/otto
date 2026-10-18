import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readShortcutHintModifier, subscribeShortcutHints } from "./shortcut-hints";

function key(type: "keydown" | "keyup", key: string, modifiers: Partial<KeyboardEvent> = {}) {
  window.dispatchEvent(
    Object.assign(new Event(type), { key, metaKey: false, ctrlKey: false, ...modifiers }),
  );
}

function hold(platform: string) {
  vi.stubGlobal("navigator", { platform });
  const listener = vi.fn();
  const unsubscribe = subscribeShortcutHints(listener);

  return { listener, unsubscribe };
}

describe("shortcut hints", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows as soon as Command is pressed on macOS and hides on release", () => {
    const { listener, unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    expect(readShortcutHintModifier()).toBe("command");
    expect(listener).toHaveBeenCalledTimes(1);

    key("keyup", "Meta");
    expect(readShortcutHintModifier()).toBe(null);
    unsubscribe();
  });

  it("uses Ctrl off macOS and ignores Ctrl on macOS", () => {
    const linux = hold("Linux x86_64");
    key("keydown", "Control", { ctrlKey: true });
    expect(readShortcutHintModifier()).toBe("command");
    linux.unsubscribe();

    const mac = hold("MacIntel");
    key("keydown", "Control", { ctrlKey: true });
    expect(readShortcutHintModifier()).toBe(null);
    mac.unsubscribe();
  });

  it("hides on a chord and stays hidden until the modifier is released", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    key("keydown", "c", { metaKey: true });
    expect(readShortcutHintModifier()).toBe(null);
    key("keydown", "Meta", { metaKey: true, repeat: true });
    expect(readShortcutHintModifier()).toBe(null);

    key("keyup", "Meta");
    key("keydown", "Meta", { metaKey: true });
    expect(readShortcutHintModifier()).toBe("command");
    unsubscribe();
  });

  it("keeps showing while another modifier joins", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    key("keydown", "Alt", { metaKey: true, altKey: true });
    expect(readShortcutHintModifier()).toBe("command");
    key("keyup", "Alt", { metaKey: true });
    expect(readShortcutHintModifier()).toBe("command");
    unsubscribe();
  });

  it("shows the Option hints while Option is held on its own", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Alt", { altKey: true });
    expect(readShortcutHintModifier()).toBe("option");
    key("keydown", "1", { altKey: true });
    expect(readShortcutHintModifier()).toBe(null);
    key("keydown", "Alt", { altKey: true, repeat: true });
    expect(readShortcutHintModifier()).toBe(null);
    key("keyup", "Alt");
    key("keydown", "Alt", { altKey: true });
    expect(readShortcutHintModifier()).toBe("option");
    unsubscribe();
  });

  it("hides when the window loses focus", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    window.dispatchEvent(new Event("blur"));
    expect(readShortcutHintModifier()).toBe(null);
    unsubscribe();
  });
});
