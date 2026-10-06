import { existsSync, readFileSync } from 'node:fs'
import { loadStoredConfig } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { userActor } from '../actors.ts'
import { createSecret } from '../secrets/index.ts'
import { INSTALL, getSetting, updateSetting } from '../settings/index.ts'
import { getFirstUser } from '../users/queries.ts'
import { getWorkspaceOwnerIds } from '../workspaces/ownership.ts'
import { deriveAutomationName } from './name-utils.ts'
import { resolveAutomationsConfigPath } from './resolve-config-path.ts'
import type { RoutineAction, RoutineConfig } from './routine-types.ts'
import { createRoutine } from './routines.ts'
import type { AutomationMatcher as Matcher } from './types.ts'
import { validateAutomationsConfig } from './validation.ts'

/**
 * The importer of routines: each workspace's `automations.json` becomes `routines` rows, once, at boot (recorded as
 * `routines:<workspaceId>` in the `imports` setting, so a routine deleted later is not brought back, and a file
 * written after the first boot is not read). The file stays where it is, and so does `automations-history.jsonl`
 * (its runs are not imported). Per matcher:
 *
 *   `SchedulerTick` + `cron`/`timezone`  -> a `schedule` routine; any other event -> an `event` routine (+ `matcher`)
 *   `name`                               -> `title` (else derived from the first action)
 *   `enabled: false`                     -> `paused_at` = now
 *   `labels`                             -> the `labels` of each prompt action
 *   webhook `auth` (plain text)          -> a secret; the action keeps `secretId`
 *
 * The routines belong to the workspace's first owner (else the first user), like the chats they started. A
 * workspace with nobody to own them is left for the next boot. Only a file that cannot be read or a matcher that does
 * not validate is skipped, with a warning; a matcher is never fatal to the others.
 */

export interface RoutinesImportReport {
  workspaces: number
  routines: number
  skipped: number
  warnings: string[]
}

export function initRoutinesImport(
  db: Db = initDb(),
  workspaces: { id: string; rootPath: string }[] = loadStoredConfig()?.workspaces ?? [],
  storeSecret: (title: string, value: string) => string = createSecret,
): RoutinesImportReport {
  const report: RoutinesImportReport = { workspaces: 0, routines: 0, skipped: 0, warnings: [] }
  for (const { id: workspaceId, rootPath } of workspaces) {
    const key = `routines:${workspaceId}`
    if (getSetting(INSTALL, 'imports', db)[key]) continue
    try {
      const creator = getWorkspaceOwnerIds(workspaceId, db)[0] ?? getFirstUser(db)?.id
      if (!creator) {
        report.skipped++
        continue
      }
      const matchers = readMatchers(rootPath, report.warnings)
      const base = Date.now()
      db.transaction((tx) => {
        matchers.forEach(({ event, matcher }, index) => {
          const config = toConfig(event, matcher, (title, value) => storeSecret(title, value))
          if (!config) {
            report.warnings.push(`workspace ${workspaceId}: a scheduled automation without a cron was skipped`)
            return
          }
          createRoutine({
            workspaceId,
            title: deriveAutomationName(event, matcher).slice(0, 120),
            config,
            createdBy: userActor(creator),
            paused: matcher.enabled === false,
            createdAt: base + index,
          }, tx)
          report.routines++
        })
        updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', tx), [key]: Date.now() }, tx)
      })
      report.workspaces++
    } catch (error) {
      // rolled back and not recorded: the next boot tries this workspace again
      report.warnings.push(`workspace ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (report.workspaces || report.skipped || report.warnings.length) {
    console.log(`[routines] imported ${report.routines} routines from ${report.workspaces} workspaces (${report.skipped} waiting for a user, ${report.warnings.length} warnings)`)
    for (const warning of report.warnings) console.warn(`[routines] ${warning}`)
  }
  return report
}


function readMatchers(rootPath: string, warnings: string[]): { event: string; matcher: Matcher }[] {
  const path = resolveAutomationsConfigPath(rootPath)
  if (!existsSync(path)) return []
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))
  } catch {
    warnings.push(`${path}: not readable JSON; skipped`)
    return []
  }
  const validation = validateAutomationsConfig(raw)
  if (!validation.valid || !validation.config) {
    warnings.push(`${path}: not valid (${validation.errors.join('; ')}); skipped`)
    return []
  }
  return Object.entries(validation.config.automations).flatMap(([event, matchers]) => (matchers ?? []).map((matcher) => ({ event, matcher })))
}

function toConfig(event: string, matcher: Matcher, storeSecret: (title: string, value: string) => string): RoutineConfig | undefined {
  const schedule = event === 'SchedulerTick'
  if (schedule && !matcher.cron) return undefined
  const title = deriveAutomationName(event, matcher)
  const actions = matcher.actions.map((action): RoutineAction => {
    if (action.type === 'prompt') return matcher.labels?.length ? { ...action, labels: matcher.labels } : action
    if (action.type === 'webhook' && action.auth) {
      const { auth, ...rest } = action
      return { ...rest, secretId: storeSecret(`Webhook credentials: ${title}`, JSON.stringify(auth)) }
    }
    return action as RoutineAction
  })
  return {
    type: schedule ? 'schedule' : 'event',
    ...(schedule ? { schedule: { cron: matcher.cron!, ...(matcher.timezone ? { timezone: matcher.timezone } : {}) } } : { event, ...(matcher.matcher ? { matcher: matcher.matcher } : {}) }),
    ...(matcher.conditions?.length ? { conditions: matcher.conditions } : {}),
    ...(matcher.semanticCondition ? { semanticCondition: matcher.semanticCondition } : {}),
    ...(matcher.permissionMode ? { permissionMode: matcher.permissionMode } : {}),
    ...(matcher.telegramTopic ? { telegramTopic: matcher.telegramTopic } : {}),
    actions,
  }
}
