import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { and, asc, eq } from 'drizzle-orm'
import { isActor, userActor } from '../actors.ts'
import type { Db } from '../db/index.ts'
import type { FileStore } from '../library/file-store.ts'
import type { skills } from '../skills/schema.ts'
import { domainError, isDomainError } from '../utils/errors.ts'
import { getWorkspaceOwnerIds } from '../workspaces/ownership.ts'
import { assertFiles, assertSlug, hashBundle, readLocalBundle, readMarker, writeLocalBundle, writeMarker, type BundleFiles, type BundleNoun } from './bundle.ts'

/**
 * Bundles on rows: the machinery of skills and sources (S1, S2). The row (`skills`, `sources`) is the index and the
 * commit point; the bytes are the bundle in the store under `<slug>/<path>` (S3, or the workspace's `<kind>` folder
 * itself on disk); the folder `<workspace>/<kind>/<slug>/` is the local copy agents read by path. A kind brings its
 * table, the file that makes a folder one (`SKILL.md`, `config.json`) and how its row is indexed from the files.
 *
 * Writes go row first: the guarded update (`updated_at` equal to what the writer saw) is the one place two writers
 * are told apart, then the files are uploaded, and the row is put back when the upload fails. A bundle is many
 * objects with no version in the key, so a crash between the row and the last upload leaves a mixed bundle until the
 * next write; the folder it came from is still there to push again.
 *
 * The folder and the bucket stay equal through `syncLocal` (see its comment): the config watcher calls it for an
 * edited folder, boot and a change from another node call `sync`. With a disk store the folder is the store, so
 * there is nothing to download and the folder always wins.
 */

export type BundleTarget = {
  /** Path keys `<slug>/<file>`. */
  store: FileStore
  /** `<workspace>/<kind>`. */
  dir: string
  /** True for S3: the folder is a copy of the bucket. False on disk, where the folder is the store. */
  remote: boolean
}

export type SyncStatus = 'none' | 'unchanged' | 'created' | 'pushed' | 'materialized' | 'removed' | 'conflict' | 'invalid'

/**
 * Both bundle tables have these columns. Limit: the store is typed against the skills table and a kind passes its own
 * with one cast; the columns only the kind has (`type`, `auth_status`) are written from what `index()` returns.
 */
export type BundleTable = typeof skills
export type BundleRow = { id: string; workspaceId: string; slug: string; title: string; hash: string; createdBy: string; createdAt: Date; updatedAt: Date }

export type BundleSpec<Row extends BundleRow, Item> = {
  noun: BundleNoun
  /** The folder under the workspace, the conflict folder and the log tag. */
  kind: 'skills' | 'sources'
  table: BundleTable
  /** The file whose presence makes a folder a bundle. */
  mainFile: string
  /** Throws `invalid` unless the files can be this kind of bundle; returns the columns of the row they index. */
  index(files: BundleFiles): { title: string } & Record<string, unknown>
  toItem(row: Row): Item
  /** Runs after a row is deleted (a source's secret goes with it). */
  afterDelete?(row: Row): void
}

const capital = (noun: string) => noun[0]!.toUpperCase() + noun.slice(1)

export function createBundleStore<Row extends BundleRow, Item>(db: Db, spec: BundleSpec<Row, Item>, targetFor: (workspaceId: string) => BundleTarget) {
  const { table, noun, kind, mainFile } = spec
  const label = capital(noun)
  const find = (workspaceId: string, slug: string) => db.select().from(table).where(and(eq(table.workspaceId, workspaceId), eq(table.slug, slug))).get() as unknown as Row | undefined

  // One bundle changes at a time here: a push, a delete and a download of the same bundle never interleave.
  const queues = new Map<string, Promise<unknown>>()
  function serial<T>(workspaceId: string, slug: string, run: () => Promise<T>): Promise<T> {
    const key = `${workspaceId}/${slug}`
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run)
    queues.set(key, next)
    void next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {})
    return next
  }

  /** Uploads every file, then removes the keys of the bundle that are no longer in it. */
  async function upload(target: BundleTarget, slug: string, files: BundleFiles) {
    for (const [path, bytes] of files) await target.store.put(`${slug}/${path}`, bytes)
    for (const key of await target.store.list(`${slug}/`)) if (!files.has(key.slice(slug.length + 1))) await target.store.delete(key)
  }

  async function removeBundle(target: BundleTarget, slug: string) {
    for (const key of await target.store.list(`${slug}/`)) await target.store.delete(key)
    await rm(join(target.dir, slug), { recursive: true, force: true })
  }

  /**
   * Puts the bytes where they belong after the row took the write: the bucket, and on S3 the folder (marker included).
   * Files that came from the folder of a disk store are already in the store, so nothing is written.
   */
  async function writeBytes(target: BundleTarget, slug: string, files: BundleFiles, row: Row, fromFolder: boolean) {
    if (!target.remote) {
      if (!fromFolder) await upload(target, slug, files)
      return
    }
    await upload(target, slug, files)
    const marker = { updatedAt: row.updatedAt.getTime(), hash: row.hash }
    if (fromFolder) await writeMarker(join(target.dir, slug), marker)
    else await writeLocalBundle(join(target.dir, slug), files, marker)
  }

  async function createImpl(input: { workspaceId: string; slug: string; files: BundleFiles; createdBy: string }, fromFolder: boolean): Promise<Item> {
    const slug = assertSlug(input.slug, noun)
    if (!isActor(input.createdBy)) throw domainError('invalid', `${String(input.createdBy)} is not an actor`)
    assertFiles(input.files, noun)
    const indexed = spec.index(input.files)
    const target = targetFor(input.workspaceId)
    const now = new Date()
    let row: Row
    try {
      row = db
        .insert(table)
        .values({ ...indexed, id: crypto.randomUUID(), workspaceId: input.workspaceId, slug, hash: hashBundle(input.files), createdBy: input.createdBy, createdAt: now, updatedAt: now } as never)
        .returning()
        .get() as unknown as Row
    } catch (error) {
      if (find(input.workspaceId, slug)) throw domainError('conflict', `${label} ${slug} already exists`)
      throw error
    }
    try {
      await writeBytes(target, slug, input.files, row, fromFolder)
    } catch (error) {
      db.delete(table).where(eq(table.id, row.id)).run()
      // Never the files of a folder that is the store itself.
      if (target.remote || !fromFolder) await Promise.all([...input.files.keys()].map((path) => target.store.delete(`${slug}/${path}`).catch(() => {})))
      throw error
    }
    return spec.toItem(row)
  }

  async function updateImpl(workspaceId: string, slug: string, files: BundleFiles, expectedUpdatedAt: number, fromFolder: boolean): Promise<Item> {
    const row = find(workspaceId, slug)
    if (!row) throw domainError('not_found', `${label} ${slug} does not exist`)
    assertFiles(files, noun)
    const indexed = spec.index(files)
    const hash = hashBundle(files)
    if (hash === row.hash) return spec.toItem(row) // nothing to write (also what our own materializing echoes back as)
    if (expectedUpdatedAt !== row.updatedAt.getTime()) throw domainError('conflict', `${label} ${slug} changed since it was loaded`)
    const target = targetFor(workspaceId)
    // Strictly after the stored value, so two writes in one millisecond still tell apart.
    const updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
    const updated = db
      .update(table)
      .set({ ...indexed, hash, updatedAt } as never)
      .where(and(eq(table.id, row.id), eq(table.updatedAt, row.updatedAt)))
      .returning()
      .get() as unknown as Row | undefined
    if (!updated) throw domainError('conflict', `${label} ${slug} changed since it was loaded`)
    try {
      await writeBytes(target, slug, files, updated, fromFolder)
    } catch (error) {
      // The bucket did not take the write, so the row must not claim it did (only what this write changed: a credential saved meanwhile stays).
      const before = Object.fromEntries(Object.keys({ ...indexed, hash, updatedAt }).map((column) => [column, (row as Record<string, unknown>)[column]]))
      db.update(table).set(before as never).where(and(eq(table.id, row.id), eq(table.updatedAt, updated.updatedAt))).run()
      throw error
    }
    return spec.toItem(updated)
  }

  /** Downloads the bundle of the row into the folder; false when the bucket holds none (the folder is left alone). */
  async function materializeImpl(target: BundleTarget, row: Row): Promise<boolean> {
    const files: BundleFiles = new Map()
    for (const key of await target.store.list(`${row.slug}/`)) {
      const bytes = await target.store.get(key)
      if (bytes) files.set(key.slice(row.slug.length + 1), bytes)
    }
    if (!files.has(mainFile)) return false
    // The hash of what came down, not the row's: a download that met a write half-way is repaired by the next sync.
    await writeLocalBundle(join(target.dir, row.slug), files, { updatedAt: row.updatedAt.getTime(), hash: hashBundle(files) })
    return true
  }

  /** The losing local copy of a refused push is kept, never lost: `<workspace>/.conflicts/<kind>/<slug>-<time>/`. */
  async function keepConflictCopy(target: BundleTarget, slug: string) {
    const to = join(dirname(target.dir), '.conflicts', kind, `${slug}-${Date.now()}`)
    await mkdir(dirname(to), { recursive: true })
    await cp(join(target.dir, slug), to, { recursive: true })
  }

  async function syncImpl(workspaceId: string, slug: string, createdBy?: string): Promise<SyncStatus> {
    const target = targetFor(workspaceId)
    const row = find(workspaceId, slug)
    const dir = join(target.dir, slug)
    const local = await readLocalBundle(dir)
    const marker = target.remote && local ? await readMarker(dir) : undefined

    if (!local) {
      if (!row) return 'none'
      // Folder gone: on S3 the bucket is the truth and the folder comes back; on disk the folder was the truth.
      if (target.remote) return (await materializeImpl(target, row)) ? 'materialized' : 'invalid'
      db.delete(table).where(eq(table.id, row.id)).run()
      spec.afterDelete?.(row)
      return 'removed'
    }

    if (!row) {
      // A folder with a marker was a bundle that is now deleted (elsewhere); one without is new (an agent made it, or an old install).
      if (marker) {
        await rm(dir, { recursive: true, force: true })
        return 'removed'
      }
      const owner = getWorkspaceOwnerIds(workspaceId, db)[0]
      await createImpl({ workspaceId, slug, files: local, createdBy: createdBy ?? (owner ? userActor(owner) : 'agent:default') }, true)
      return 'created'
    }

    const hash = hashBundle(local)
    if (hash === row.hash) {
      if (target.remote && (marker?.updatedAt !== row.updatedAt.getTime() || marker.hash !== hash)) {
        // No note of an earlier sync: the bucket may never have had this bundle (a disk install moving to S3), so it is made to.
        if (!marker && !(await target.store.list(`${slug}/`)).includes(`${slug}/${mainFile}`)) await upload(target, slug, local)
        await writeMarker(dir, { updatedAt: row.updatedAt.getTime(), hash })
      }
      return 'unchanged'
    }
    // Nobody touched the folder since it was last made equal to the bucket, so the row moved on elsewhere.
    if (marker && marker.hash === hash) return (await materializeImpl(target, row)) ? 'materialized' : 'invalid'

    try {
      await updateImpl(workspaceId, slug, local, target.remote ? (marker?.updatedAt ?? -1) : row.updatedAt.getTime(), true)
      return 'pushed'
    } catch (error) {
      if (!isDomainError(error) || error.code !== 'conflict' || !target.remote) throw error
      // Refused: the row is newer, so it wins. The folder is reloaded from it and the losing copy kept.
      await keepConflictCopy(target, slug)
      await materializeImpl(target, row)
      return 'conflict'
    }
  }

  /** What a failed sync means for the folder: one that does not parse (`invalid`) is left as the agent wrote it, anything else throws. */
  const settle = (run: () => Promise<SyncStatus>) =>
    run().catch((error) => {
      if (isDomainError(error) && error.code === 'invalid') return 'invalid' as const
      throw error
    })

  /** The workspace's rows by title. */
  const rows = (workspaceId: string) => db.select().from(table).where(eq(table.workspaceId, workspaceId)).orderBy(asc(table.title)).all() as unknown as Row[]

  return {
    rows,

    row: find,

    getItems: (workspaceId: string): Item[] => rows(workspaceId).map(spec.toItem),

    getItem(workspaceId: string, slug: string): Item | undefined {
      const row = find(workspaceId, slug)
      return row && spec.toItem(row)
    },

    /** Makes a bundle of a whole set of files. `conflict` when the slug is taken. */
    create: (input: { workspaceId: string; slug: string; files: BundleFiles; createdBy: string }) => serial(input.workspaceId, input.slug, () => createImpl(input, false)),

    /**
     * Replaces the bundle with `files` (the whole folder; a file left out is deleted). `expectedUpdatedAt` is the
     * `updatedAt` the caller based the files on; another value means someone wrote in between and nothing changes
     * (`conflict`). Files equal to the stored bundle change nothing.
     */
    update: (workspaceId: string, slug: string, files: BundleFiles, expectedUpdatedAt: number) =>
      serial(workspaceId, slug, () => updateImpl(workspaceId, slug, files, expectedUpdatedAt, false)),

    /** Removes the row, the bundle and the local folder. */
    delete: (workspaceId: string, slug: string) =>
      serial(workspaceId, slug, async () => {
        const row = find(workspaceId, slug)
        if (!row) throw domainError('not_found', `${label} ${slug} does not exist`)
        db.delete(table).where(eq(table.id, row.id)).run()
        spec.afterDelete?.(row)
        await removeBundle(targetFor(workspaceId), slug)
      }),

    /**
     * Brings one folder and its bundle together; what the config watcher calls after an edit, debounced.
     * A new folder becomes a bundle (made by `createdBy`, else the workspace's first owner); an edited folder is pushed
     * (S3: refused when the row moved on, then the row wins: the folder is reloaded from it, the losing copy kept in
     * `.conflicts`, status `conflict`); a folder nobody edited is refreshed when the row is newer. A folder whose main
     * file does not parse is left alone (`invalid`).
     */
    syncLocal: (workspaceId: string, slug: string, createdBy?: string) => serial(workspaceId, slug, () => settle(() => syncImpl(workspaceId, slug, createdBy))),

    /** `syncLocal` for every row and every folder of the workspace: boot, and a `domain:changed` from another node. */
    async sync(workspaceId: string): Promise<Partial<Record<SyncStatus, number>>> {
      const target = targetFor(workspaceId)
      const folders = await readdir(target.dir, { withFileTypes: true }).then(
        (entries) => entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name),
        () => [],
      )
      const slugs = new Set([...db.select({ slug: table.slug }).from(table).where(eq(table.workspaceId, workspaceId)).all().map((row) => row.slug), ...folders])
      const report: Partial<Record<SyncStatus, number>> = {}
      for (const slug of slugs) {
        const status = await serial(workspaceId, slug, () => settle(() => syncImpl(workspaceId, slug))).catch((error) => {
          console.warn(`[${kind}] ${workspaceId}/${slug}: ${error instanceof Error ? error.message : String(error)}`)
          return 'invalid' as const
        })
        report[status] = (report[status] ?? 0) + 1
      }
      return report
    },
  }
}
