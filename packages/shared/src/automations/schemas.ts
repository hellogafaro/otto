/**
 * Automations Schema Definitions
 *
 * Zod schemas for validating automations.json configuration.
 * Extracted from index.ts for better separation of concerns.
 */

import { z } from 'zod';
import { Cron } from 'croner';
import type { ValidationIssue } from '../config/validators.ts';
import { APP_EVENTS, AGENT_EVENTS } from './types.ts';
import { THINKING_LEVEL_IDS, normalizeThinkingLevel } from '../agent/thinking-levels.ts';

// ============================================================================
// Zod Schemas
// ============================================================================

// Mirrors the workspace-default pattern in `config/storage.ts` so that the
// legacy 'think' value is silently migrated to a current thinking level.
const ThinkingLevelInputSchema = z
  .enum([...THINKING_LEVEL_IDS, 'think'])
  .transform((value) => normalizeThinkingLevel(value))
  .optional();

export const PromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  llmConnection: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: ThinkingLevelInputSchema,
  labels: z.array(z.string()).optional(),
  projectId: z.string().min(1).optional(),
});

export const WebhookActionSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().min(1, 'URL cannot be empty').refine(
    (url) => {
      // Allow env var templates — validated at runtime after expansion
      if (url.includes('$')) return true;
      // Literal URLs must be valid http/https
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    'URL must be a valid http/https URL or contain $VAR templates'
  ),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyFormat: z.enum(['json', 'form', 'raw']).optional(),
  body: z.unknown().optional(),
  captureResponse: z.boolean().optional(),
  auth: z.union([
    z.object({
      type: z.literal('basic'),
      username: z.string().min(1),
      password: z.string(),
    }),
    z.object({
      type: z.literal('bearer'),
      token: z.string().min(1),
    }),
  ]).optional(),
});

export const ScriptActionSchema = z.object({
  type: z.literal('script'),
  script: z.string().min(1, 'Script path cannot be empty').superRefine((script, ctx) => {
    // Workspace-relative only; the executor re-validates with symlink resolution.
    if (script.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(script)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Script path must be relative to the workspace root' });
    }
    if (script.split(/[\\/]/).includes('..')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Script path must not contain ".." segments' });
    }
  }),
  args: z.array(z.string()).optional(),
  runtime: z.enum(['bun', 'node', 'python3']).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/**
 * Strict action union — unknown action types are validation errors.
 * (Replaced the legacy `.passthrough()` escape hatch: silently-ignored actions
 * hid typos and let unvalidated config reach handlers.)
 */
export const ActionDefinitionSchema = z.discriminatedUnion('type', [
  PromptActionSchema.strict(),
  WebhookActionSchema.strict(),
  ScriptActionSchema.strict(),
]);

// ============================================================================
// Condition Schemas
// ============================================================================

const VALID_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const TimeConditionSchema = z.object({
  condition: z.literal('time'),
  after: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  before: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
  weekday: z.array(z.enum(VALID_WEEKDAYS)).optional(),
  timezone: z.string().optional(),
});

export const StateConditionSchema = z.object({
  condition: z.literal('state'),
  field: z.string().min(1, 'Field name cannot be empty'),
  value: z.unknown().optional(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  contains: z.string().optional(),
  not_value: z.unknown().optional(),
}).superRefine((data, ctx) => {
  const hasValue = data.value !== undefined;
  const hasFromOrTo = data.from !== undefined || data.to !== undefined;
  const hasContains = data.contains !== undefined;
  const hasNotValue = data.not_value !== undefined;

  const operatorCount =
    (hasValue ? 1 : 0) +
    (hasFromOrTo ? 1 : 0) +
    (hasContains ? 1 : 0) +
    (hasNotValue ? 1 : 0);

  if (operatorCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'State condition must have at least one operator (value, from/to, contains, or not_value)',
      path: ['field'],
    });
    return;
  }

  if (operatorCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'State condition must use exactly one operator group (value, from/to, contains, or not_value)',
      path: ['field'],
    });
  }
});

export const AutomationConditionSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('condition', [
    TimeConditionSchema,
    StateConditionSchema,
    z.object({
      condition: z.enum(['and', 'or', 'not']),
      conditions: z.array(AutomationConditionSchema).min(1, 'Logical condition must have at least one sub-condition'),
    }),
  ])
);

// ============================================================================
// Matcher Schema
// ============================================================================

export const AutomationMatcherSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(AutomationConditionSchema).optional(),
  // Decision-model yes/no condition; inert when the decision model is off.
  semanticCondition: z.object({
    question: z.string().trim().min(1, 'Question cannot be empty').max(500),
    threshold: z.number().gt(0).lte(1).optional(),
  }).strict().optional(),
  // Telegram forum-topic name (1–128 chars). Silently ignored at runtime when
  // no supergroup is paired or the Telegram adapter is not connected.
  telegramTopic: z.string().min(1).max(128).optional(),
  actions: z.array(ActionDefinitionSchema).min(1, 'At least one action required'),
});

const SemanticConditionSchema = z.object({
  question: z.string().trim().min(1, 'Question cannot be empty').max(500),
  threshold: z.number().gt(0).lte(1).optional(),
}).strict();

/** A routine's webhook action: its credentials are a secret (`secretId`), never a plain `auth`. */
const RoutineWebhookActionSchema = WebhookActionSchema.omit({ auth: true }).extend({ secretId: z.string().min(1).optional() });

/** What a routine's `config` may hold (see `RoutineConfig`); `createRoutine` and `updateRoutine` refuse anything else. */
export const RoutineConfigSchema = z.object({
  type: z.enum(['schedule', 'event', 'webhook']),
  schedule: z.object({ cron: z.string().min(1), timezone: z.string().min(1).optional() }).strict().optional(),
  event: z.string().optional(),
  webhook: z.object({ secretId: z.string().min(1) }).strict().optional(),
  matcher: z.string().optional(),
  conditions: z.array(AutomationConditionSchema).optional(),
  semanticCondition: SemanticConditionSchema.optional(),
  permissionMode: z.enum(['safe', 'ask', 'guarded', 'allow-all']).optional(),
  telegramTopic: z.string().min(1).max(128).optional(),
  actions: z.array(z.discriminatedUnion('type', [
    PromptActionSchema.strict(),
    RoutineWebhookActionSchema.strict(),
    ScriptActionSchema.strict(),
  ])).min(1, 'At least one action required').max(20, 'At most 20 actions'),
}).strict().superRefine((config, ctx) => {
  const need = (ok: boolean, path: string, message: string) => { if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message }); };
  if (config.type === 'schedule') {
    const cron = config.schedule?.cron;
    need(!!cron, 'schedule', 'A schedule routine needs a schedule');
    if (cron) {
      let valid = cron.trim().split(/\s+/).length === 5;
      try { new Cron(cron, config.schedule?.timezone ? { timezone: config.schedule.timezone } : {}); } catch { valid = false; }
      need(valid, 'schedule', 'The schedule must be a 5-field cron expression with a valid timezone');
    }
  }
  if (config.type === 'event') need(!!config.event && config.event !== 'SchedulerTick' && VALID_EVENTS.includes(config.event), 'event', 'An event routine needs one of the known events');
  if (config.type === 'webhook') need(!!config.webhook, 'webhook', 'A webhook routine needs its secret');
  if (config.matcher) {
    let valid = true;
    try { new RegExp(config.matcher); } catch { valid = false; }
    need(valid, 'matcher', 'The matcher must be a valid regular expression');
  }
});

/**
 * Deprecated event name aliases.
 * Old names are accepted during schema validation and silently rewritten to canonical names.
 * A console.warn() is emitted at runtime so users know to update their configs.
 */
export const DEPRECATED_EVENT_ALIASES: Record<string, string> = {
  'TodoStateChange': 'SessionStatusChange',
};

/** All valid event names: canonical events + deprecated aliases. Derived from types.ts. */
export const VALID_EVENTS: readonly string[] = [
  ...APP_EVENTS,
  ...AGENT_EVENTS,
  ...Object.keys(DEPRECATED_EVENT_ALIASES),
];

export const AutomationsConfigSchema = z.object({
  version: z.number().optional(),
  automations: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
}).transform((data) => {
  const automations = data.automations ?? {};

  // Filter out invalid event names, rewrite deprecated aliases, and warn
  const validAutomations: Record<string, z.infer<typeof AutomationMatcherSchema>[]> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(automations)) {
    if (VALID_EVENTS.includes(event)) {
      // Rewrite deprecated aliases to canonical names
      const canonical = DEPRECATED_EVENT_ALIASES[event];
      if (canonical) {
        console.warn(`[automations] Deprecated event name "${event}" — use "${canonical}" instead`);
        validAutomations[canonical] = [...(validAutomations[canonical] ?? []), ...matchers];
      } else {
        validAutomations[event] = [...(validAutomations[event] ?? []), ...matchers];
      }
    } else {
      invalidEvents.push(event);
    }
  }

  if (invalidEvents.length > 0) {
    console.warn(`[automations] Unknown event types ignored: ${invalidEvents.join(', ')}`);
  }

  return { version: data.version, automations: validAutomations };
});

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Convert Zod error to ValidationIssues (matches validators.ts pattern)
 */
export function zodErrorToIssues(error: z.ZodError, file: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || 'root',
    message: issue.message,
    severity: 'error' as const,
  }));
}
