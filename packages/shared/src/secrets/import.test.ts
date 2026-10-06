import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { getServerConfig, loadStoredConfig, saveConfig, setServerConfig } from '../config/storage.ts'
import { getCredentialManager } from '../credentials/index.ts'
import { initDb } from '../db/index.ts'
import { deleteSetting, getSetting, INSTALL } from '../settings/index.ts'
import { settings } from '../settings/schema.ts'
import { secrets } from './schema.ts'
import { initSecretsImport } from './import.ts'

// Runs on the throwaway database and config dir of the test preload, never ~/.otto.
const db = initDb()
const registryPath = join(CONFIG_DIR, 'config.json')
const SECRETS = ['srv-token-1', 'remote-token-1', 'sk-decision-key']
const rawSetting = (key: string) => db.select({ value: settings.value }).from(settings).all().find((row) => row.value.includes(key))?.value
const secretCount = () => db.select().from(secrets).all().length

const fileDir = mkdtempSync(join(tmpdir(), 'otto-secrets-import-'))
const fileConfig = join(fileDir, 'config.json')
afterAll(() => rmSync(fileDir, { recursive: true, force: true }))

function arrange(options: { tokenInRow?: boolean } = {}) {
  for (const key of ['server', 'decisionLayer', 'imports'] as const) deleteSetting(INSTALL, key, db)
  db.delete(settings).run()
  db.delete(secrets).run()
  writeFileSync(fileConfig, JSON.stringify({ workspaces: [], serverConfig: { enabled: true, port: 9300, token: 'srv-token-1' } }))
  // the row the settings importer made: without the token (its reader drops it), or, from an earlier build, with it
  const server = options.tokenInRow ? { enabled: true, port: 9300, token: 'srv-token-1' } : { enabled: true, port: 9300 }
  db.insert(settings).values({ entity: INSTALL, key: 'server', value: JSON.stringify(server) }).run()
  const root = join(CONFIG_DIR, 'workspaces', 'remote-one')
  mkdirSync(root, { recursive: true })
  writeFileSync(registryPath, JSON.stringify({ workspaces: [{ id: 'ws-remote', name: 'Remote', rootPath: root, createdAt: 1, remoteServer: { url: 'wss://h:9100', token: 'remote-token-1', remoteWorkspaceId: 'rw' } }] }))
}

beforeEach(() => arrange())
afterAll(() => rmSync(registryPath, { force: true }))

test('moves the server token, the remote workspace tokens and the decision keys into secrets, once', async () => {
  await getCredentialManager().set({ type: 'decision_api_key', name: 'openrouter' }, { value: 'sk-decision-key' })
  const logged: string[] = []
  const spies = (['log', 'warn', 'error', 'info'] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))))
  const fileBefore = readFileSync(fileConfig, 'utf-8')
  try {
    expect(await initSecretsImport({ configDir: fileDir })).toEqual({ imported: 3 })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }

  // the server token
  expect(getServerConfig()).toMatchObject({ enabled: true, port: 9300, token: 'srv-token-1' })
  expect(getSetting(INSTALL, 'server', db).tokenSecretId).toMatch(/^[0-9a-z]{12}$/)
  // the registry: no token in the file, the token back in memory
  const file = readFileSync(registryPath, 'utf-8')
  expect(file).not.toContain('remote-token-1')
  expect(JSON.parse(file).workspaces[0].remoteServer).toEqual({ url: 'wss://h:9100', remoteWorkspaceId: 'rw', tokenSecretId: expect.any(String) })
  expect(loadStoredConfig()?.workspaces[0]?.remoteServer?.token).toBe('remote-token-1')
  // the decision key
  expect(await getCredentialManager().getDecisionApiKey('openrouter')).toBe('sk-decision-key')
  expect(getSetting(INSTALL, 'decisionLayer', db).keySecretIds?.openrouter).toMatch(/^[0-9a-z]{12}$/)

  // no secret is in a settings row, the database's plain columns, a log line or the old config
  for (const value of SECRETS) {
    expect(JSON.stringify(db.select().from(settings).all())).not.toContain(value)
    expect(JSON.stringify(db.select().from(secrets).all())).not.toContain(value)
    expect(logged.join('\n')).not.toContain(value)
  }
  expect(readFileSync(fileConfig, 'utf-8')).toBe(fileBefore)
  expect(secretCount()).toBe(3)

  // a second run changes nothing
  const rows = JSON.stringify(db.select().from(secrets).all())
  expect(await initSecretsImport({ configDir: fileDir })).toEqual({ imported: 0 })
  expect(JSON.stringify(db.select().from(secrets).all())).toBe(rows)
})

test('takes a plain token out of the server setting of an earlier build', async () => {
  arrange({ tokenInRow: true })
  await initSecretsImport({ configDir: fileDir })
  expect(rawSetting('port')).not.toContain('srv-token-1')
  expect(getServerConfig().token).toBe('srv-token-1')
})

test('the server token is written and read through its secret, and replaced in place', () => {
  db.delete(settings).run()
  db.delete(secrets).run()
  setServerConfig({ enabled: true, port: 9100 }) // enabling makes one
  const generated = getServerConfig().token
  expect(generated).toMatch(/^[0-9a-f-]{36}$/)
  expect(secretCount()).toBe(1)
  expect(rawSetting('port')).not.toContain(generated!)

  setServerConfig({ enabled: true, port: 9100, token: 'chosen-token' })
  expect(getServerConfig().token).toBe('chosen-token')
  expect(secretCount()).toBe(1)
  setServerConfig({ enabled: false, port: 9100 }) // no token given: the one that exists stays
  expect(getServerConfig()).toMatchObject({ enabled: false, token: 'chosen-token' })
})

test('a remote workspace token is replaced in place and its secret goes with the workspace', async () => {
  await initSecretsImport({ configDir: fileDir })
  const before = db.select().from(secrets).all().map((row) => row.id).sort()
  const config = loadStoredConfig()!
  config.workspaces[0]!.remoteServer!.token = 'remote-token-2'
  saveConfig(config)
  expect(db.select().from(secrets).all().map((row) => row.id).sort()).toEqual(before)
  expect(loadStoredConfig()?.workspaces[0]?.remoteServer?.token).toBe('remote-token-2')
  expect(readFileSync(registryPath, 'utf-8')).not.toContain('remote-token-2')

  saveConfig({ ...config, workspaces: [] })
  expect(db.select().from(secrets).all()).toHaveLength(before.length - 1)
})
