import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { users } from '../users/schema.ts'
import { deleteSetting, getSetting, getSettings, INSTALL, initSettingsImport, updateSetting, userEntity, workspaceEntity } from './index.ts'
import { settings } from './schema.ts'

const [A, B] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return db
}

const addUser = (db: Awaited<ReturnType<typeof setup>>, id: string, at: number) =>
  db.insert(users).values({ id, name: id, email: `${id}@x.test`, createdAt: new Date(at), updatedAt: new Date(at) }).run()

const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
}

test('a read gives the default until a value is stored, and a write is read back', async () => {
  const db = await setup()
  expect(getSetting(userEntity(A), 'sendMessageKey', db)).toBe('enter')
  expect(getSetting(INSTALL, 'defaultThinkingLevel', db)).toBe('medium')
  expect(getSetting(INSTALL, 'server', db)).toEqual({ enabled: false, port: 9100 })
  expect(updateSetting(userEntity(A), 'sendMessageKey', 'cmd-enter', db)).toBe('cmd-enter')
  expect(getSetting(userEntity(A), 'sendMessageKey', db)).toBe('cmd-enter')
  updateSetting(userEntity(A), 'sendMessageKey', 'enter', db) // an update replaces, one row per key
  expect(db.select().from(settings).all()).toHaveLength(1)
  deleteSetting(userEntity(A), 'sendMessageKey', db)
  expect(db.select().from(settings).all()).toHaveLength(0)
  expect(updateSetting(INSTALL, 'defaultThinkingLevel', 'think', db)).toBe('medium') // the legacy name is normalised
})

test('the catalogue refuses an unknown key, a key of another kind of owner, a bad value and a bad entity', async () => {
  const db = await setup()
  expect(code(() => updateSetting(INSTALL, 'nope' as never, 1, db))).toBe('invalid')
  expect(code(() => updateSetting(INSTALL, 'colorTheme', 'nord', db))).toBe('invalid') // a user key
  expect(code(() => updateSetting(userEntity(A), 'setupDeferred', true, db))).toBe('invalid') // an install key
  expect(code(() => updateSetting(workspaceEntity('w1'), 'colorTheme', 'nord', db))).toBe('invalid')
  expect(code(() => updateSetting(userEntity(A), 'sendMessageKey', 'tab', db))).toBe('invalid')
  expect(code(() => updateSetting(userEntity(A), 'spellCheck', 'yes', db))).toBe('invalid')
  expect(code(() => updateSetting(INSTALL, 'server', { enabled: true }, db))).toBe('invalid')
  expect(code(() => getSetting('everyone', 'colorTheme', db))).toBe('invalid')
  expect(code(() => getSetting('user:', 'colorTheme', db))).toBe('invalid')
  expect(db.select().from(settings).all()).toHaveLength(0)
})

test('entities do not see each other, and getSettings lists the keys of one kind of owner with defaults', async () => {
  const db = await setup()
  updateSetting(userEntity(A), 'colorTheme', 'nord', db)
  updateSetting(workspaceEntity('w1'), 'localMcpServers', { enabled: false }, db)
  updateSetting(workspaceEntity('w2'), 'defaults', { model: 'm' }, db)
  expect(getSetting(userEntity(B), 'colorTheme', db)).toBe('default')
  expect(getSetting(workspaceEntity('w1'), 'localMcpServers', db)).toEqual({ enabled: false })
  expect(getSetting(workspaceEntity('w2'), 'localMcpServers', db)).toEqual({ enabled: true })
  expect(getSettings(workspaceEntity('w2'), db)).toEqual({ defaults: { model: 'm' }, localMcpServers: { enabled: true }, permissions: {} })
  const mine = getSettings(userEntity(A), db)
  expect(mine.colorTheme).toBe('nord')
  expect(mine.notificationsEnabled).toBe(true)
  expect(mine).not.toHaveProperty('setupDeferred')
  expect(getSettings(INSTALL, db)).toHaveProperty('setupDeferred', false)
})

test('a stored value that no longer validates reads as the default', async () => {
  const db = await setup()
  db.insert(settings).values({ entity: userEntity(A), key: 'sendMessageKey', value: '"tab"', updatedAt: new Date() }).run()
  db.insert(settings).values({ entity: userEntity(A), key: 'colorTheme', value: '{broken', updatedAt: new Date() }).run()
  expect(getSetting(userEntity(A), 'sendMessageKey', db)).toBe('enter')
  expect(getSetting(userEntity(A), 'colorTheme', db)).toBe('default')
})

// The shape of a real ~/.otto: config.json with the registry and old keys, preferences.json with the profile.
const CONFIG = {
  workspaces: [{ id: 'ws-1', name: 'test', rootPath: '~/.otto/workspaces/test', createdAt: 1 }],
  activeWorkspaceId: 'ws-1',
  activeSessionId: '260101-fast-fox',
  defaultLlmConnection: 'claude-max',
  defaultThinkingLevel: 'think',
  llmConnections: [{ slug: 'claude-max', name: 'Claude' }],
  decisionLayer: { enabled: true, provider: 'typesafe' },
  enable1MContext: true,
  migrationsApplied: ['x'],
  colorTheme: 'dracula',
  notificationsEnabled: false,
  serverConfig: { enabled: true, port: 9200, token: 't-123' },
  setupDeferred: true,
  gitBashPath: 'C:\\Git\\bash.exe',
  dismissedUpdateVersion: '1.2.3',
}
const PREFERENCES = { name: 'Johan', email: 'johan@x.test', timezone: 'Europe/Amsterdam', location: { city: 'Utrecht' }, notes: 'likes tea', uiLanguage: 'hu', includeCoAuthoredBy: false, updatedAt: 5 }

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'otto-settings-'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify(CONFIG, null, 2))
  writeFileSync(join(dir, 'preferences.json'), JSON.stringify(PREFERENCES, null, 2))
  return dir
}
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

test('the importer moves config.json and preferences.json into settings, once, and leaves the old files as they were', async () => {
  const db = await setup()
  addUser(db, B, 2)
  addUser(db, A, 1) // the first user owns the UI preferences
  const dir = fixture()
  const before = [hash(join(dir, 'config.json')), hash(join(dir, 'preferences.json'))]

  const first = initSettingsImport(dir, db)
  expect(first.skipped).toBe(0)
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('claude-max')
  expect(getSetting(INSTALL, 'defaultThinkingLevel', db)).toBe('medium')
  expect(getSetting(INSTALL, 'server', db)).toEqual({ enabled: true, port: 9200, token: 't-123' })
  expect(getSetting(INSTALL, 'decisionLayer', db)).toEqual({ enabled: true, provider: 'typesafe' })
  expect(getSetting(INSTALL, 'setupDeferred', db)).toBe(true)
  expect(getSetting(INSTALL, 'gitBashPath', db)).toBe('C:\\Git\\bash.exe')
  expect(getSetting(INSTALL, 'dismissedUpdateVersion', db)).toBe('1.2.3')
  expect(getSetting(INSTALL, 'imports', db).settings).toBeGreaterThan(0)
  const mine = getSettings(userEntity(A), db)
  expect(mine).toMatchObject({
    activeWorkspaceId: 'ws-1',
    activeChatId: '260101-fast-fox',
    colorTheme: 'dracula',
    notificationsEnabled: false,
    timezone: 'Europe/Amsterdam',
    location: { city: 'Utrecht' },
    notes: 'likes tea',
    uiLanguage: 'hu',
    includeCoAuthoredBy: false,
  })
  expect(getSetting(userEntity(B), 'colorTheme', db)).toBe('default') // only the first user
  // name and email are users.name and users.email; the dead enable1MContext and the registry are not settings
  const keys = db.select({ key: settings.key }).from(settings).all().map((row) => row.key)
  expect(keys).not.toContain('name')
  expect(keys).not.toContain('email')
  expect(keys).not.toContain('enable1MContext')
  expect(keys).not.toContain('workspaces')

  const rows = db.select().from(settings).all().length
  updateSetting(userEntity(A), 'colorTheme', 'nord', db) // a change after the import
  deleteSetting(userEntity(A), 'notes', db)
  expect(initSettingsImport(dir, db)).toEqual({ imported: 0, skipped: 0 }) // a second run does nothing
  expect(getSetting(userEntity(A), 'colorTheme', db)).toBe('nord')
  expect(getSetting(userEntity(A), 'notes', db)).toBe('')
  expect(db.select().from(settings).all()).toHaveLength(rows - 1) // only the deleted row is gone

  expect([hash(join(dir, 'config.json')), hash(join(dir, 'preferences.json'))]).toEqual(before)
  expect(readdirSync(dir).map((name) => name.replace(/\d{4}-\d{2}-\d{2}$/, 'DATE')).sort()).toEqual(['config.json', 'config.json.pre-db-DATE', 'preferences.json'])
})

test('a key that already has a row is not overwritten, and a bad value is skipped', async () => {
  const db = await setup()
  addUser(db, A, 1)
  updateSetting(userEntity(A), 'colorTheme', 'nord', db)
  const dir = fixture()
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...CONFIG, sendMessageKey: 'tab', spellCheck: true }))
  const result = initSettingsImport(dir, db)
  expect(result.skipped).toBe(1)
  expect(getSetting(userEntity(A), 'colorTheme', db)).toBe('nord')
  expect(getSetting(userEntity(A), 'sendMessageKey', db)).toBe('enter')
  expect(getSetting(userEntity(A), 'spellCheck', db)).toBe(true)
})

test('with no user yet the install keys are imported and the rest waits for the first user', async () => {
  const db = await setup()
  const dir = fixture()
  initSettingsImport(dir, db)
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('claude-max')
  expect(getSetting(INSTALL, 'imports', db)).toEqual({})
  addUser(db, A, 1)
  initSettingsImport(dir, db)
  expect(getSetting(userEntity(A), 'colorTheme', db)).toBe('dracula')
  expect(getSetting(INSTALL, 'imports', db).settings).toBeGreaterThan(0)
})

test('missing or unreadable old files import nothing and do not fail', async () => {
  const db = await setup()
  addUser(db, A, 1)
  const dir = mkdtempSync(join(tmpdir(), 'otto-settings-'))
  writeFileSync(join(dir, 'config.json'), '{not json')
  expect(initSettingsImport(dir, db)).toEqual({ imported: 0, skipped: 0 })
  expect(getSetting(INSTALL, 'imports', db).settings).toBeGreaterThan(0)
})
