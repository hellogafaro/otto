/**
 * Shared Utilities for Automations System
 *
 * Common helper functions used by both the legacy functional API (index.ts)
 * and the new Event Bus handlers (command-handler.ts, prompt-handler.ts).
 */

import { agentEnv, isServerSecretEnvKey } from '@otto/session-tools-core';
import type { BaseEventPayload } from './event-bus.ts';
import type { AutomationEvent, AutomationMatcher, PromptReferences, AgentEvent, SdkAutomationInput } from './types.ts';
import { matchesCron } from './cron-matcher.ts';
import { sanitizeForShell } from './security.ts';
import { evaluateConditions } from './conditions.ts';

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Convert camelCase to SNAKE_CASE.
 *
 * @example
 * toSnakeCase('newStatus') // 'new_status'
 * toSnakeCase('toolName')  // 'tool_name'
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Expand environment variables in a string.
 * Supports both $VAR and ${VAR} syntax.
 *
 * @example
 * expandEnvVars('Hello $NAME', { NAME: 'World' }) // 'Hello World'
 * expandEnvVars('${GREETING} World', { GREETING: 'Hi' }) // 'Hi World'
 */
export function expandEnvVars(str: string, env: Record<string, string>): string {
  return str
    // Replace ${VAR} syntax
    .replace(/\$\{([^}]+)\}/g, (_, varName) => env[varName] ?? '')
    // Replace $VAR syntax (word boundary)
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, varName) => env[varName] ?? '');
}

// ============================================================================
// Prompt Utilities
// ============================================================================

/**
 * Parse @mentions from a prompt (sources and skills both use @name syntax).
 *
 * Syntax:
 * - @name - references a source or skill (e.g., @linear, @github, @commit, @review-pr)
 *
 * References are case-insensitive and support hyphens (e.g., @my-source, @my-skill).
 * The caller should resolve which mentions are sources vs skills based on available configurations.
 */
export function parsePromptReferences(prompt: string): PromptReferences {
  const mentions: string[] = [];

  // Match @name (word characters and hyphens)
  // Avoid matching email addresses by requiring whitespace or start of string before @
  const matches = prompt.matchAll(/(?:^|[\s(])@([a-zA-Z][a-zA-Z0-9-]*)/g);
  for (const match of matches) {
    const captured = match[1];
    if (captured) {
      const mention = captured.toLowerCase();
      if (!mentions.includes(mention)) {
        mentions.push(mention);
      }
    }
  }

  return { mentions };
}

// ============================================================================
// Event Matching Utilities
// ============================================================================

/**
 * Get the match value for regex matching based on event type.
 * Uses the most complete version with data.data?.tool_name fallback for tool events.
 *
 * Accepts both plain data objects (legacy API) and BaseEventPayload (handler API).
 */
export function getMatchValue(event: AutomationEvent, data: Record<string, unknown>): string {
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove':
      return String(data.label ?? '');
    case 'LabelConfigChange':
      return ''; // Always matches
    case 'PermissionModeChange':
      return String(data.newMode ?? '');
    case 'FlagChange':
      return String(data.isFlagged ?? false);
    case 'SessionStatusChange':
      return String(data.newStatus ?? data.newState ?? '');
    case 'PreToolUse':
    case 'PostToolUse':
      return String(data.toolName ?? (data.data as Record<string, unknown>)?.tool_name ?? '');
    case 'SchedulerTick':
      // SchedulerTick uses cron matching, not regex
      return '';
    default:
      return JSON.stringify(data);
  }
}

/**
 * Get the match value for SDK agent events.
 * Mirrors the Claude SDK's `fieldToMatch` per event — each event type matches
 * against a specific field from the input.
 */
export function getMatchValueForSdkInput(event: AgentEvent, input: SdkAutomationInput): string {
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
      return input.tool_name ?? '';
    case 'Notification':
      return input.message ?? '';
    case 'SessionStart':
      return input.source ?? '';
    case 'SubagentStart':
    case 'SubagentStop':
      return input.agent_type ?? '';
    default:
      // UserPromptSubmit, Stop, SessionEnd — no meaningful match field
      return '';
  }
}

export interface MatcherContext {
  /** Precomputed value used for regex matching */
  matchValue: string;
  /** Payload used for condition evaluation */
  payload: Record<string, unknown>;
  /** Fallback timezone source for time conditions */
  matcherTimezone?: string;
}

/**
 * Base matcher predicate (enabled flag + regex/cron). Intentionally internal.
 *
 * Do not call directly from feature code. Use matcherMatchesWithContext()/adapters
 * so condition gating is never bypassed.
 */
function matchesBasePredicate(matcher: AutomationMatcher, event: AutomationEvent, matchValue: string): boolean {
  if (matcher.enabled === false) return false;
  if (event === 'SchedulerTick') {
    return !!matcher.cron && matchesCron(matcher.cron, matcher.timezone);
  }
  if (!matcher.matcher) return true; // No matcher means match all
  try {
    return new RegExp(matcher.matcher).test(matchValue);
  } catch {
    return false; // Invalid regex — skip
  }
}

/**
 * Canonical matcher evaluation pipeline used by all automation entry points.
 */
export function matcherMatchesWithContext(
  matcher: AutomationMatcher,
  event: AutomationEvent,
  context: MatcherContext,
): boolean {
  if (!matchesBasePredicate(matcher, event, context.matchValue)) return false;

  if (matcher.conditions?.length) {
    return evaluateConditions(matcher.conditions, {
      payload: context.payload,
      matcherTimezone: context.matcherTimezone ?? matcher.timezone,
    });
  }

  return true;
}

/**
 * App-event adapter for canonical matcher evaluation.
 */
export function matcherMatches(matcher: AutomationMatcher, event: AutomationEvent, data: Record<string, unknown>): boolean {
  return matcherMatchesWithContext(matcher, event, {
    matchValue: getMatchValue(event, data),
    payload: data,
    matcherTimezone: matcher.timezone,
  });
}

/**
 * SDK agent-event adapter for canonical matcher evaluation.
 */
export function matcherMatchesSdk(matcher: AutomationMatcher, event: AgentEvent, input: SdkAutomationInput): boolean {
  return matcherMatchesWithContext(matcher, event, {
    matchValue: getMatchValueForSdkInput(event, input),
    payload: input as unknown as Record<string, unknown>,
    matcherTimezone: matcher.timezone,
  });
}

// ============================================================================
// Environment Variable Utilities
// ============================================================================

/**
 * The allow-listed host environment (see agentEnv): used to expand `$VAR` in prompts
 * and to seed command envs, so a prompt can never expand a server secret.
 */
export function cleanEnv(): Record<string, string> {
  return agentEnv();
}

/** Keys skipped when iterating payload fields for env vars */
const PAYLOAD_SKIP_KEYS = new Set(['sessionId', 'sessionName', 'workspaceId', 'timestamp']);

/**
 * Build the base OTTO_* environment variables shared by both prompt and webhook actions.
 * Contains event info, session metadata, scheduler time, and payload fields (unsanitized).
 */
function buildBaseEventEnv(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const env: Record<string, string> = {
    OTTO_EVENT: event,
    OTTO_EVENT_DATA: JSON.stringify(payload),
  };

  if (payload.sessionId) env.OTTO_SESSION_ID = payload.sessionId;
  if (payload.sessionName) env.OTTO_SESSION_NAME = payload.sessionName;
  if (payload.workspaceId) env.OTTO_WORKSPACE_ID = payload.workspaceId;

  // Session metadata as JSON
  const sessionMetadata: Record<string, string> = {};
  if (payload.sessionId) sessionMetadata.id = payload.sessionId;
  if (payload.sessionName) sessionMetadata.name = payload.sessionName;
  if (Object.keys(sessionMetadata).length > 0) {
    env.OTTO_SESSION_METADATA = JSON.stringify(sessionMetadata);
  }

  // Local time for scheduler events
  if (event === 'SchedulerTick') {
    const now = new Date();
    env.OTTO_LOCAL_TIME = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    env.OTTO_LOCAL_DATE = now.toISOString().split('T')[0]!;
  }

  // Payload fields as OTTO_ vars (raw — callers apply sanitization if needed)
  for (const [key, value] of Object.entries(payload)) {
    if (PAYLOAD_SKIP_KEYS.has(key)) continue;
    const envKey = `OTTO_${toSnakeCase(key).toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? value : String(value);
  }

  return env;
}

/**
 * Build environment variables from an event payload for prompt/command actions.
 * Includes full process.env and sanitizes user-controlled values for shell safety.
 */
export function buildEnvFromPayload(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const base = buildBaseEventEnv(event, payload);
  const env: Record<string, string> = { ...cleanEnv(), ...base };

  // Sanitize session name for shell context
  if (payload.sessionName) env.OTTO_SESSION_NAME = sanitizeForShell(payload.sessionName);

  // Sanitize payload field values for shell context
  for (const [key, value] of Object.entries(payload)) {
    if (PAYLOAD_SKIP_KEYS.has(key)) continue;
    const envKey = `OTTO_${toSnakeCase(key).toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? sanitizeForShell(value) : String(value);
  }

  return env;
}

/**
 * Build environment variables for webhook actions.
 *
 * Unlike buildEnvFromPayload (used by prompt actions), this:
 * - Does NOT spread process.env (no secret leakage)
 * - Does NOT apply shell sanitization (irrelevant for HTTP context)
 * - Only injects OTTO_WH_* user-defined vars from process.env (webhook secrets)
 * - Includes OTTO_* system vars derived from the event payload
 *
 * Users set webhook secrets in their shell profile:
 *   export OTTO_WH_SLACK_URL="https://hooks.slack.com/services/T.../B.../xxx"
 *   export OTTO_WH_DISCORD_TOKEN="abc123"
 *
 * Then reference them in automations.json:
 *   "url": "${OTTO_WH_SLACK_URL}"
 *   "headers": { "Authorization": "Bearer ${OTTO_WH_DISCORD_TOKEN}" }
 */
export function buildWebhookEnv(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const env = buildBaseEventEnv(event, payload);

  // User-defined webhook secrets: only OTTO_WH_* from process.env
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('OTTO_WH_') && value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Env vars that are not OTTO_* but that script runtimes cannot function
 * without. Paths and OS plumbing only — never credentials.
 * - HOME/USERPROFILE: bun/uv cache + python interpreter installs
 * - SYSTEMROOT/WINDIR/SYSTEMDRIVE/COMSPEC/PATHEXT/TEMP/TMP: Windows can't
 *   spawn or do DNS/socket work without these
 */
const SCRIPT_ENV_PLATFORM_ESSENTIALS = process.platform === 'win32'
  ? ['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
  : ['HOME'];

export interface ScriptEnvOptions {
  /** Workspace root, exposed as OTTO_WORKSPACE_PATH */
  workspaceRootPath: string;
}

/**
 * Build environment variables for script actions: OTTO_*-only by design.
 *
 * Unlike buildEnvFromPayload (prompt actions), process.env is NOT spread —
 * a script's env is exactly:
 * - every OTTO_* var from process.env except the server's own secrets
 *   (runtime hints like OTTO_BUN/OTTO_UV, user-defined OTTO_* vars, OTTO_CONFIG_DIR, ...)
 * - OTTO_* event context (same base as webhooks; no shell sanitization —
 *   values are argv/env payloads, never interpreted by a shell)
 * - OTTO_WORKSPACE_PATH
 * - a documented minimal set of non-secret platform essentials (HOME etc.)
 *
 * Notably absent: PATH (runtimes are spawned by absolute path) and every
 * non-OTTO credential (ANTHROPIC_API_KEY, GITHUB_TOKEN, ...).
 */
function applyPlatformAndOttoEnv(env: Record<string, string>): void {
  for (const key of SCRIPT_ENV_PLATFORM_ESSENTIALS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('OTTO_') && value !== undefined && !isServerSecretEnvKey(key)) {
      env[key] = value;
    }
  }
}

function applyWorkspaceEnv(env: Record<string, string>, options: ScriptEnvOptions): void {
  env.OTTO_WORKSPACE_PATH = options.workspaceRootPath;
}

export function buildScriptEnv(
  event: AutomationEvent,
  payload: BaseEventPayload,
  options: ScriptEnvOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  applyPlatformAndOttoEnv(env);

  // Event context wins over any same-named pass-through
  Object.assign(env, buildBaseEventEnv(event, payload));

  // Workspace context is applied last so an event payload can never
  // clobber OTTO_WORKSPACE_PATH.
  applyWorkspaceEnv(env, options);

  return env;
}
