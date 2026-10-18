import {
  type KeybindingRule,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  MAX_KEYBINDINGS_COUNT,
  MAX_WHEN_EXPRESSION_DEPTH,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@otto/contracts";

type WhenToken =
  | { type: "identifier"; value: string }
  | { type: "not" }
  | { type: "and" }
  | { type: "or" }
  | { type: "lparen" }
  | { type: "rparen" };

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "mod+b", command: "sidebar.toggle" },
  { key: "mod+alt+b", command: "rightPanel.toggle" },
  { key: "mod+k", command: "commandPalette.toggle" },
  { key: "mod+s", command: "composer.stash" },
  { key: "mod+enter", command: "approval.approve", when: "approvalPending" },
  { key: "mod+shift+enter", command: "approval.allowAll", when: "approvalPending" },
  { key: "mod+shift+backspace", command: "approval.deny", when: "approvalPending" },
  // Browsers keep mod+, for their own settings, so the web app takes Option or Alt.
  { key: "mod+,", command: "settings.open", when: "desktop" },
  { key: "alt+,", command: "settings.open", when: "!desktop" },
  { key: "?", command: "shortcuts.show", when: "!inputFocus" },
  { key: "j", command: "thread.next", when: "!inputFocus" },
  { key: "k", command: "thread.previous", when: "!inputFocus" },
  { key: "c", command: "item.new", when: "!inputFocus" },
  // Browsers keep mod+n for a new window, so only the desktop app takes it.
  { key: "mod+n", command: "item.new", when: "desktop" },
  // Rename, pin, unread, snooze, archive and assign to me have no single key: a letter typed
  // while the composer only looked focused must never change anything. More actions and the
  // command palette still run them, and a person can bind a key in Settings.
  { key: "mod+backspace", command: "item.delete", when: "!inputFocus" },
  { key: "mod+shift+,", command: "item.copyLink", when: "!inputFocus" },
  { key: "mod+.", command: "item.copyId", when: "!inputFocus" },
  { key: "s", command: "property.status", when: "!inputFocus" },
  { key: "a", command: "property.assignees", when: "!inputFocus" },
  { key: "o", command: "property.owner", when: "!inputFocus" },
  { key: "shift+d", command: "property.dueDate", when: "!inputFocus" },
  { key: "shift+p", command: "property.project", when: "!inputFocus" },
  { key: "shift+r", command: "property.repeat", when: "!inputFocus" },
  { key: "t", command: "property.logTime", when: "!inputFocus" },
  { key: "b", command: "property.bot", when: "!inputFocus" },
  { key: "v", command: "property.visibility", when: "!inputFocus" },
  { key: "m", command: "property.members", when: "!inputFocus" },
  // Option 1–9 opens the sidebar's rows, pinned first, even from the composer. The desktop
  // app's tabs own mod+1–9; the web leaves it to the browser.
  ...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
    key: `alt+${index + 1}`,
    command,
  })),
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
    key: `mod+${index + 1}`,
    command,
    when: "modelPickerOpen",
  })),
];

function normalizeKeyToken(token: string): string {
  if (token === "space") return " ";

  if (token === "esc") return "escape";

  return token;
}

export function parseKeybindingShortcut(value: string): KeybindingShortcut | null {
  const rawTokens = value
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());

  const tokens = [...rawTokens];
  let trailingEmptyCount = 0;

  while (tokens[tokens.length - 1] === "") {
    trailingEmptyCount += 1;
    tokens.pop();
  }

  if (trailingEmptyCount > 0) {
    tokens.push("+");
  }

  if (tokens.some((token) => token.length === 0)) {
    return null;
  }

  if (tokens.length === 0) return null;

  let key: string | null = null;
  let metaKey = false;
  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;
  let modKey = false;

  for (const token of tokens) {
    switch (token) {
      case "cmd":
      case "meta":
        metaKey = true;
        break;
      case "ctrl":
      case "control":
        ctrlKey = true;
        break;
      case "shift":
        shiftKey = true;
        break;
      case "alt":
      case "option":
        altKey = true;
        break;
      case "mod":
        modKey = true;
        break;
      default: {
        if (key !== null) return null;
        key = normalizeKeyToken(token);
      }
    }
  }

  if (key === null) return null;

  return {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    modKey,
  };
}

function tokenizeWhenExpression(expression: string): WhenToken[] | null {
  const tokens: WhenToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const current = expression[index];

    if (!current) break;

    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    if (expression.startsWith("&&", index)) {
      tokens.push({ type: "and" });
      index += 2;
      continue;
    }

    if (expression.startsWith("||", index)) {
      tokens.push({ type: "or" });
      index += 2;
      continue;
    }

    if (current === "!") {
      tokens.push({ type: "not" });
      index += 1;
      continue;
    }

    if (current === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }

    if (current === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index));

    if (!identifier) {
      return null;
    }

    tokens.push({ type: "identifier", value: identifier[0] });
    index += identifier[0].length;
  }

  return tokens;
}

export function parseKeybindingWhenExpression(expression: string): KeybindingWhenNode | null {
  const tokens = tokenizeWhenExpression(expression);

  if (!tokens || tokens.length === 0) return null;
  let index = 0;

  const parsePrimary = (depth: number): KeybindingWhenNode | null => {
    if (depth > MAX_WHEN_EXPRESSION_DEPTH) {
      return null;
    }

    const token = tokens[index];

    if (!token) return null;

    if (token.type === "identifier") {
      index += 1;

      return { type: "identifier", name: token.value };
    }

    if (token.type === "lparen") {
      index += 1;
      const expressionNode = parseOr(depth + 1);
      const closeToken = tokens[index];

      if (!expressionNode || !closeToken || closeToken.type !== "rparen") {
        return null;
      }

      index += 1;

      return expressionNode;
    }

    return null;
  };

  const parseUnary = (depth: number): KeybindingWhenNode | null => {
    let notCount = 0;

    while (tokens[index]?.type === "not") {
      index += 1;
      notCount += 1;

      if (notCount > MAX_WHEN_EXPRESSION_DEPTH) {
        return null;
      }
    }

    let node = parsePrimary(depth);

    if (!node) return null;

    while (notCount > 0) {
      node = { type: "not", node };
      notCount -= 1;
    }

    return node;
  };

  const parseAnd = (depth: number): KeybindingWhenNode | null => {
    let left = parseUnary(depth);

    if (!left) return null;

    while (tokens[index]?.type === "and") {
      index += 1;
      const right = parseUnary(depth);

      if (!right) return null;
      left = { type: "and", left, right };
    }

    return left;
  };

  const parseOr = (depth: number): KeybindingWhenNode | null => {
    let left = parseAnd(depth);

    if (!left) return null;

    while (tokens[index]?.type === "or") {
      index += 1;
      const right = parseAnd(depth);

      if (!right) return null;
      left = { type: "or", left, right };
    }

    return left;
  };

  const ast = parseOr(0);

  if (!ast || index !== tokens.length) return null;

  return ast;
}

export function compileResolvedKeybindingRule(rule: KeybindingRule): ResolvedKeybindingRule | null {
  const shortcut = parseKeybindingShortcut(rule.key);

  if (!shortcut) return null;

  if (rule.when !== undefined) {
    const whenAst = parseKeybindingWhenExpression(rule.when);

    if (!whenAst) return null;

    return {
      command: rule.command,
      shortcut,
      whenAst,
    };
  }

  return {
    command: rule.command,
    shortcut,
  };
}

export function compileResolvedKeybindingsConfig(
  config: ReadonlyArray<KeybindingRule>,
): ResolvedKeybindingsConfig {
  const compiled: ResolvedKeybindingRule[] = [];

  for (const rule of config) {
    const result = compileResolvedKeybindingRule(rule);

    if (result) {
      compiled.push(result);
    }
  }

  return compiled.slice(-MAX_KEYBINDINGS_COUNT);
}

export const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);
