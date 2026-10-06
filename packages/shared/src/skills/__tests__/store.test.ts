import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openDb } from '../../db/index.ts'
import { pushSchema } from '../../db/push.ts'
import { createDiskFileStore } from '../../library/file-store.ts'
import { startS3Double, type S3Double } from '../../library/__tests__/s3-double.ts'
import { createS3Client, createS3FileStore } from '../../library/s3-file-store.ts'
import { INSTALL, getSetting } from '../../settings/index.ts'
import { type BundleFiles, hashBundle, readLocalBundle } from '../../bundles/bundle.ts'
import { initSkillsImport } from '../import.ts'
import { createSkillsStore, type SkillsTarget } from '../store.ts'

const enc = (value: string) => new TextEncoder().encode(value)
const dec = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)
const skillMd = (name: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: About ${name}\n---\n${body}\n`
const bundle = (name: string, extra: Record<string, string> = {}): BundleFiles =>
  new Map(Object.entries({ 'SKILL.md': skillMd(name), ...extra }).map(([path, text]) => [path, enc(text)]))

const WS = 'ws1'
const ME = 'user:aaaaaaaaaaaa'
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'otto-skills-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function newDb() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return db
}

/** One node on S3: its own workspace folder (`<root>/skills`), the shared bucket. */
async function s3Node(db: Awaited<ReturnType<typeof newDb>>, double: S3Double) {
  const root = await tempDir()
  const client = createS3Client({ endpoint: double.url, bucket: double.bucket, region: 'r', accessKeyId: double.accessKeyId, secretAccessKey: 'secret' })
  const target: SkillsTarget = { store: createS3FileStore({ client, keyPrefix: `workspaces/${WS}/skills/`, paths: true }), dir: join(root, 'skills'), remote: true }
  return { root, dir: target.dir, store: createSkillsStore(db, () => target) }
}

async function diskNode(db: Awaited<ReturnType<typeof newDb>>) {
  const root = await tempDir()
  const target: SkillsTarget = { store: createDiskFileStore(join(root, 'skills'), { paths: true }), dir: join(root, 'skills'), remote: false }
  return { root, dir: target.dir, store: createSkillsStore(db, () => target) }
}

const startDouble = () => {
  const double = startS3Double()
  cleanups.push(() => double.stop())
  return double
}

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
}

describe('path keys', () => {
  test('the disk driver lists nested keys by prefix and never a hidden or temp file', async () => {
    const root = await tempDir()
    const store = createDiskFileStore(root, { paths: true })
    await store.put('a/SKILL.md', enc('x'))
    await store.put('a/scripts/run.py', enc('y'))
    await store.put('b/SKILL.md', enc('z'))
    await writeFile(join(root, 'a', '.otto-bundle.json'), '{}')
    expect((await store.list('a/')).sort()).toEqual(['a/SKILL.md', 'a/scripts/run.py'])
    expect((await store.list()).length).toBe(3)
    expect(dec(await store.get('a/scripts/run.py'))).toBe('y')
    for (const bad of ['../x', '/x', 'a//b', 'a/.hidden', 'a\\b', '']) await expect(store.put(bad, enc('x'))).rejects.toThrow('Invalid file key')
  })
})

describe('skills on rows plus S3 bundles', () => {
  test('round trip: createSkill puts the bundle under workspaces/<ws>/skills/<slug>/ and the folder is a copy', async () => {
    const double = startDouble()
    const a = await s3Node(await newDb(), double)
    const skill = await a.store.createSkill({ workspaceId: WS, slug: 'review', files: bundle('Review', { 'scripts/run.py': 'print(1)' }), createdBy: ME })
    expect(skill).toMatchObject({ slug: 'review', title: 'Review', description: 'About Review', createdBy: ME })
    expect([...double.objects.keys()].sort()).toEqual(['workspaces/ws1/skills/review/SKILL.md', 'workspaces/ws1/skills/review/scripts/run.py'])
    expect(await readFile(join(a.dir, 'review', 'scripts', 'run.py'), 'utf-8')).toBe('print(1)')
    expect(a.store.getSkills(WS).map((s) => s.slug)).toEqual(['review'])
    expect(a.store.getLoadedSkills(WS)[0]).toMatchObject({ slug: 'review', metadata: { name: 'Review' } })
    await expect(a.store.createSkill({ workspaceId: WS, slug: 'review', files: bundle('Again'), createdBy: ME })).rejects.toMatchObject({ code: 'conflict' })
    await expect(a.store.createSkill({ workspaceId: WS, slug: 'Bad Slug', files: bundle('X'), createdBy: ME })).rejects.toMatchObject({ code: 'invalid' })
    await expect(a.store.createSkill({ workspaceId: WS, slug: 'no-meta', files: new Map([['SKILL.md', enc('no frontmatter')]]), createdBy: ME })).rejects.toMatchObject({ code: 'invalid' })
    expect(a.store.getSkills(WS)).toHaveLength(1)
  })

  test('updateBundle replaces the whole bundle, guards on updatedAt and ignores equal files', async () => {
    const double = startDouble()
    const a = await s3Node(await newDb(), double)
    const first = await a.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S', { 'old.md': 'old' }), createdBy: ME })
    const same = await a.store.updateBundle(WS, 's', bundle('S', { 'old.md': 'old' }), first.updatedAt)
    expect(same.updatedAt).toBe(first.updatedAt)
    const second = await a.store.updateBundle(WS, 's', bundle('S2', { 'new.md': 'new' }), first.updatedAt)
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
    expect(second.title).toBe('S2')
    expect([...double.objects.keys()].sort()).toEqual(['workspaces/ws1/skills/s/SKILL.md', 'workspaces/ws1/skills/s/new.md'])
    await expect(a.store.updateBundle(WS, 's', bundle('S3'), first.updatedAt)).rejects.toMatchObject({ code: 'conflict' })
    expect(a.store.getSkill(WS, 's')?.title).toBe('S2')
    await expect(a.store.updateBundle(WS, 'nope', bundle('X'), 0)).rejects.toMatchObject({ code: 'not_found' })
  })

  test('a failed upload puts the row back and a created skill is removed', async () => {
    const double = startDouble()
    const a = await s3Node(await newDb(), double)
    const first = await a.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S'), createdBy: ME })
    double.fail = (method) => method === 'PUT'
    await expect(a.store.updateBundle(WS, 's', bundle('S', { 'x.md': 'x' }), first.updatedAt)).rejects.toThrow()
    expect(a.store.getSkill(WS, 's')).toEqual(first)
    await expect(a.store.createSkill({ workspaceId: WS, slug: 'other', files: bundle('O'), createdBy: ME })).rejects.toThrow()
    expect(a.store.getSkill(WS, 'other')).toBeUndefined()
    double.fail = undefined
  })

  test('sync round trip: a local edit is pushed, the other node materializes it', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    const created = await a.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S'), createdBy: ME })

    expect(await b.store.syncSkills(WS)).toEqual({ materialized: 1 })
    expect(await readFile(join(b.dir, 's', 'SKILL.md'), 'utf-8')).toBe(skillMd('S'))
    expect(await b.store.syncLocalSkill(WS, 's')).toBe('unchanged')

    await writeFile(join(a.dir, 's', 'SKILL.md'), skillMd('S edited', 'New body.'))
    await writeFiles(join(a.dir, 's'), { 'references/more.md': 'more' })
    expect(await a.store.syncLocalSkill(WS, 's')).toBe('pushed')
    const pushed = a.store.getSkill(WS, 's')!
    expect(pushed.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(pushed.title).toBe('S edited')
    expect(dec(double.objects.get('workspaces/ws1/skills/s/references/more.md')?.bytes)).toBe('more')
    expect(await a.store.syncLocalSkill(WS, 's')).toBe('unchanged') // our own marker echo is a no-op

    // the `domain:changed` from another node: a sync of the workspace
    expect(await b.store.syncSkills(WS)).toEqual({ materialized: 1 })
    expect(await readFile(join(b.dir, 's', 'SKILL.md'), 'utf-8')).toBe(skillMd('S edited', 'New body.'))
    expect(await readFile(join(b.dir, 's', 'references', 'more.md'), 'utf-8')).toBe('more')
    expect(hashBundle((await readLocalBundle(join(b.dir, 's')))!)).toBe(hashBundle((await readLocalBundle(join(a.dir, 's')))!))
  })

  test('two writers: the second push is refused, its folder reloads from the winner and its edit is kept', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await a.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S'), createdBy: ME })
    await b.store.syncSkills(WS)

    await writeFile(join(a.dir, 's', 'SKILL.md'), skillMd('S', 'From A.'))
    await writeFile(join(b.dir, 's', 'SKILL.md'), skillMd('S', 'From B.'))
    expect(await a.store.syncLocalSkill(WS, 's')).toBe('pushed')
    expect(await b.store.syncLocalSkill(WS, 's')).toBe('conflict')

    expect(await readFile(join(b.dir, 's', 'SKILL.md'), 'utf-8')).toBe(skillMd('S', 'From A.'))
    const kept = await readdir(join(b.root, '.conflicts', 'skills'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(b.root, '.conflicts', 'skills', kept[0]!, 'SKILL.md'), 'utf-8')).toBe(skillMd('S', 'From B.'))
    expect(dec(double.objects.get('workspaces/ws1/skills/s/SKILL.md')?.bytes)).toBe(skillMd('S', 'From A.'))
    expect(await b.store.syncLocalSkill(WS, 's')).toBe('unchanged')
  })

  test('a skill deleted elsewhere removes the folder; delete removes the row, the bundle and the folder', async () => {
    const double = startDouble()
    const db = await newDb()
    const a = await s3Node(db, double)
    const b = await s3Node(db, double)
    await a.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S'), createdBy: ME })
    await b.store.syncSkills(WS)
    await a.store.deleteSkill(WS, 's')
    expect(a.store.getSkills(WS)).toEqual([])
    expect(double.objects.size).toBe(0)
    expect(existsSync(join(a.dir, 's'))).toBe(false)
    expect(await b.store.syncSkills(WS)).toEqual({ removed: 1 })
    expect(existsSync(join(b.dir, 's'))).toBe(false)
    await expect(a.store.deleteSkill(WS, 's')).rejects.toMatchObject({ code: 'not_found' })
  })

  test('a folder with no row becomes a skill; a broken SKILL.md is left alone; a vanished folder comes back from the bucket', async () => {
    const double = startDouble()
    const a = await s3Node(await newDb(), double)
    await writeFiles(join(a.dir, 'made-by-agent'), { 'SKILL.md': skillMd('Made') })
    await writeFiles(join(a.dir, 'broken'), { 'SKILL.md': 'nothing' })
    expect(await a.store.syncSkills(WS)).toEqual({ created: 1, invalid: 1 })
    expect(a.store.getSkill(WS, 'made-by-agent')?.title).toBe('Made')
    expect(await readFile(join(a.dir, 'broken', 'SKILL.md'), 'utf-8')).toBe('nothing')
    await rm(join(a.dir, 'made-by-agent'), { recursive: true })
    expect(await a.store.syncLocalSkill(WS, 'made-by-agent')).toBe('materialized')
    expect(await readFile(join(a.dir, 'made-by-agent', 'SKILL.md'), 'utf-8')).toBe(skillMd('Made'))
  })

  test('moving from disk to S3 uploads the bundles the bucket never had', async () => {
    const double = startDouble()
    const db = await newDb()
    const disk = await diskNode(db)
    await writeFiles(join(disk.dir, 's'), { 'SKILL.md': skillMd('S') })
    await disk.store.syncSkills(WS)
    expect(double.objects.size).toBe(0)
    const client = createS3Client({ endpoint: double.url, bucket: double.bucket, region: 'r', accessKeyId: double.accessKeyId, secretAccessKey: 'secret' })
    const onS3 = createSkillsStore(db, () => ({ store: createS3FileStore({ client, keyPrefix: `workspaces/${WS}/skills/`, paths: true }), dir: disk.dir, remote: true }))
    expect(await onS3.syncSkills(WS)).toEqual({ unchanged: 1 })
    expect([...double.objects.keys()]).toEqual(['workspaces/ws1/skills/s/SKILL.md'])
  })
})

describe('the disk driver (no S3)', () => {
  test('the folder is the store: edits are indexed in place, a deleted folder drops the row', async () => {
    const db = await newDb()
    const node = await diskNode(db)
    await writeFiles(join(node.dir, 's'), { 'SKILL.md': skillMd('S') })
    expect(await node.store.syncLocalSkill(WS, 's')).toBe('created')
    expect(existsSync(join(node.dir, 's', '.otto-bundle.json'))).toBe(false)
    await writeFile(join(node.dir, 's', 'SKILL.md'), skillMd('S2'))
    expect(await node.store.syncLocalSkill(WS, 's')).toBe('pushed')
    expect(node.store.getSkill(WS, 's')?.title).toBe('S2')
    await rm(join(node.dir, 's'), { recursive: true })
    expect(await node.store.syncLocalSkill(WS, 's')).toBe('removed')
    expect(node.store.getSkills(WS)).toEqual([])
  })

  test('createSkill and deleteSkill write and remove the folder', async () => {
    const node = await diskNode(await newDb())
    await node.store.createSkill({ workspaceId: WS, slug: 's', files: bundle('S', { 'a/b.txt': 'b' }), createdBy: ME })
    expect(await readFile(join(node.dir, 's', 'a', 'b.txt'), 'utf-8')).toBe('b')
    await node.store.deleteSkill(WS, 's')
    expect(existsSync(join(node.dir, 's'))).toBe(false)
  })
})

describe('the importer', () => {
  test('imports the existing folders once, never deletes them and records the workspace', async () => {
    const db = await newDb()
    const node = await diskNode(db)
    await writeFiles(join(node.dir, 'one'), { 'SKILL.md': skillMd('One'), 'icon.png': 'png' })
    await writeFiles(join(node.dir, 'two'), { 'SKILL.md': skillMd('Two') })
    await writeFiles(join(node.dir, 'Bad Name'), { 'SKILL.md': skillMd('Bad') })
    await writeFiles(join(node.dir, 'empty'), { 'notes.txt': 'x' })

    const first = await initSkillsImport(node.store.syncSkills, db, [{ id: WS }])
    expect(first).toEqual({ workspaces: 1, imported: 2, skipped: 2 })
    expect(node.store.getSkills(WS).map((s) => s.slug).sort()).toEqual(['one', 'two'])
    expect(typeof getSetting(INSTALL, 'imports', db)[`skills:${WS}`]).toBe('number')

    const second = await initSkillsImport(node.store.syncSkills, db, [{ id: WS }])
    expect(second).toEqual({ workspaces: 0, imported: 0, skipped: 0 })
    expect(node.store.getSkills(WS)).toHaveLength(2)
    expect((await readdir(node.dir)).sort()).toEqual(['Bad Name', 'empty', 'one', 'two'])
    expect(await readFile(join(node.dir, 'one', 'icon.png'), 'utf-8')).toBe('png')
  })
})
