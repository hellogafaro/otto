import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { loadStoredConfig, saveConfig } from '../config/storage.ts'
import { getCredentialManager } from '../credentials/index.ts'
import { initDb } from '../db/index.ts'
import { deleteSetting, getSetting, INSTALL } from '../settings/index.ts'
import { settings } from '../settings/schema.ts'
import { secrets } from './schema.ts'
import { initSecretsImport } from './import.ts'

// Runs on the throwaway database and config dir of the test preload, never ~/.otto.
const db = initDb()
const registryPath = join(CONFIG_DIR, 'config.json')
const SECRETS = ['remote-token-1', 'sk-decision-key']
const secretCount = () => db.select().from(secrets).all().length

function arrange() {
  for (const key of ['decisionLayer', 'imports'] as const) deleteSetting(INSTALL, key, db)
  db.delete(settings).run()
  db.delete(secrets).run()
  const root = join(CONFIG_DIR, 'workspaces', 'remote-one')
  mkdirSync(root, { recursive: true })
  writeFileSync(registryPath, JSON.stringify({ workspaces: [{ id: 'ws-remote', name: 'Remote', rootPath: root, createdAt: 1, remoteServer: { url: 'wss://h:9100', token: 'remote-token-1', remoteWorkspaceId: 'rw' } }] }))
}

beforeEach(() => arrange())
afterAll(() => rmSync(registryPath, { force: true }))

test('moves the remote workspace tokens and the decision keys into secrets, once', async () => {
  await getCredentialManager().set({ type: 'decision_api_key', name: 'openrouter' }, { value: 'sk-decision-key' })
  const logged: string[] = []
  const spies = (['log', 'warn', 'error', 'info'] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))))
  try {
    expect(await initSecretsImport()).toEqual({ imported: 2 })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }

  // the registry: no token in the file, the token back in memory
  const file = readFileSync(registryPath, 'utf-8')
  expect(file).not.toContain('remote-token-1')
  expect(JSON.parse(file).workspaces[0].remoteServer).toEqual({ url: 'wss://h:9100', remoteWorkspaceId: 'rw', tokenSecretId: expect.any(String) })
  expect(loadStoredConfig()?.workspaces[0]?.remoteServer?.token).toBe('remote-token-1')
  // the decision key
  expect(await getCredentialManager().getDecisionApiKey('openrouter')).toBe('sk-decision-key')
  expect(getSetting(INSTALL, 'decisionLayer', db).keySecretIds?.openrouter).toMatch(/^[0-9a-z]{12}$/)

  // no secret is in a settings row, the database's plain columns or a log line
  for (const value of SECRETS) {
    expect(JSON.stringify(db.select().from(settings).all())).not.toContain(value)
    expect(JSON.stringify(db.select().from(secrets).all())).not.toContain(value)
    expect(logged.join('\n')).not.toContain(value)
  }
  expect(secretCount()).toBe(2)

  // a second run changes nothing
  const rows = JSON.stringify(db.select().from(secrets).all())
  expect(await initSecretsImport()).toEqual({ imported: 0 })
  expect(JSON.stringify(db.select().from(secrets).all())).toBe(rows)
})

test('a remote workspace token is replaced in place and its secret goes with the workspace', async () => {
  await initSecretsImport()
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
