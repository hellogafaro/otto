import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { getCredentialManager } from '../../credentials/index.ts'
import { openDb } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { createDiskFileStore } from '../../library/file-store.ts'
import { startS3Double, type S3Double } from '../../library/__tests__/s3-double.ts'
import { createS3Client, createS3FileStore } from '../../library/s3-file-store.ts'
import { createSecretsStore, parseEncryptionKey } from '../../secrets/index.ts'
import { secrets } from '../../secrets/schema.ts'
import { INSTALL, getSetting } from '../../settings/index.ts'
import { initSourcesImport } from '../import.ts'
import { sources } from '../schema.ts'
import { createSourcesStore, type SourcesTarget } from '../store.ts'

const dec = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)
const config = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: `${name}_a1`, name, slug: name.toLowerCase(), enabled: true, provider: 'custom', type: 'api', api: { baseUrl: 'https://x.test', authType: 'none' }, ...extra }, null, 2)

const WS = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
const KEY = parseEncryptionKey('1'.repeat(64))
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'otto-sources-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function newDb() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return db
}
type TestDb = Awaited<ReturnType<typeof newDb>>

const startDouble = () => {
  const double = startS3Double()
  cleanups.push(() => double.stop())
  return double
}

/** One node on S3: its own workspace folder (`<root>/sources`), the shared bucket and database. */
async function s3Node(db: TestDb, double: S3Double) {
  const root = await tempDir()
  const client = createS3Client({ endpoint: double.url, bucket: double.bucket, region: 'r', accessKeyId: double.accessKeyId, secretAccessKey: 'secret' })
  const target: SourcesTarget = { store: createS3FileStore({ client, keyPrefix: `workspaces/${WS}/sources/`, paths: true }), dir: join(root, 'sources'), remote: true }
  return { root, dir: target.dir, store: createSourcesStore(db, createSecretsStore(db, KEY), () => target) }
}

async function diskNode(db: TestDb) {
  const root = await tempDir()
  const target: SourcesTarget = { store: createDiskFileStore(join(root, 'sources'), { paths: true }), dir: join(root, 'sources'), remote: false }
  return { root, dir: target.dir, store: createSourcesStore(db, createSecretsStore(db, KEY), () => target) }
}

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
}

describe('sources on rows plus S3 bundles', () => {
  test('a folder becomes a row indexed from config.json and a bundle under workspaces/<ws>/sources/<slug>/', async () => {
    const double = startDouble()
    const a = await s3Node(await newDb(), double)
    await writeFiles(join(a.dir, 'linear'), {
      'config.json': config('Linear', { type: 'mcp', mcp: { transport: 'http', url: 'https://mcp.test', authType: 'oauth' }, api: undefined }),
      'guide.md': '# Linear\n',
      'permissions.json': '{}',
    })
    expect(await a.store.syncLocalSource(WS, 'linear', ME)).toBe('created')
    expect(a.store.getSource(WS, 'linear')).toMatchObject({ slug: 'linear', title: 'Linear', type: 'mcp', authStatus: 'needs_auth', createdBy: ME })
    expect([...double.objects.keys()].sort()).toEqual(['workspaces/ws1/sources/linear/config.json', 'workspaces/ws1/sources/linear/guide.md', 'workspaces/ws1/sources/linear/permissions.json'])
    expect(a.store.getLoadedSources(WS).map((s) => [s.config.slug, s.config.name, s.guide?.raw])).toEqual([['linear', 'Linear', '# Linear\n']])
    expect(await a.store.syncLocalSource(WS, 'linear')).toBe('unchanged')
  })

  test('auth_status follows config.json: signed in, failed, needs sign-in', async () => {
    const a = await diskNode(await newDb())
    const mcp = { type: 'mcp', api: undefined, mcp: { transport: 'http', url: 'https://mcp.test', authType: 'bearer' } }
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S', mcp) })
    await a.store.syncLocalSource(WS, 's')
    expect(a.store.getSource(WS, 's')?.authStatus).toBe('needs_auth')
    await writeFile(join(a.dir, 's', 'config.json'), config('S', { ...mcp, isAuthenticated: true, connectionStatus: 'connected' }))
    await a.store.syncLocalSource(WS, 's')
    expect(a.store.getSource(WS, 's')?.authStatus).toBe('ok')
    await writeFile(join(a.dir, 's', 'config.json'), config('S', { ...mcp, isAuthenticated: true, connectionStatus: 'failed' }))
    await a.store.syncLocalSource(WS, 's')
    expect(a.store.getSource(WS, 's')?.authStatus).toBe('error')
  })

  test('a config.json that does not parse, or has no name or type, is left alone', async () => {
    const a = await s3Node(await newDb(), startDouble())
    await writeFiles(join(a.dir, 'broken'), { 'config.json': '{nope' })
    await writeFiles(join(a.dir, 'nameless'), { 'config.json': JSON.stringify({ type: 'api' }) })
    await writeFiles(join(a.dir, 'typeless'), { 'config.json': JSON.stringify({ name: 'X', type: 'ftp' }) })
    await writeFiles(join(a.dir, 'Bad Slug'), { 'config.json': config('Bad') })
    await writeFiles(join(a.dir, 'good'), { 'config.json': config('Good') })
    expect(await a.store.syncSources(WS)).toEqual({ created: 1, invalid: 4 })
    expect(a.store.getSources(WS).map((s) => s.slug)).toEqual(['good'])
    expect(await readFile(join(a.dir, 'broken', 'config.json'), 'utf-8')).toBe('{nope')
  })

  test('sync round trip: a local edit is pushed, the other node materializes it', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S') })
    await a.store.syncLocalSource(WS, 's')
    const created = a.store.getSource(WS, 's')!

    expect(await b.store.syncSources(WS)).toEqual({ materialized: 1 })
    expect(await readFile(join(b.dir, 's', 'config.json'), 'utf-8')).toBe(config('S'))

    await writeFiles(join(a.dir, 's'), { 'config.json': config('S edited'), 'guide.md': 'guide' })
    expect(await a.store.syncLocalSource(WS, 's')).toBe('pushed')
    expect(a.store.getSource(WS, 's')).toMatchObject({ title: 'S edited' })
    expect(a.store.getSource(WS, 's')!.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(dec(double.objects.get('workspaces/ws1/sources/s/guide.md')?.bytes)).toBe('guide')

    expect(await b.store.syncSources(WS)).toEqual({ materialized: 1 })
    expect(await readFile(join(b.dir, 's', 'guide.md'), 'utf-8')).toBe('guide')
  })

  test('two writers: the second push is refused, its folder reloads from the winner and its edit is kept', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S') })
    await a.store.syncLocalSource(WS, 's')
    await b.store.syncSources(WS)

    await writeFile(join(a.dir, 's', 'guide.md'), 'From A')
    await writeFile(join(b.dir, 's', 'guide.md'), 'From B')
    expect(await a.store.syncLocalSource(WS, 's')).toBe('pushed')
    expect(await b.store.syncLocalSource(WS, 's')).toBe('conflict')
    expect(await readFile(join(b.dir, 's', 'guide.md'), 'utf-8')).toBe('From A')
    const kept = await readdir(join(b.root, '.conflicts', 'sources'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(b.root, '.conflicts', 'sources', kept[0]!, 'guide.md'), 'utf-8')).toBe('From B')
  })

  test('a source deleted elsewhere removes the folder; delete removes the row, the credential, the bundle and the folder', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S') })
    await a.store.syncLocalSource(WS, 's')
    await a.store.setCredential(WS, 's', 'source_apikey', { value: 'k' })
    await b.store.syncSources(WS)
    await a.store.deleteSource(WS, 's')
    expect(a.store.getSources(WS)).toEqual([])
    expect(db.select().from(secrets).all()).toEqual([])
    expect(double.objects.size).toBe(0)
    expect(existsSync(join(a.dir, 's'))).toBe(false)
    expect(await b.store.syncSources(WS)).toEqual({ removed: 1 })
    await expect(a.store.deleteSource(WS, 's')).rejects.toMatchObject({ code: 'not_found' })
  })

  test('the materializer\'s swap folders are never sources', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S') })
    await a.store.syncLocalSource(WS, 's')
    await writeFiles(join(b.dir, '.tmp-x'), { 'config.json': config('Tmp') })
    expect(await b.store.syncSources(WS)).toEqual({ materialized: 1 })
    expect(b.store.getSources(WS).map((s) => s.slug)).toEqual(['s'])
  })
})

describe('credentials', () => {
  async function withSource(db?: TestDb) {
    const double = startDouble()
    const a = await s3Node(db ?? (await newDb()), double)
    await writeFiles(join(a.dir, 's'), { 'config.json': config('S', { api: { baseUrl: 'https://x.test', authType: 'bearer' } }) })
    await a.store.syncLocalSource(WS, 's')
    return { a, double }
  }

  test('one secret per source holds the credential and its kind; the bucket and the row never see it', async () => {
    const db = await newDb()
    const { a, double } = await withSource(db)
    const before = a.store.getSource(WS, 's')!
    await a.store.setCredential(WS, 's', 'source_oauth', { value: 'access-secret', refreshToken: 'refresh-secret', expiresAt: 5 })
    expect(a.store.getCredential(WS, 's', 'source_oauth')).toEqual({ value: 'access-secret', refreshToken: 'refresh-secret', expiresAt: 5 })
    expect(a.store.getCredential(WS, 's', 'source_bearer')).toBeUndefined()
    expect(a.store.getSource(WS, 's')).toEqual(before) // not a bundle write
    const stored = JSON.stringify([db.select().from(secrets).all(), db.select().from(sources).all()])
    expect(stored).not.toContain('access-secret')
    expect(stored).not.toContain('refresh-secret')
    for (const object of double.objects.values()) expect(dec(object.bytes)).not.toContain('access-secret')

    // saving another kind replaces the credential in the same secret
    await a.store.setCredential(WS, 's', 'source_bearer', { value: 'bearer-secret' })
    expect(a.store.getCredential(WS, 's', 'source_oauth')).toBeUndefined()
    expect(a.store.getCredential(WS, 's', 'source_bearer')).toEqual({ value: 'bearer-secret' })
    expect(db.select().from(secrets).all()).toHaveLength(1)

    expect(a.store.deleteCredential(WS, 's', 'source_oauth')).toBe(false) // not that kind
    expect(a.store.deleteCredential(WS, 's', 'source_bearer')).toBe(true)
    expect(a.store.getCredential(WS, 's', 'source_bearer')).toBeUndefined()
    expect(db.select().from(secrets).all()).toEqual([])
  })

  test('a bundle write and a failed upload leave the credential alone', async () => {
    const { a, double } = await withSource()
    await a.store.setCredential(WS, 's', 'source_bearer', { value: 'keep-me' })
    await writeFile(join(a.dir, 's', 'guide.md'), 'edit')
    expect(await a.store.syncLocalSource(WS, 's')).toBe('pushed')
    expect(a.store.getCredential(WS, 's', 'source_bearer')).toEqual({ value: 'keep-me' })
    double.fail = (method) => method === 'PUT'
    await writeFile(join(a.dir, 's', 'guide.md'), 'edit 2')
    await expect(a.store.syncLocalSource(WS, 's')).rejects.toThrow()
    double.fail = undefined
    expect(a.store.getCredential(WS, 's', 'source_bearer')).toEqual({ value: 'keep-me' })
  })

  test('a credential for a folder that is not a row yet syncs it first; for no folder it is not_found', async () => {
    const a = await diskNode(await newDb())
    await writeFiles(join(a.dir, 'fresh'), { 'config.json': config('Fresh') })
    await a.store.setCredential(WS, 'fresh', 'source_apikey', { value: 'k' })
    expect(a.store.getSource(WS, 'fresh')).toBeDefined()
    expect(a.store.getCredential(WS, 'fresh', 'source_apikey')).toEqual({ value: 'k' })
    await expect(a.store.setCredential(WS, 'nope', 'source_apikey', { value: 'k' })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('deleteWorkspaceCredentials removes every secret of the workspace and keeps the sources', async () => {
    const db = await newDb()
    const { a } = await withSource(db)
    await a.store.setCredential(WS, 's', 'source_bearer', { value: 'x' })
    a.store.deleteWorkspaceCredentials(WS)
    expect(db.select().from(secrets).all()).toEqual([])
    expect(a.store.getSources(WS)).toHaveLength(1)
  })
})

describe('the disk driver (no S3)', () => {
  test('the folder is the store: edits are indexed in place, a deleted folder drops the row', async () => {
    const node = await diskNode(await newDb())
    await writeFiles(join(node.dir, 's'), { 'config.json': config('S') })
    expect(await node.store.syncLocalSource(WS, 's')).toBe('created')
    expect(existsSync(join(node.dir, 's', '.otto-bundle.json'))).toBe(false)
    await writeFile(join(node.dir, 's', 'config.json'), config('S2'))
    expect(await node.store.syncLocalSource(WS, 's')).toBe('pushed')
    expect(node.store.getSource(WS, 's')?.title).toBe('S2')
    await rm(join(node.dir, 's'), { recursive: true })
    expect(await node.store.syncLocalSource(WS, 's')).toBe('removed')
    expect(node.store.getSources(WS)).toEqual([])
  })
})

describe('the importer', () => {
  /** The old file: credentials.enc of the test config dir, keyed by the workspace folder's name. */
  async function oldCredentials(rootPath: string) {
    const manager = getCredentialManager()
    const folder = basename(rootPath)
    await manager.set({ type: 'source_oauth', workspaceId: folder, sourceId: 'linear' }, { value: 'linear-access', refreshToken: 'linear-refresh', expiresAt: 9 })
    await manager.set({ type: 'source_apikey', workspaceId: folder, sourceId: 'shop' }, { value: 'shop-key' })
    await manager.set({ type: 'source_bearer', workspaceId: folder, sourceId: 'bearer-mcp' }, { value: 'bearer-token' }) // an MCP source set to OAuth, signed in with a bearer token
    return manager
  }

  test('imports the folders and their credentials once, never deletes either and records the workspace', async () => {
    const db = await newDb()
    const node = await diskNode(db)
    await writeFiles(join(node.dir, 'linear'), { 'config.json': config('Linear', { type: 'mcp', api: undefined, mcp: { transport: 'http', url: 'https://mcp.test', authType: 'oauth' } }), 'guide.md': '# L' })
    await writeFiles(join(node.dir, 'shop'), { 'config.json': config('Shop', { api: { baseUrl: 'https://shop.test', authType: 'header', headerName: 'X-Key' } }) })
    await writeFiles(join(node.dir, 'bearer-mcp'), { 'config.json': config('Bearer', { type: 'mcp', api: undefined, mcp: { transport: 'http', url: 'https://m.test', authType: 'oauth' } }) })
    await writeFiles(join(node.dir, 'plain'), { 'config.json': config('Plain') })
    await writeFiles(join(node.dir, 'broken'), { 'config.json': 'nope' })
    const manager = await oldCredentials(node.root)

    const workspaces = [{ id: WS, rootPath: node.root }]
    const first = await initSourcesImport(node.store, { db, workspaces, manager })
    expect(first).toEqual({ workspaces: 1, imported: 4, skipped: 1, credentials: 3 })
    expect(node.store.getSources(WS).map((s) => s.slug).sort()).toEqual(['bearer-mcp', 'linear', 'plain', 'shop'])
    expect(node.store.getCredential(WS, 'linear', 'source_oauth')).toEqual({ value: 'linear-access', refreshToken: 'linear-refresh', expiresAt: 9 })
    expect(node.store.getCredential(WS, 'shop', 'source_apikey')).toEqual({ value: 'shop-key' })
    expect(node.store.getCredential(WS, 'bearer-mcp', 'source_bearer')).toEqual({ value: 'bearer-token' })
    expect(node.store.hasCredential(WS, 'plain')).toBe(false)
    expect(JSON.stringify(db.select().from(secrets).all())).not.toContain('linear-access')
    expect(typeof getSetting(INSTALL, 'imports', db)[`sources:${WS}`]).toBe('number')

    const second = await initSourcesImport(node.store, { db, workspaces, manager })
    expect(second).toEqual({ workspaces: 0, imported: 0, skipped: 0, credentials: 0 })
    expect(db.select().from(secrets).all()).toHaveLength(3)
    // nothing old is deleted
    expect((await readdir(node.dir)).sort()).toEqual(['bearer-mcp', 'broken', 'linear', 'plain', 'shop'])
    expect((await manager.get({ type: 'source_oauth', workspaceId: basename(node.root), sourceId: 'linear' }))?.value).toBe('linear-access')
  })

  test('a source that already has a secret keeps it; a remote workspace is not imported', async () => {
    const db = await newDb()
    const node = await diskNode(db)
    await writeFiles(join(node.dir, 'shop'), { 'config.json': config('Shop', { api: { baseUrl: 'https://shop.test', authType: 'header', headerName: 'X-Key' } }) })
    const manager = await oldCredentials(node.root)
    await node.store.syncLocalSource(WS, 'shop')
    await node.store.setCredential(WS, 'shop', 'source_apikey', { value: 'newer-key' })
    expect(await initSourcesImport(node.store, { db, workspaces: [{ id: 'remote', rootPath: node.root, remoteServer: {} }], manager })).toMatchObject({ workspaces: 0 })
    expect(await initSourcesImport(node.store, { db, workspaces: [{ id: WS, rootPath: node.root }], manager })).toMatchObject({ workspaces: 1, credentials: 0 })
    expect(node.store.getCredential(WS, 'shop', 'source_apikey')).toEqual({ value: 'newer-key' })
  })
})
