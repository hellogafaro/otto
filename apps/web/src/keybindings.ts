import * as Predicate from "effect/Predicate";
import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingsConfig,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ThreadJumpKeybindingCommand,
} from "@otto/contracts";
import { recordLookup } from "./components/record-lookup";
import { isElectron } from "./env";
import { isMacPlatform } from "./lib/utils";

export interface ShortcutEventLike {
  type?: string;
  code?: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutModifierStateLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutMatchContext {
  previewFocus: boolean;
  previewOpen: boolean;
  [key: string]: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

const EVENT_CODE_KEY_ALIASES = {
  BracketLeft: ["["],
  BracketRight: ["]"],
  Comma: [","],
  Digit0: ["0"],
  Digit1: ["1"],
  Digit2: ["2"],
  Digit3: ["3"],
  Digit4: ["4"],
  Digit5: ["5"],
  Digit6: ["6"],
  Digit7: ["7"],
  Digit8: ["8"],
  Digit9: ["9"],
};

const EVENT_CODE_KEY_ALIASES_LOOKUP = new Map(Object.entries(EVENT_CODE_KEY_ALIASES));

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase();

  if (normalized === "esc") return "escape";

  return normalized;
}

function resolveEventKeys(event: ShortcutEventLike): Set<string> {
  const layoutKey = normalizeEventKey(event.key);
  const keys = new Set([layoutKey]);
  // The physical-position fallback exists for layouts that type non-Latin
  // letters (Cyrillic, Greek) and for Option-modified symbols on macOS.
  // When the layout already produces a Latin letter, match on it alone;
  // otherwise a remapped physical key triggers shortcuts for two different
  // letters at once and shadows system shortcuts on non-QWERTY layouts.
  const letterCode = event.code?.match(/^Key([A-Z])$/)?.[1];

  if (letterCode && !/^[a-z]$/.test(layoutKey)) {
    keys.add(letterCode.toLowerCase());
  }

  const aliases = event.code ? EVENT_CODE_KEY_ALIASES_LOOKUP.get(event.code) : undefined;

  if (!aliases) return keys;

  for (const alias of aliases) {
    keys.add(alias);
  }

  return keys;
}

function matchesShortcutModifiers(
  event: ShortcutModifierStateLike,
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): boolean {
  const useMetaForMod = isMacPlatform(platform);
  const expectedMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const expectedCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);

  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === shortcut.shiftKey &&
    event.altKey === shortcut.altKey
  );
}

function matchesShortcut(
  event: ShortcutEventLike,
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): boolean {
  // A symbol the layout itself typed, such as ?, needs Shift on some layouts and not on
  // others, so Shift belongs to the symbol rather than to the shortcut. A shortcut that names
  // Shift, such as mod+shift+comma, still needs it pressed.
  const typedSymbol =
    !shortcut.shiftKey && /^[\p{P}\p{S}]$/u.test(shortcut.key) && event.key === shortcut.key;

  const modifiers = {
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: typedSymbol ? false : event.shiftKey,
  };

  if (!matchesShortcutModifiers(modifiers, shortcut, platform)) return false;

  return resolveEventKeys(event).has(shortcut.key);
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    previewFocus: false,
    previewOpen: false,
    desktop: isElectron,
    ...options?.context,
  };
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;

      if (node.name === "false") return false;

      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhenNode(node.node, context);
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context);
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context);
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true;

  return evaluateWhenNode(whenAst, context);
}

function shortcutConflictKey(shortcut: KeybindingShortcut, platform = navigator.platform): string {
  const useMetaForMod = isMacPlatform(platform);
  const metaKey = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);

  return [
    shortcut.key,
    metaKey ? "meta" : "",
    ctrlKey ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const claimedShortcuts = new Set<string>();

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];

    if (!binding) continue;

    if (!matchesWhenClause(binding.whenAst, context)) continue;

    const conflictKey = shortcutConflictKey(binding.shortcut, platform);

    if (claimedShortcuts.has(conflictKey)) {
      continue;
    }

    claimedShortcuts.add(conflictKey);

    if (binding.command === command) {
      return binding.shortcut;
    }
  }

  return null;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];

    if (!binding) continue;

    if (!matchesWhenClause(binding.whenAst, context)) continue;

    if (!matchesShortcut(event, binding.shortcut, platform)) continue;

    return binding.command;
  }

  return null;
}

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";

  if (key.length === 1) return key.toUpperCase();

  if (key === "escape") return "Esc";

  if (key === "arrowup") return "Up";

  if (key === "arrowdown") return "Down";

  if (key === "arrowleft") return "Left";

  if (key === "arrowright") return "Right";

  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

/**
 * Whether a key belongs to what has focus rather than to the app: a text field, or an
 * open dialog, menu or list, which own their keys. Bare-key shortcuts wait for this to
 * be false.
 */
export function isInputFocus(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-keybinding-capture]',
    ) !== null
  );
}

const MAC_KEY_GLYPHS = { enter: "\u21b5", backspace: "\u232b" } satisfies Readonly<
  Record<string, string>
>;

/** One key cap per modifier and key, in the platform's order and notation. */
export function formatShortcutParts(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): ReadonlyArray<string> {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);

  if (useMetaForMod) {
    return [
      ...(showCtrl ? ["\u2303"] : []),
      ...(shortcut.altKey ? ["\u2325"] : []),
      ...(shortcut.shiftKey ? ["\u21e7"] : []),
      ...(showMeta ? ["\u2318"] : []),
      recordLookup(MAC_KEY_GLYPHS, shortcut.key) ?? keyLabel,
    ];
  }

  return [
    ...(showCtrl ? ["Ctrl"] : []),
    ...(shortcut.altKey ? ["Alt"] : []),
    ...(shortcut.shiftKey ? ["Shift"] : []),
    ...(showMeta ? ["Meta"] : []),
    keyLabel,
  ];
}

export function formatShortcutLabel(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): string {
  return formatShortcutParts(shortcut, platform).join(isMacPlatform(platform) ? "" : "+");
}

function resolveLabelOptions(
  options: string | ResolvedShortcutLabelOptions | undefined,
): ResolvedShortcutLabelOptions | undefined {
  return Predicate.isString(options) ? { platform: options } : options;
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: string | ResolvedShortcutLabelOptions,
): string | null {
  const resolvedOptions = resolveLabelOptions(options);
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, resolvedOptions);

  return shortcut ? formatShortcutLabel(shortcut, resolvePlatform(resolvedOptions)) : null;
}

export function shortcutPartsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ResolvedShortcutLabelOptions,
): ReadonlyArray<string> | null {
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);

  return shortcut ? formatShortcutParts(shortcut, resolvePlatform(options)) : null;
}

export function threadJumpCommandForIndex(index: number): ThreadJumpKeybindingCommand | null {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function threadJumpIndexFromCommand(command: string): number | null {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.findIndex((candidate) => candidate === command);

  return index === -1 ? null : index;
}

export function shouldShowThreadJumpHints(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowThreadJumpHintsForModifiers(event, keybindings, options);
}

export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);

    if (!shortcut) continue;

    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.findIndex(
    (candidate) => candidate === command,
  );

  return index === -1 ? null : index;
}

export function shouldShowModelPickerJumpHints(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return shouldShowModelPickerJumpHintsForModifiers(event, keybindings, options);
}

export function shouldShowModelPickerJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const platform = resolvePlatform(options);

  for (const command of MODEL_PICKER_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);

    if (!shortcut) continue;

    if (matchesShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}
