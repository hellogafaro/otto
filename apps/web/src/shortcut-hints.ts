import { useSyncExternalStore } from "react";

import { isMacPlatform } from "./lib/utils";

/** Long enough that a quick chord such as ⌘C never flashes the hints. */
export const SHORTCUT_HINTS_DELAY_MS = 400;

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

const listeners = new Set<() => void>();

let visible = false;

// A chord pressed while the modifier is down keeps the hints away until it is released.
let chorded = false;

let timer: ReturnType<typeof setTimeout> | undefined;

function setVisible(next: boolean) {
  if (visible === next) return;
  visible = next;

  for (const listener of listeners) listener();
}

function hide() {
  clearTimeout(timer);
  timer = undefined;
  setVisible(false);
}

function release() {
  chorded = false;
  hide();
}

function hintModifier(): "Meta" | "Control" {
  return isMacPlatform(navigator.platform) ? "Meta" : "Control";
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === hintModifier()) {
    if (chorded || visible || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      setVisible(true);
    }, SHORTCUT_HINTS_DELAY_MS);

    return;
  }

  if (MODIFIER_KEYS.has(event.key)) return;

  if (hintModifier() === "Meta" ? event.metaKey : event.ctrlKey) chorded = true;
  hide();
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === hintModifier()) release();
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

export function readShortcutHintsVisible() {
  return visible;
}

function getServerSnapshot() {
  return false;
}

/** True while the platform's command modifier (⌘, or Ctrl off macOS) is held on its own. */
export function useShortcutHintsVisible(): boolean {
  return useSyncExternalStore(subscribeShortcutHints, readShortcutHintsVisible, getServerSnapshot);
}
