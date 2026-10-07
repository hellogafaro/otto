import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCredentialManager } from '../credentials/index.ts'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createSecretsStore, parseEncryptionKey } from '../secrets/index.ts'
import { secrets } from '../secrets/schema.ts'
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts'
import { createId } from '../id.ts'
import { users } from '../users/schema.ts'
import { createConnectionsStore, userScope } from './index.ts'
import { initClaudeCodeOwnerImport, initConnectionsImport, initConnectionsPiProviderImport } from './import.ts'
import { connections } from './schema.ts'

// The credential manager writes `credentials.enc` into the throwaway config dir of the test preload, never ~/.otto.
const KEY = parseEncryptionKey('1'.repeat(64))
const SECRET_VALUES = ['sk-or-secret-key', 'oauth-access-1', 'oauth-refresh-1', 'codex-access', 'codex-id', 'AKIASECRETID', 'aws-secret-key', '{"private_key":"gcp-secret"}', 'legacy-anthropic-key']

const dir = mkdtempSync(join(tmpdir(), 'otto-import-'))
const configPath = join(dir, 'config.json')
const config = {
  workspaces: [],
  defaultLlmConnection: 'codex',
  llmConnections: [
    { slug: 'claude-max', name: 'Claude Max', providerType: 'anthropic', authType: 'oauth', models: ['claude-opus-5-5'], defaultModel: 'claude-opus-5-5', oauthAccountEmail: 'me@x.test', oauthProfileVerifiedAt: 7, createdAt: 1000, lastUsedAt: 2000 },
    { slug: 'codex', name: 'ChatGPT Plus', providerType: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', createdAt: 1100 },
    { slug: 'openrouter', name: 'OpenRouter', providerType: 'pi', authType: 'api_key', piAuthProvider: 'openrouter', midStreamBehavior: 'queue', createdAt: 1200 },
    { slug: 'bedrock', name: 'Bedrock', providerType: 'pi', authType: 'iam_credentials', piAuthProvider: 'amazon-bedrock', createdAt: 1300 },
    { slug: 'vertex', name: 'Vertex', providerType: 'pi', authType: 'service_account_file', piAuthProvider: 'google-vertex', createdAt: 1400 },
    { slug: 'ollama', name: 'Ollama', providerType: 'pi_compat', authType: 'none', baseUrl: 'http://localhost:11434/v1', customEndpoint: { api: 'openai-completions' }, defaultModel: 'llama', createdAt: 1500 },
    { slug: 'anthropic-api', name: 'Anthropic', providerType: 'anthropic', authType: 'api_key', createdAt: 1600 },
    { slug: 'old', name: 'Old bedrock', providerType: 'bedrock', authType: 'iam_credentials', createdAt: 1700 },
    'not an object',
  ],
}

beforeAll(async () => {
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  const manager = getCredentialManager()
  await manager.set({ type: 'llm_oauth', connectionSlug: 'codex' }, { value: 'codex-access', refreshToken: 'oauth-refresh-1', expiresAt: 99, idToken: 'codex-id' })
  await manager.set({ type: 'llm_api_key', connectionSlug: 'openrouter' }, { value: 'sk-or-secret-key' })
  await manager.set({ type: 'llm_iam', connectionSlug: 'bedrock' }, { value: 'aws-secret-key', awsAccessKeyId: 'AKIASECRETID', awsRegion: 'us-east-1' })
  await manager.set({ type: 'llm_service_account', connectionSlug: 'vertex' }, { value: '{"private_key":"gcp-secret"}', gcpProjectId: 'p', gcpRegion: 'r', serviceAccountEmail: 'sa@x' })
  // the global entry of before connections: anthropic-api has no `llm_*` entry (a Claude subscription keeps no token)
  await manager.set({ type: 'anthropic_api_key' }, { value: 'legacy-anthropic-key' })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function fresh() {
  const db = openDb(':memory:')
  await pushSchema(db)
  const store = createConnectionsStore(db, createSecretsStore(db, KEY))
  return { db, store }
}

test('imports the connections and their credentials of the old files', async () => {
  const { db, store } = await fresh()
  const result = await initConnectionsImport({ configDir: dir, db, store })
  expect(result).toEqual({ imported: 7, skipped: 2 })

  expect(store.getConnections().map((c) => c.slug)).toEqual(['claude-max', 'codex', 'openrouter', 'bedrock', 'vertex', 'ollama', 'anthropic-api'])
  // a Claude subscription is the user's own `claude` login: no Otto-held token, no account
  expect(store.getConnection('claude-max')).toMatchObject({
    scope: 'install',
    type: 'claude-code',
    authType: 'cli_login',
    title: 'Claude Max',
    defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5'],
    hasSecret: false,
  })
  expect(store.getConnection('claude-max')?.createdAt).toEqual(new Date(1000))
  expect(store.getConnection('codex')).toMatchObject({ type: 'openai-codex', authType: 'oauth' })
  expect(store.getConnection('openrouter')).toMatchObject({ type: 'openrouter', config: { midStreamBehavior: 'queue' } })
  expect(store.getConnection('openrouter')?.config).toEqual({ midStreamBehavior: 'queue' })
  expect(store.getConnection('anthropic-api')).toMatchObject({ type: 'anthropic', authType: 'api_key' })
  expect(store.getConnection('ollama')).toMatchObject({ type: 'custom', baseUrl: 'http://localhost:11434/v1', config: { customEndpoint: { api: 'openai-completions' } }, hasSecret: false })

  expect(store.getCredential('claude-max')).toBeUndefined()
  expect(store.getCredential('codex')).toEqual({ accessToken: 'codex-access', refreshToken: 'oauth-refresh-1', expiresAt: 99, idToken: 'codex-id' })
  expect(store.getCredential('openrouter')).toEqual({ apiKey: 'sk-or-secret-key' })
  expect(store.getCredential('bedrock')).toEqual({ accessKeyId: 'AKIASECRETID', secretAccessKey: 'aws-secret-key', region: 'us-east-1' })
  expect(store.getCredential('vertex')).toEqual({ serviceAccountJson: '{"private_key":"gcp-secret"}', projectId: 'p', region: 'r', email: 'sa@x' })
  expect(store.getCredential('anthropic-api')).toEqual({ apiKey: 'legacy-anthropic-key' })
  expect(db.select().from(secrets).all()).toHaveLength(5)
  expect(getSetting(INSTALL, 'imports', db).connections).toBeGreaterThan(0)
})

test('a second run changes nothing, even after a connection was edited in between', async () => {
  const { db, store } = await fresh()
  await initConnectionsImport({ configDir: dir, db, store })
  const edited = store.getConnection('openrouter')!
  store.updateConnection(edited.id, { title: 'Mine' }, { apiKey: 'sk-new' })
  const rows = JSON.stringify(db.select().from(connections).all())
  const secretRows = JSON.stringify(db.select().from(secrets).all())

  expect(await initConnectionsImport({ configDir: dir, db, store })).toEqual({ imported: 0, skipped: 0 })
  expect(JSON.stringify(db.select().from(connections).all())).toBe(rows)
  expect(JSON.stringify(db.select().from(secrets).all())).toBe(secretRows)
  expect(store.getCredential('openrouter')).toEqual({ apiKey: 'sk-new' })
})

test('a run that stopped half-way is finished by the next one: rows are reused by slug, not duplicated', async () => {
  const { db, store } = await fresh()
  // what the old bridge left behind: a row of the slug with a catalog type and a raw-string secret
  const partial = store.createConnection({ slug: 'openrouter', type: 'pi', authType: 'api_key', title: 'bridge' })
  store.updateConnection(partial.id, {}, { apiKey: 'sk-stale' })
  const secretId = db.select().from(secrets).all()[0]!.id

  await initConnectionsImport({ configDir: dir, db, store })
  expect(store.getConnections().filter((c) => c.slug === 'openrouter')).toHaveLength(1)
  expect(store.getConnection('openrouter')).toMatchObject({ id: partial.id, title: 'OpenRouter', type: 'openrouter' })
  expect(store.getCredential('openrouter')).toEqual({ apiKey: 'sk-or-secret-key' })
  expect(db.select().from(secrets).all().some((row) => row.id === secretId)).toBe(true)
  expect(db.select().from(secrets).all()).toHaveLength(5)
})

test('rows written before Pi only get their Pi provider, once; the Claude OAuth token secret is deleted, no value is logged', async () => {
  const { db, store } = await fresh()
  const claude = store.createConnection({ slug: 'claude-max', type: 'anthropic', authType: 'oauth', title: 'Claude Max', config: { account: { oauthAccountEmail: 'me@x.test' } } as never }, { accessToken: 'claude-token-secret', refreshToken: 'claude-refresh-secret' })
  store.createConnection({ slug: 'codex', type: 'pi', authType: 'oauth', title: 'ChatGPT', config: { piAuthProvider: 'openai-codex', midStreamBehavior: 'steer' } as never }, { accessToken: 'codex-token-secret' })
  store.createConnection({ slug: 'local', type: 'pi_compat', authType: 'none', title: 'Local', baseUrl: 'http://localhost:11434/v1', config: { customEndpoint: { api: 'openai-completions' } } })
  store.createConnection({ slug: 'key', type: 'anthropic', authType: 'api_key', title: 'Key' }, { apiKey: 'sk-ant-secret' })
  expect(db.select().from(secrets).all()).toHaveLength(3)

  const logged: string[] = []
  const spies = (['log', 'warn', 'error', 'info'] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))))
  try {
    expect(initConnectionsPiProviderImport(db, store)).toBe(3)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  expect(store.getConnection('claude-max')).toMatchObject({ id: claude.id, type: 'claude-code', authType: 'cli_login', hasSecret: false, config: {} })
  expect(db.select().from(connections).all().find((row) => row.id === claude.id)?.config).not.toContain('me@x.test')
  expect(store.getConnection('codex')).toMatchObject({ type: 'openai-codex', authType: 'oauth', hasSecret: true, config: { midStreamBehavior: 'steer' } })
  expect('piAuthProvider' in store.getConnection('codex')!.config).toBe(false)
  expect(store.getConnection('local')).toMatchObject({ type: 'custom', authType: 'none', config: { customEndpoint: { api: 'openai-completions' } } })
  expect(store.getConnection('key')).toMatchObject({ type: 'anthropic', authType: 'api_key', hasSecret: true })
  expect(store.getCredential('codex')).toEqual({ accessToken: 'codex-token-secret' })
  const values = JSON.stringify(db.select().from(secrets).all())
  expect(db.select().from(secrets).all()).toHaveLength(2)
  expect(values).not.toContain('claude-')
  for (const value of ['claude-token-secret', 'codex-token-secret', 'sk-ant-secret']) expect(logged.join('\n')).not.toContain(value)

  const rows = JSON.stringify(db.select().from(connections).all())
  expect(initConnectionsPiProviderImport(db, store)).toBe(0)
  expect(JSON.stringify(db.select().from(connections).all())).toBe(rows)
})

test('the old files are read and never changed; no secret is logged', async () => {
  const { db, store } = await fresh()
  const before = readFileSync(configPath, 'utf-8')
  const credentialsFile = join(process.env.OTTO_CONFIG_DIR!, 'credentials.enc')
  const credentialsBefore = statSync(credentialsFile).mtimeMs
  const logged: string[] = []
  const spies = (['log', 'warn', 'error', 'info'] as const).map((level) => spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))))
  try {
    await initConnectionsImport({ configDir: dir, db, store })
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  expect(readFileSync(configPath, 'utf-8')).toBe(before)
  expect(statSync(credentialsFile).mtimeMs).toBe(credentialsBefore)
  expect(logged.length).toBeGreaterThan(0) // the skipped ones are reported
  for (const value of SECRET_VALUES) expect(logged.join('\n')).not.toContain(value)
})

test('with no config.json (a fresh install) nothing is imported and the run is recorded', async () => {
  const { db, store } = await fresh()
  const empty = mkdtempSync(join(tmpdir(), 'otto-import-empty-'))
  try {
    expect(await initConnectionsImport({ configDir: empty, db, store })).toEqual({ imported: 0, skipped: 0 })
    expect(getSetting(INSTALL, 'imports', db).connections).toBeGreaterThan(0)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('a connection whose credential cannot be read is imported without one, and its secret is never logged', async () => {
  const { db, store } = await fresh()
  const broken = mkdtempSync(join(tmpdir(), 'otto-import-broken-'))
  writeFileSync(join(broken, 'config.json'), JSON.stringify({ workspaces: [], llmConnections: [{ slug: 'nokey', name: 'No key', providerType: 'pi', authType: 'api_key', piAuthProvider: 'groq' }] }))
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(await initConnectionsImport({ configDir: broken, db, store })).toEqual({ imported: 1, skipped: 0 })
    expect(store.getConnection('nokey')?.hasSecret).toBe(false)
    expect(String(warn.mock.calls[0])).toContain('no credential found for nokey')
  } finally {
    warn.mockRestore()
    rmSync(broken, { recursive: true, force: true })
  }
})

test("an install Claude subscription becomes the instance owner's own, once there is one; idempotent", async () => {
  const { db, store } = await fresh()
  await initConnectionsImport({ configDir: dir, db, store })
  // no user yet: it waits
  expect(initClaudeCodeOwnerImport(db)).toBe(0)
  expect(store.getConnection('claude-max')?.scope).toBe('install')
  updateSetting(INSTALL, 'defaultConnectionSlug', 'claude-max', db)

  const owner = createId()
  db.insert(users).values({ id: owner, name: 'Owner', email: 'owner@x.test', createdAt: new Date(1), updatedAt: new Date(1) }).run()
  db.insert(users).values({ id: createId(), name: 'Later', email: 'later@x.test', createdAt: new Date(2), updatedAt: new Date(2) }).run()
  expect(initClaudeCodeOwnerImport(db)).toBe(1)
  expect(store.getConnection('claude-max', { userId: owner })).toMatchObject({ scope: userScope(owner), type: 'claude-code' })
  expect(store.getConnection('claude-max')).toBeUndefined()
  // the install's default moved off it
  expect(getSetting(INSTALL, 'defaultConnectionSlug', db)).toBe('codex')
  expect(initClaudeCodeOwnerImport(db)).toBe(0)
  // and every boot runs it
  expect(await initConnectionsImport({ configDir: dir, db, store })).toEqual({ imported: 0, skipped: 0 })
  expect(store.getConnection('claude-max', { userId: owner })?.scope).toBe(userScope(owner))
})
