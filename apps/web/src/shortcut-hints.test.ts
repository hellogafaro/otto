import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readShortcutHintsVisible,
  SHORTCUT_HINTS_DELAY_MS,
  subscribeShortcutHints,
} from "./shortcut-hints";

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
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows while Command is held on macOS and hides on release", () => {
    const { listener, unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS - 1);
    expect(readShortcutHintsVisible()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(readShortcutHintsVisible()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    key("keyup", "Meta");
    expect(readShortcutHintsVisible()).toBe(false);
    unsubscribe();
  });

  it("uses Ctrl off macOS and ignores Ctrl on macOS", () => {
    const linux = hold("Linux x86_64");
    key("keydown", "Control", { ctrlKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS);
    expect(readShortcutHintsVisible()).toBe(true);
    linux.unsubscribe();

    const mac = hold("MacIntel");
    key("keydown", "Control", { ctrlKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS);
    expect(readShortcutHintsVisible()).toBe(false);
    mac.unsubscribe();
  });

  it("stays hidden through a chord until the modifier is released", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    key("keydown", "c", { metaKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS * 2);
    expect(readShortcutHintsVisible()).toBe(false);

    key("keyup", "Meta");
    key("keydown", "Meta", { metaKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS);
    expect(readShortcutHintsVisible()).toBe(true);
    unsubscribe();
  });

  it("keeps showing while another modifier joins and hides on a key", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS);
    key("keydown", "Alt", { metaKey: true });
    expect(readShortcutHintsVisible()).toBe(true);

    key("keydown", "b", { metaKey: true });
    expect(readShortcutHintsVisible()).toBe(false);
    unsubscribe();
  });

  it("hides when the window loses focus", () => {
    const { unsubscribe } = hold("MacIntel");

    key("keydown", "Meta", { metaKey: true });
    vi.advanceTimersByTime(SHORTCUT_HINTS_DELAY_MS);
    window.dispatchEvent(new Event("blur"));
    expect(readShortcutHintsVisible()).toBe(false);
    unsubscribe();
  });
});
