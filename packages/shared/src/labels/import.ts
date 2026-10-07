import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { loadStoredConfig } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { migrateLabelColors, migrateStatusColors } from '../colors/migrate.ts'
import { PermissionsConfigSchema } from '../agent/mode-types.ts'
import { INSTALL, getSetting, updateSetting, workspaceEntity } from '../settings/index.ts'
import { DEFAULT_ICON_SVGS } from '../statuses/default-icons.ts'
import { FIXED_STATUS_IDS, MAX_STATUS_ICON, getDefaultStatuses, initWorkspaceStatuses, insertStatuses, svgDataUrl } from '../statuses/storage.ts'
import type { StatusConfig, WorkspaceStatusConfig } from '../statuses/types.ts'
import { initWorkspaceLabels, insertLabelTree } from './storage.ts'
import type { WorkspaceLabelConfig } from './types.ts'

/**
 * The importer of labels, statuses and workspace permissions: the old files of each workspace into the database,
 * once, at boot (and for a workspace added later). Per workspace (recorded as `labelsStatuses:<id>` in the
 * `imports` setting, so a label deleted later is not brought back by the next boot):
 *
 *   <ws>/labels/config.json              -> `labels`, the nested `children` becoming `parentId`
 *   <ws>/statuses/config.json + icons/*  -> `statuses`; an icon file becomes a data URL in the column (an icon
 *                                           above 16 KB, or a web address with no file, is dropped and reported)
 *   <ws>/permissions.json                -> the `permissions` setting of `workspace:<id>`
 *
 * A workspace without a labels or statuses file gets the defaults. Ids are new `crypto.randomUUID()` ids with the old id as
 * `slug`, so the `'slug::value'` strings of chat headers, routines, agents and automations keep resolving. The
 * old files are only read, never changed or deleted. An unreadable file is skipped and reported, never fatal.
 * The old `isDefault` flag (cannot be deleted) is not the new one (the status new chats get = `defaultStatusId`).
 */

export interface LabelsStatusesImportReport {
  workspaces: number
  labels: number
  statuses: number
  permissions: number
  skipped: number
  warnings: string[]
}

const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' }
const LOCAL_ICON_FILE = /^[^/\\]+\.(svg|png|jpe?g|webp)$/i

function readJson(path: string, warnings: string[]): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))
  } catch {
    warnings.push(`${path}: not readable JSON; skipped`)
    return undefined
  }
}

/** An icon file as a data URL, or a warning when it is too large. */
function fileIcon(path: string, warnings: string[]): string | undefined {
  if (!existsSync(path) || !statSync(path).isFile()) return undefined
  const ext = extname(path).toLowerCase()
  const bytes = readFileSync(path)
  const url = ext === '.svg' ? svgDataUrl(bytes.toString('utf-8')) : `data:${MIME[ext] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`
  if (url.length > MAX_STATUS_ICON) {
    warnings.push(`${path}: icon is ${url.length} characters (limit ${MAX_STATUS_ICON}); dropped`)
    return undefined
  }
  return url
}

/** What the old config meant by `icon`, as the column holds it: an emoji or name stays, a file or the icon discovered by the status id becomes a data URL. */
function importIcon(root: string, status: { id: string; icon?: string }, warnings: string[]): string | undefined {
  const iconsDir = join(root, 'statuses', 'icons')
  const raw = typeof status.icon === 'string' ? status.icon.trim() : ''
  if (raw && !LOCAL_ICON_FILE.test(raw) && !/^https?:\/\//i.test(raw)) return raw
  const explicit = LOCAL_ICON_FILE.test(raw) ? fileIcon(join(iconsDir, raw), warnings) : undefined
  const discovered = () => Object.keys(MIME).map((ext) => fileIcon(join(iconsDir, `${status.id}${ext}`), warnings)).find(Boolean)
  const icon = explicit ?? discovered() ?? (DEFAULT_ICON_SVGS[status.id] ? svgDataUrl(DEFAULT_ICON_SVGS[status.id]!) : undefined)
  if (!icon && raw) warnings.push(`status ${status.id}: icon ${raw} is a web address with no downloaded file; dropped`)
  return icon
}

/** The statuses of the old file with their icons as data URLs, or null when the file is missing or not a valid set. */
function readStatuses(root: string, warnings: string[]): StatusConfig[] | null {
  const config = readJson(join(root, 'statuses', 'config.json'), warnings) as WorkspaceStatusConfig | undefined
  if (!config) return null
  if (!Array.isArray(config.statuses) || !FIXED_STATUS_IDS.filter((id) => id !== 'archived').every((id) => config.statuses.some((s) => s.id === id && s.isFixed))) {
    warnings.push(`${join(root, 'statuses', 'config.json')}: missing the fixed statuses todo, done and cancelled; the defaults are used`)
    return null
  }
  migrateStatusColors(config)
  const defaultId = config.statuses.some((s) => s.id === config.defaultStatusId) ? config.defaultStatusId : 'todo'
  const imported = config.statuses.map(({ order: position, ...status }): StatusConfig => {
    const icon = importIcon(root, status, warnings)
    return { ...status, ...(icon ? { icon } : { icon: undefined }), isDefault: status.id === defaultId, position }
  })
  // the old files have no `archived` status: add it last
  return [...imported, { ...getDefaultStatuses().find((s) => s.id === 'archived')!, position: imported.length }]
}

export function initLabelsStatusesImport(db: Db = initDb(), workspaces: { id: string; rootPath: string }[] = loadStoredConfig()?.workspaces ?? []): LabelsStatusesImportReport {
  const report: LabelsStatusesImportReport = { workspaces: 0, labels: 0, statuses: 0, permissions: 0, skipped: 0, warnings: [] }
  for (const { id, rootPath } of workspaces) {
    const key = `labelsStatuses:${id}`
    if (getSetting(INSTALL, 'imports', db)[key]) continue
    try {
      db.transaction((tx) => {
        const warnings = report.warnings

        const labels = readJson(join(rootPath, 'labels', 'config.json'), warnings) as WorkspaceLabelConfig | undefined
        if (labels && Array.isArray(labels.labels)) {
          migrateLabelColors(labels)
          const result = insertLabelTree(tx, id, labels.labels)
          report.labels += result.inserted
          report.skipped += result.skipped
        } else {
          initWorkspaceLabels(id, tx)
        }

        const imported = readStatuses(rootPath, warnings)
        if (imported) report.statuses += insertStatuses(tx, id, imported)
        else initWorkspaceStatuses(id, tx)

        const rules = readJson(join(rootPath, 'permissions.json'), warnings)
        if (rules !== undefined) {
          const parsed = PermissionsConfigSchema.safeParse(rules)
          if (parsed.success) {
            updateSetting(workspaceEntity(id), 'permissions', parsed.data, tx)
            report.permissions++
          } else {
            report.skipped++
            warnings.push(`${join(rootPath, 'permissions.json')}: ${parsed.error.issues[0]?.message ?? 'invalid'}; skipped`)
          }
        }

        updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', tx), [key]: Date.now() }, tx)
      })
      report.workspaces++
    } catch (error) {
      // rolled back and not recorded: the next boot tries this workspace again
      report.warnings.push(`workspace ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (report.workspaces) {
    console.log(`[labels] imported ${report.labels} labels, ${report.statuses} statuses, ${report.permissions} permissions for ${report.workspaces} workspaces (${report.skipped} skipped, ${report.warnings.length} warnings)`)
    for (const warning of report.warnings) console.warn(`[labels] ${warning}`)
  }
  return report
}
