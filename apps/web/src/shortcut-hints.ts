import { useSyncExternalStore } from "react";

import { isMacPlatform } from "./lib/utils";

/** The command modifier (⌘, or Ctrl off macOS) shows the desktop tabs; Option or Alt the sidebar. */
export type ShortcutHintModifier = "command" | "option";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

const listeners = new Set<() => void>();

let held: ShortcutHintModifier | null = null;

// A chord pressed while a modifier is down keeps the hints away until that modifier is released.
let chorded: ShortcutHintModifier | null = null;

function setHeld(next: ShortcutHintModifier | null) {
  if (held === next) return;
  held = next;

  for (const listener of listeners) listener();
}

function release() {
  chorded = null;
  setHeld(null);
}

function commandKey(): "Meta" | "Control" {
  return isMacPlatform(navigator.platform) ? "Meta" : "Control";
}

function modifierForKey(key: string): ShortcutHintModifier | null {
  if (key === commandKey()) return "command";

  if (key === "Alt") return "option";

  return null;
}

function isHeld(event: KeyboardEvent, modifier: ShortcutHintModifier): boolean {
  if (modifier === "option") return event.altKey;

  return commandKey() === "Meta" ? event.metaKey : event.ctrlKey;
}

function onKeyDown(event: KeyboardEvent) {
  const modifier = modifierForKey(event.key);

  if (modifier) {
    // The first modifier held keeps its hints while another joins it.
    if (chorded === null && held === null) setHeld(modifier);

    return;
  }

  if (MODIFIER_KEYS.has(event.key)) return;

  if (held && isHeld(event, held)) chorded = held;
  setHeld(null);
}

function onKeyUp(event: KeyboardEvent) {
  const modifier = modifierForKey(event.key);

  if (modifier && (modifier === held || modifier === chorded)) release();
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") release();
}

export function subscribeShortcutHints(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size > 0) return;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    release();
  };
}

/** The modifier held on its own right now, if any. */
export function readShortcutHintModifier(): ShortcutHintModifier | null {
  return held;
}

function getServerSnapshot() {
  return null;
}

/** True while this modifier is held on its own: ⌘ (Ctrl off macOS) or Option (Alt). */
export function useShortcutHintsVisible(modifier: ShortcutHintModifier): boolean {
  return (
    useSyncExternalStore(subscribeShortcutHints, readShortcutHintModifier, getServerSnapshot) ===
    modifier
  );
}
