import { and, eq } from 'drizzle-orm'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { getFirstUser } from '../users/queries.ts'
import { domainError } from '../utils/errors.ts'
import { CATALOGUE, type SettingKey, type SettingKind, type SettingValue } from './catalogue.ts'
import { settings } from './schema.ts'

/**
 * Settings: what is configured, as key/value rows for three kinds of owner.
 *
 *   settings(entity, key, value)   primary key (entity, key)   (schema.ts)
 *
 * `entity` is `install` (one fixed value: the whole server or desktop), `workspace:<id>` or `user:<id>`
 * (how one person has the app). `key` is in the one typed CATALOGUE (catalogue.ts), which says which kind
 * of owner it belongs to, its default (a read gives it while no row exists) and its validator (a write that
 * fails it is `invalid`). `value` is JSON. Who may read or write which entity is decided in one place,
 * `server-core/src/bootstrap/authorize.ts`; these functions trust their caller.
 */

export * from './catalogue.ts'
export type * from './types.ts'

export const INSTALL = 'install'
export const userEntity = (userId: string) => `user:${userId}`
export const workspaceEntity = (workspaceId: string) => `workspace:${workspaceId}`

const ENTITY = /^(?:install|(?:user|workspace):[A-Za-z0-9_-]{1,64})$/

/** The kind of owner an entity names; `invalid` when it is not one. */
export function getEntityKind(entity: string): SettingKind {
  if (typeof entity !== 'string' || !ENTITY.test(entity)) throw domainError('invalid', `${String(entity)} is not a settings entity`)
  return entity === INSTALL ? 'install' : (entity.split(':')[0] as SettingKind)
}

function assertKey(entity: string, key: string): SettingKey {
  if (!Object.hasOwn(CATALOGUE, key)) throw domainError('invalid', `${String(key)} is not a setting`)
  const kind = getEntityKind(entity)
  if (CATALOGUE[key as SettingKey].kind !== kind) throw domainError('invalid', `${key} is not a setting of ${kind}`)
  return key as SettingKey
}

/** The value as the key's validator reads it, or `invalid`. */
function parseValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const parsed = CATALOGUE[key].schema.safeParse(value)
  if (!parsed.success) throw domainError('invalid', `Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'rejected'}`)
  return parsed.data as SettingValue<K>
}

/** A stored row, or the default when it is missing or no longer valid. */
function readValue<K extends SettingKey>(key: K, stored: string | undefined): SettingValue<K> {
  try {
    if (stored !== undefined) return parseValue(key, JSON.parse(stored))
  } catch {
    // a row nobody can read is the same as no row
  }
  return CATALOGUE[key].fallback as SettingValue<K>
}

/** The setting of this entity, its default when nothing is stored. */
export function getSetting<K extends SettingKey>(entity: string, key: K, db: Db | Tx = initDb()): SettingValue<K> {
  assertKey(entity, key)
  const row = db.select({ value: settings.value }).from(settings).where(and(eq(settings.entity, entity), eq(settings.key, key))).get()
  return readValue(key, row?.value)
}

/** The stored value as it was written, before the key's validator reads it (undefined: no row or no JSON): for an importer that looks for a field the validator drops. */
export function getStoredSetting(entity: string, key: SettingKey, db: Db | Tx = initDb()): unknown {
  assertKey(entity, key)
  const row = db.select({ value: settings.value }).from(settings).where(and(eq(settings.entity, entity), eq(settings.key, key))).get()
  try {
    return row ? JSON.parse(row.value) : undefined
  } catch {
    return undefined
  }
}

/** Every setting of this entity's kind, defaults filled in. */
export function getSettings(entity: string, db: Db | Tx = initDb()): { [K in SettingKey]?: SettingValue<K> } {
  const kind = getEntityKind(entity)
  const rows = new Map(db.select().from(settings).where(eq(settings.entity, entity)).all().map((row) => [row.key, row.value]))
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(CATALOGUE) as SettingKey[]) {
    if (CATALOGUE[key].kind === kind) result[key] = readValue(key, rows.get(key))
  }
  return result
}

/** Stores a value the key's validator accepts (`invalid` otherwise) and returns it as read back. */
export function updateSetting<K extends SettingKey>(entity: string, key: K, value: unknown, db: Db | Tx = initDb()): SettingValue<K> {
  assertKey(entity, key)
  const parsed = parseValue(key, value)
  const row = { entity, key, value: JSON.stringify(parsed) }
  db.insert(settings).values(row).onConflictDoUpdate({ target: [settings.entity, settings.key], set: { value: row.value } }).run()
  return parsed
}

/** Whose settings: the caller's, or the first user's (the local user on a desktop) where no caller is known. Null while there is no user. */
const userIdOrFirst = (userId: string | null | undefined, db: Db | Tx) => userId ?? getFirstUser(db as Db)?.id ?? null

/** A user's setting; the default while that user (or any user) has none. */
export function getUserSetting<K extends SettingKey<'user'>>(userId: string | null | undefined, key: K, db: Db | Tx = initDb()): SettingValue<K> {
  const id = userIdOrFirst(userId, db)
  return id ? getSetting(userEntity(id), key, db) : (CATALOGUE[key].fallback as SettingValue<K>)
}

/** Stores a user's setting; `not_found` while no user exists yet. */
export function updateUserSetting<K extends SettingKey<'user'>>(userId: string | null | undefined, key: K, value: unknown, db: Db | Tx = initDb()): SettingValue<K> {
  const id = userIdOrFirst(userId, db)
  if (!id) throw domainError('not_found', 'There is no user yet')
  return updateSetting(userEntity(id), key, value, db)
}

/** Forgets the stored value; the default applies again. */
export function deleteSetting(entity: string, key: SettingKey, db: Db | Tx = initDb()): void {
  assertKey(entity, key)
  db.delete(settings).where(and(eq(settings.entity, entity), eq(settings.key, key))).run()
}

/**
 * The importer: `config.json` and `preferences.json` into settings, once, at boot (after the first user exists
 * on a desktop; a server with no user yet imports the install keys now and the rest at a later boot).
 * Install keys go to `install`; the active ids, UI preferences and the preferences file go to the first user,
 * so an existing single-user install keeps its look. A key is written only when it has no row, so running
 * it again changes nothing, and `imports.settings` records when it was done. The old files are read and never
 * changed (`config.json` is copied once to `config.json.pre-db-<date>`). `name` and `email` of
 * `preferences.json` are not settings (they are `users.name` and `users.email`), nor is the dead `enable1MContext`.
 */
const FROM_CONFIG: Record<string, [SettingKey, 'install' | 'user']> = {
  defaultLlmConnection: ['defaultConnectionSlug', 'install'],
  defaultThinkingLevel: ['defaultThinkingLevel', 'install'],
  setupDeferred: ['setupDeferred', 'install'],
  decisionLayer: ['decisionLayer', 'install'],
  keepAwakeWhileRunning: ['keepAwakeWhileRunning', 'install'],
  dismissedUpdateVersion: ['dismissedUpdateVersion', 'install'],
  activeWorkspaceId: ['activeWorkspaceId', 'user'],
  activeSessionId: ['activeChatId', 'user'],
  colorTheme: ['colorTheme', 'user'],
  notificationsEnabled: ['notificationsEnabled', 'user'],
  sendMessageKey: ['sendMessageKey', 'user'],
  spellCheck: ['spellCheck', 'user'],
  autoCapitalisation: ['autoCapitalisation', 'user'],
  richToolDescriptions: ['richToolDescriptions', 'user'],
}
const FROM_PREFERENCES = ['timezone', 'location', 'notes', 'diffViewer', 'includeCoAuthoredBy', 'uiLanguage'] as const

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // an unreadable file is skipped, never fatal
  }
  console.warn(`[settings] could not read ${path}; skipped`)
  return {}
}

export function initSettingsImport(configDir: string = CONFIG_DIR, db: Db = initDb()): { imported: number; skipped: number } {
  if (getSetting(INSTALL, 'imports', db).settings) return { imported: 0, skipped: 0 }
  const userId = getFirstUser(db)?.id
  const config = readJson(join(configDir, 'config.json'))
  const preferences = readJson(join(configDir, 'preferences.json'))
  const entries: [string | undefined, SettingKey, unknown][] = [
    ...Object.entries(FROM_CONFIG).map(([name, [key, kind]]): [string | undefined, SettingKey, unknown] => [kind === 'install' ? INSTALL : userId && userEntity(userId), key, config[name]]),
    ...FROM_PREFERENCES.map((key): [string | undefined, SettingKey, unknown] => [userId && userEntity(userId), key, preferences[key]]),
  ]
  let imported = 0
  let skipped = 0

  db.transaction((tx) => {
    for (const [entity, key, value] of entries) {
      if (!entity || value == null) continue
      try {
        const row = { entity, key, value: JSON.stringify(parseValue(key, value)) }
        imported += tx.insert(settings).values(row).onConflictDoNothing().returning({ key: settings.key }).all().length
      } catch {
        skipped++
      }
    }
    if (!userId) return
    const backup = join(configDir, `config.json.pre-db-${new Date().toISOString().slice(0, 10)}`)
    if (existsSync(join(configDir, 'config.json')) && !existsSync(backup)) copyFileSync(join(configDir, 'config.json'), backup)
    updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', tx), settings: Date.now() }, tx)
  })
  return { imported, skipped }
}
