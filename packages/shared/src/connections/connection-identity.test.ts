import { expect, test } from 'bun:test'
import { openDb } from '../db'
import { pushSchema } from '../db/push'
import { createSecretsStore, parseEncryptionKey } from '../secrets'
import { createConnectionsStore, userScope, workspaceScope } from './index'
import { getSetting, userEntity } from '../settings'

async function fixture() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return { db, store: createConnectionsStore(db, createSecretsStore(db, parseEncryptionKey('0'.repeat(64)))) }
}

test('visible identity listings retain shadowed records while legacy slug lookup retains precedence', async () => {
  const { db, store } = await fixture()
  try {
    const rows = ['install', workspaceScope('workspace'), userScope('owner'), userScope('private')].map((scope) => store.createConnection({ scope, slug: 'same', type: 'openai', authType: 'api_key', title: scope }, { apiKey: `controlled-${scope}-key` }))
    const where = { userId: 'owner', workspaceId: 'workspace' }
    expect(store.getConnections(where).map((row) => row.id)).toEqual([rows[2]!.id])
    expect(store.getVisibleConnections(where).map((row) => row.id)).toEqual([rows[2]!.id, rows[1]!.id, rows[0]!.id])
    expect(store.getConnectionById(rows[1]!.id, where)?.scope).toBe(workspaceScope('workspace'))
    expect(store.getConnectionById(rows[3]!.id, where)).toBeUndefined()
    expect(store.getConnectionById(rows[0]!.id, { userId: 'owner', installToo: false })).toBeUndefined()
    expect(store.setDefaultConnection('same', where, rows[1]!.id)).toBe(true)
    expect(store.getDefaultConnection(where)?.id).toBe(rows[1]!.id)
    expect(store.setDefaultConnection('same', where, rows[3]!.id)).toBe(false)
    expect(store.setDefaultConnection('same', where)).toBe(true)
    expect(store.getDefaultConnection(where)?.id).toBe(rows[2]!.id)
  } finally { db.$client.close() }
})

test('credentials and ABA changes advance monotonic versions and stale CAS never replaces a secret', async () => {
  const { db, store } = await fixture()
  try {
    const row = store.createConnection({ slug: 'versioned', type: 'openai', authType: 'api_key', title: 'Versioned', baseUrl: 'https://original.example/v1' }, { apiKey: 'controlled-old-key' })
    store.setCredential(row.slug, { apiKey: 'controlled-new-key' })
    const changed = store.getConnection(row.slug)!
    expect(changed.updatedAt).toBeGreaterThan(row.updatedAt)
    expect(() => store.updateConnection(row.id, { title: 'Stale' }, { apiKey: 'controlled-stale-key' }, row.updatedAt)).toThrow('Connection changed')
    expect(store.getCredential(row.slug)).toEqual({ apiKey: 'controlled-new-key' })
    expect(store.getConnection(row.slug)).toEqual(changed)
    const next = store.updateConnection(row.id, { baseUrl: 'https://next.example/v1' }, undefined, changed.updatedAt)
    const back = store.updateConnection(row.id, { baseUrl: row.baseUrl }, undefined, next.updatedAt)
    expect(back.updatedAt).toBeGreaterThan(next.updatedAt)
    expect(() => store.deleteConnection(row.id, changed.updatedAt)).toThrow('Connection changed')
    expect(store.getConnection(row.slug)?.id).toBe(row.id)
  } finally { db.$client.close() }
})

test('the default slug and identity commit together or remain unchanged', async () => {
  const { db, store } = await fixture()
  try {
    const scope = userScope('owner')
    const first = store.createConnection({ slug: 'first', scope, type: 'openai', authType: 'api_key', title: 'First' })
    const second = store.createConnection({ slug: 'second', scope, type: 'openai', authType: 'api_key', title: 'Second' })
    const where = { userId: 'owner' }
    store.setDefaultConnection(first.slug, where, first.id)
    db.$client.exec("CREATE TRIGGER refuse_default_identity BEFORE UPDATE ON settings WHEN OLD.key = 'userDefaultConnectionId' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
    expect(() => store.setDefaultConnection(second.slug, where, second.id)).toThrow('fixture failure')
    expect(getSetting(userEntity('owner'), 'userDefaultConnectionSlug', db)).toBe(first.slug)
    expect(getSetting(userEntity('owner'), 'userDefaultConnectionId', db)).toBe(first.id)
    expect(store.getDefaultConnection(where)?.id).toBe(first.id)
  } finally { db.$client.close() }
})

test('safe schema push gives pre-version rows zero without losing their encrypted credentials', async () => {
  const { db, store } = await fixture()
  try {
    const row = store.createConnection({ slug: 'old-row', type: 'custom', authType: 'api_key', title: 'Legacy', baseUrl: 'https://compatible.example/v1', config: { customEndpoint: { api: 'openai-completions', supportsImages: true } } }, { apiKey: 'controlled-preserved-key' })
    db.$client.exec('ALTER TABLE connections DROP COLUMN updated_at')
    await pushSchema(db)
    const old = store.getConnection(row.slug)!
    expect(old).toMatchObject({ id: row.id, type: 'custom', updatedAt: 0, config: row.config })
    expect(store.getCredential(row.slug)).toEqual({ apiKey: 'controlled-preserved-key' })
    const changed = store.updateConnection(row.id, { title: 'Edited' }, undefined, 0)
    expect(changed.updatedAt).toBeGreaterThan(0)
    expect(store.getCredential(row.slug)).toEqual({ apiKey: 'controlled-preserved-key' })
  } finally { db.$client.close() }
})
