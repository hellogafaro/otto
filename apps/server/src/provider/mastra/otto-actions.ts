import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  type BotAlwaysAllowedTool,
  classifyOttoSensitivePath,
  sameAlwaysAllowedTool,
} from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import {
  OTTO_DELETE_ROUTINES_TOOL_NAME,
  OTTO_UPDATE_ROUTINE_TOOL_NAME,
} from "./otto-routine-schemas.ts";

export type OttoToolCategory = "read" | "edit" | "execute" | "mcp" | "other";

export type OttoCriticalAction =
  | "send"
  | "pay"
  | "delete"
  | "production"
  | "secrets"
  | "publish"
  | "sign"
  | "refund"
  | "account";

export const CRITICAL_ACTION_TOKENS: ReadonlyArray<
  readonly [OttoCriticalAction, ReadonlySet<string>]
> = [
  ["send", new Set(["send", "reply", "dispatch", "deliver"])],
  ["pay", new Set(["pay", "charge", "purchase", "checkout", "transfer"])],
  ["delete", new Set(["delete", "remove", "destroy", "erase", "purge"])],
  ["production", new Set(["deploy", "release", "promote", "prod", "production"])],
  ["secrets", new Set(["secret", "secrets", "credential", "credentials", "password", "token"])],
  ["publish", new Set(["publish", "post", "broadcast"])],
  ["sign", new Set(["sign", "signature", "countersign"])],
  ["refund", new Set(["refund", "reimburse", "reimbursement"])],
];

export const ACCOUNT_SCOPE_TOKENS = new Set(["account", "organization", "workspace", "tenant"]);

export const CHANGE_TOKENS = new Set([
  "change",
  "create",
  "disable",
  "enable",
  "invite",
  "remove",
  "rename",
  "reset",
  "set",
  "update",
]);

/** Input keys whose text names the action, including each tool a connector runs in one batch. */
export const ACTION_TEXT_KEYS = new Set([
  "action",
  "command",
  "deliverymode",
  "intent",
  "method",
  "operation",
  "requesttype",
  "tool_slug",
  "verb",
]);

export const CRITICAL_SHELL_ACTIONS: ReadonlyArray<readonly [OttoCriticalAction, RegExp]> = [
  [
    "delete",
    /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm|rmdir|unlink)\b|\b(?:drop|truncate)\s+(?:database|schema|table)\b|\bdelete\s+from\b/i,
  ],
  ["delete", /(?:^|[;&|]\s*)(?:(?:sudo|command|builtin|exec|nohup)\s+)*shred\b/i],
  [
    "delete",
    /(?:^|[;&|]\s*)(?:(?:sudo|command|builtin|exec|nohup)\s+)*dd\b[^\n;&|]*(?:\sof=(?:"[^"]*"|'[^']*'|[^\s;&|]+)|\s1?>>?\s*[^\s;&|]+)/i,
  ],
  ["delete", /(?:^|[;&|]\s*)(?:(?:sudo|command|builtin|exec|nohup)\s+)*mv\b/i],
  ["delete", /(?:^|[;&|]\s*)git\s+(?:reset\s+--hard|clean\s+-[a-z]*[fdx][a-z]*)\b/i],
  [
    "delete",
    /\bfind\b[^\n;&|]*\s-exec(?:dir)?\s+(?:(?:sudo|command|builtin|exec|nohup|env)\s+)*(?:rm|rmdir|shred|unlink)\b/i,
  ],
  [
    "delete",
    /\bxargs\b[^\n;&|]*\s(?:(?:sudo|command|builtin|exec|nohup)\s+)*(?:rm|rmdir|shred|unlink)\b/i,
  ],
  ["publish", /(?:^|[;&|]\s*)git\s+push\b/i],
  [
    "production",
    /(?:^|[;&|]\s*)(?:kubectl\s+(?:apply|delete|replace|rollout)|terraform\s+(?:apply|destroy)|docker\s+push)\b/i,
  ],
  [
    "secrets",
    /(?:^|[;&|]\s*)(?:(?:printenv|env)(?:\s|$)|(?:cat|head|tail|less|more|sed|awk|grep|rg)\b[^\n;&|]*(?:\.env\b|\/\.ssh\/id_[\w-]+|credentials?|secrets?|tokens?)|gh\s+auth\s+token|security\s+find-(?:generic|internet)-password|op\s+(?:read|get)|vault\s+(?:kv\s+)?get|aws\s+secretsmanager\s+get-secret-value|gcloud\s+secrets\s+versions\s+access|kubectl\s+get\s+secrets?)\b/i,
  ],
  [
    "send",
    /(?:^|[;&|]\s*)(?:(?:mail|mailx)\b|curl\b[^\n;&|]*(?:--data(?:-raw|-binary)?|-d\b|--form|-F\b|--request\s+post|-X\s*post))/i,
  ],
];

export const SHELL_COMMAND_WRAPPER_PATTERNS = [
  /(?:^|[;&|]\s*)(?:(?:sudo|command|builtin|exec|nohup)\s+)*(?:\/(?:usr\/)?bin\/)?(?:ba|da|z)?sh\s+-[a-z]*c[a-z]*\s+(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\s;&|]+))/gi,
  /(?:\bxargs\b[^\n;&|]*?\s+|\bfind\b[^\n;&|]*\s-exec(?:dir)?\s+)(?:(?:sudo|command|builtin|exec|nohup)\s+)*(?:\/(?:usr\/)?bin\/)?(?:ba|da|z)?sh\s+-[a-z]*c[a-z]*\s+(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\s;&|]+))/gi,
];

export function textTokens(value: string): ReadonlySet<string> {
  return new Set(
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

export function criticalActionsFromText(value: string): ReadonlyArray<OttoCriticalAction> {
  const tokens = textTokens(value);
  const actions: OttoCriticalAction[] = [];

  if (tokens.has("restart") && tokens.has("mcp")) actions.push("production");

  for (const [action, actionTokens] of CRITICAL_ACTION_TOKENS) {
    if ([...actionTokens].some((token) => tokens.has(token))) actions.push(action);
  }

  if (
    [...ACCOUNT_SCOPE_TOKENS].some((token) => tokens.has(token)) &&
    [...CHANGE_TOKENS].some((token) => tokens.has(token))
  ) {
    actions.push("account");
  }

  return actions;
}

export function criticalActionsFromShellCommand(
  value: string,
  wrapperDepth = 0,
): ReadonlyArray<OttoCriticalAction> {
  const actions = CRITICAL_SHELL_ACTIONS.flatMap(([action, pattern]) =>
    pattern.test(value) ? [action] : [],
  );

  if (wrapperDepth < 5) {
    for (const wrapperPattern of SHELL_COMMAND_WRAPPER_PATTERNS) {
      for (const match of value.matchAll(wrapperPattern)) {
        const nestedCommand = match[1] ?? match[2] ?? match[3];

        if (nestedCommand) {
          actions.push(...criticalActionsFromShellCommand(nestedCommand, wrapperDepth + 1));
        }
      }
    }
  }

  return [...actions, ...criticalActionsFromText(value)];
}

/** Chains, pipes, backgrounds or substitutes commands; fd redirections such as 2>&1 do not count. */
const COMPOUND_SHELL_COMMAND = /[;&|`\n\r]|\$\(|[<>]\(/;

export type OttoActionInspection = {
  /** Every kind of action the call contains, in the order found. */
  readonly actions: ReadonlyArray<OttoCriticalAction>;
  /** A shell command runs several commands, so its actions are not all known. */
  readonly hasCompoundCommand: boolean;
  /** The input is cyclic or too large to read in full, so its actions are not all known. */
  readonly incomplete: boolean;
};

export function inspectOttoAction<Input>(toolName: string, args?: Input): OttoActionInspection {
  const actions = new Set(criticalActionsFromText(toolName));
  const pending: unknown[] = [args];
  const visited = new WeakSet<object>();
  let inspected = 0;
  let entriesInspected = 0;
  let hasCompoundCommand = false;
  let incomplete = false;

  const inspection = (unread: boolean): OttoActionInspection => ({
    actions: [...actions],
    hasCompoundCommand,
    incomplete: unread,
  });

  while (pending.length > 0 && inspected < 100) {
    const value = pending.pop();
    inspected += 1;

    if (!Predicate.isObject(value) && !Array.isArray(value)) continue;

    if (visited.has(value)) {
      incomplete = true;
      continue;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entriesInspected >= 100_000) return inspection(true);
        entriesInspected += 1;

        if (Predicate.isObjectOrArray(entry) && entry !== null) pending.push(entry);
      }

      continue;
    }

    for (const key in value) {
      if (entriesInspected >= 100_000) return inspection(true);
      entriesInspected += 1;

      if (!Object.hasOwn(value, key)) continue;
      const entry: unknown = value[key];
      const normalizedKey = key.toLowerCase();

      for (const action of criticalActionsFromText(key)) actions.add(action);

      if (ACTION_TEXT_KEYS.has(normalizedKey) && Predicate.isString(entry)) {
        const command = normalizedKey === "command";

        const found = command
          ? criticalActionsFromShellCommand(entry)
          : criticalActionsFromText(entry);

        for (const action of found) actions.add(action);

        if (command && COMPOUND_SHELL_COMMAND.test(entry.replace(/\d*[<>]&[\d-]*/g, ""))) {
          hasCompoundCommand = true;
        }
      }

      if (
        Predicate.isString(entry) &&
        (normalizedKey === "path" || normalizedKey.endsWith("path")) &&
        classifyOttoSensitivePath(entry)
      ) {
        actions.add("secrets");
      }

      if (Predicate.isObjectOrArray(entry) && entry !== null) pending.push(entry);
    }
  }

  return inspection(incomplete || pending.length > 0);
}

export function criticalOttoAction<Input>(
  toolName: string,
  args?: Input,
): OttoCriticalAction | null {
  return inspectOttoAction(toolName, args).actions[0] ?? null;
}

/**
 * The kinds of action Always allow rules must cover for a call: each classified action, or null
 * for a plain call. Null overall when no rule may cover it: a proposal, input too large to read,
 * or a shell command that runs several commands.
 */
export function alwaysAllowKinds<Input>(
  toolName: string,
  args?: Input,
): ReadonlyArray<OttoCriticalAction | null> | null {
  if (isOttoProposal(toolName, args)) return null;

  const { actions, hasCompoundCommand, incomplete } = inspectOttoAction(toolName, args);

  if (incomplete || hasCompoundCommand) return null;

  return actions.length > 0 ? actions : [null];
}

/** Whether a bot's Always allow rules cover every kind of action in this call. */
export function alwaysAllowCovers<Input>(
  rules: ReadonlyArray<Pick<BotAlwaysAllowedTool, "toolName" | "action">>,
  toolName: string,
  args?: Input,
): boolean {
  const kinds = alwaysAllowKinds(toolName, args);

  return (
    kinds !== null &&
    kinds.every((action) => rules.some((rule) => sameAlwaysAllowedTool(rule, { toolName, action })))
  );
}

/** The new instructions a bot proposes for itself; they apply only after a person approves. */
export function proposedBotInstructions<Input>(toolName: string, args?: Input): string | null {
  return toolName === "bot_update" &&
    Predicate.hasProperty(args, "instructions") &&
    Predicate.isString(args.instructions)
    ? args.instructions
    : null;
}

/** A routine, skill or instruction change a person approves as a whole; it is never always allowed. */
export function isOttoProposal<Input>(toolName: string, args?: Input): boolean {
  return (
    toolName === OTTO_CREATE_ROUTINE_TOOL_NAME ||
    toolName === "skill_create" ||
    toolName === "skill_update" ||
    proposedBotInstructions(toolName, args) !== null
  );
}

/**
 * Whether a call asks a person first: a proposal, a known critical action such as sending,
 * paying or deleting, or input too large to read in full. Every other action runs.
 */
export function ottoActionNeedsApproval<Input>(toolName: string, args?: Input): boolean {
  if (proposedBotInstructions(toolName, args) !== null) return true;

  if (toolName === "skill_create" || toolName === "skill_update") return true;
  const inspection = inspectOttoAction(toolName, args);

  return inspection.actions.length > 0 || inspection.incomplete;
}

export function ottoToolCategory(toolName: string): OttoToolCategory {
  if (/read|view|grep|search|find|list|stat/i.test(toolName)) return "read";

  if (/edit|write|delete|mkdir|move|rename/i.test(toolName)) return "edit";

  if (/execute|command|shell|process|terminal/i.test(toolName)) return "execute";

  if (/mcp/i.test(toolName)) return "mcp";

  return "other";
}

export function routineToolNeedsGlobalApproval(toolName: string): boolean {
  return (
    toolName !== OTTO_CREATE_ROUTINE_TOOL_NAME &&
    toolName !== OTTO_DELETE_ROUTINES_TOOL_NAME &&
    toolName !== OTTO_UPDATE_ROUTINE_TOOL_NAME
  );
}
