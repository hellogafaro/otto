import type { PermissionMode } from '../agent/mode-types.ts'
import type { AutomationCondition, PromptAction, ScriptAction, SemanticCondition, WebhookAction } from './types.ts'

/** What a routine is and does, browser-safe (the renderer reads these shapes; the database code is in ./routines.ts). */

/** The newest runs kept per routine. */
export const ROUTINE_RUNS_KEPT = 20
/** The longest title and the most actions a routine takes. */
export const MAX_ROUTINE_TITLE = 120
export const MAX_ROUTINE_ACTIONS = 20

export type RoutineType = 'schedule' | 'event' | 'webhook'
export type RoutineRunStatus = 'running' | 'ok' | 'error' | 'skipped'

/** A webhook action keeps its credentials in `secrets`: `secretId` names the secret (JSON `{type:'bearer',token}` or `{type:'basic',username,password}`), never a plain `auth`. */
export type RoutineWebhookAction = Omit<WebhookAction, 'auth'> & { secretId?: string }
export type RoutineAction = PromptAction | RoutineWebhookAction | ScriptAction

/**
 * The `config` of a routine: everything the scheduler and the runner read. A schedule has `schedule`, an event
 * routine `event` (an `AutomationEvent` name) and optionally `matcher` (a regex on the event's data), a webhook
 * routine `webhook.secretId` (its incoming token). `conditions` all have to pass; `semanticCondition` is the decision
 * model's yes/no question. Prompt actions carry the labels and project of the chats they start.
 */
export interface RoutineConfig {
  type: RoutineType
  schedule?: { cron: string; timezone?: string }
  event?: string
  webhook?: { secretId: string }
  matcher?: string
  conditions?: AutomationCondition[]
  semanticCondition?: SemanticCondition
  permissionMode?: PermissionMode
  telegramTopic?: string
  actions: RoutineAction[]
}

/** One run, newest first in `Routine.runs`. `scheduledFor` is the cron minute of a schedule run, else its trigger time. */
export interface RoutineRun {
  id: string
  routineId: string
  scheduledFor: number
  status: RoutineRunStatus
  /** The chat a prompt action started. */
  chatId: string | null
  /** The error of a failed run, or why a skipped one did not run. */
  error: string | null
  startedAt: number
}

export interface Routine {
  id: string
  workspaceId: string
  /** The agent its chats talk to; null = the workspace's default agent. */
  agentId: string | null
  title: string
  config: RoutineConfig
  /** When it was paused; null = active. */
  pausedAt: number | null
  /** The actor ('user:<id>') its runs and their chats belong to. */
  createdBy: string
  createdAt: number
  /** Newest first, at most `ROUTINE_RUNS_KEPT`. */
  runs: RoutineRun[]
}

export type RoutineInput = {
  workspaceId: string
  title: string
  agentId?: string | null
  config: RoutineConfig
  createdBy: string
  /** Start paused. */
  paused?: boolean
  /** Default now; the importer keeps the old file's order with it. */
  createdAt?: number
}

/** `paused` pauses (true) or resumes (false); the rest replaces the field. */
export type RoutineUpdate = Partial<Pick<RoutineInput, 'title' | 'agentId' | 'config' | 'paused'>>
