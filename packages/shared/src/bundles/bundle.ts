import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { assertPathKey } from '../library/file-store.ts'
import { domainError } from '../utils/errors.ts'

/**
 * A bundle (a skill's or a source's folder) as a plain value: its files by path relative to the folder (`SKILL.md`,
 * `config.json`, `icon.png`, `scripts/run.py`). Hidden files and folders (a leading `.`) are never part of one.
 */
export type BundleFiles = Map<string, Uint8Array>

export const MAX_BUNDLE_FILES = 500
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024

/** The folder's note of the row it was last made equal to: `{ updatedAt, hash }`. Hidden, so it is not part of the bundle. */
export const BUNDLE_MARKER = '.otto-bundle.json'
export type BundleMarker = { updatedAt: number; hash: string }

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** What a bundle is called in a message: 'skill' or 'source'. */
export type BundleNoun = 'skill' | 'source'

export function assertSlug(slug: string, noun: BundleNoun): string {
  if (!SLUG.test(slug)) throw domainError('invalid', `${slug} is not a ${noun} slug (lowercase letters, digits and hyphens)`)
  return slug
}

/** sha256 of the sorted manifest (path, size, sha256 of each file): equal hashes mean equal bundles. */
export function hashBundle(files: BundleFiles): string {
  const manifest = [...files.keys()]
    .sort()
    .map((path) => `${path}\0${files.get(path)!.length}\0${createHash('sha256').update(files.get(path)!).digest('hex')}`)
  return createHash('sha256').update(manifest.join('\n')).digest('hex')
}

/** Throws `invalid` unless the files are valid paths within the limits. */
export function assertFiles(files: BundleFiles, noun: BundleNoun): void {
  if (files.size > MAX_BUNDLE_FILES) throw domainError('too_large', `A ${noun} has at most ${MAX_BUNDLE_FILES} files`)
  let size = 0
  for (const [path, bytes] of files) {
    try {
      assertPathKey(path)
    } catch {
      throw domainError('invalid', `${path} is not a valid file path in a ${noun}`)
    }
    size += bytes.length
  }
  if (size > MAX_BUNDLE_BYTES) throw domainError('too_large', `A ${noun} is limited to ${MAX_BUNDLE_BYTES} bytes`)
}

/** The files of a bundle's local folder, or undefined when there is none. Symlinks are not followed. */
export async function readLocalBundle(dir: string): Promise<BundleFiles | undefined> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) =>
    error.code === 'ENOENT' || error.code === 'ENOTDIR' ? undefined : Promise.reject(error),
  )
  if (!entries) return undefined
  const files: BundleFiles = new Map()
  let size = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/')
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue
    const bytes = new Uint8Array(await readFile(join(dir, path)))
    size += bytes.length
    if (files.size >= MAX_BUNDLE_FILES || size > MAX_BUNDLE_BYTES) throw domainError('too_large', `${dir} is larger than a bundle may be`)
    files.set(path, bytes)
  }
  return files
}

export async function readMarker(dir: string): Promise<BundleMarker | undefined> {
  try {
    const marker = JSON.parse(await readFile(join(dir, BUNDLE_MARKER), 'utf-8')) as Partial<BundleMarker>
    return typeof marker.updatedAt === 'number' && typeof marker.hash === 'string' ? { updatedAt: marker.updatedAt, hash: marker.hash } : undefined
  } catch {
    return undefined
  }
}

export const writeMarker = (dir: string, marker: BundleMarker) => writeFile(join(dir, BUNDLE_MARKER), JSON.stringify(marker))

/**
 * Makes `dir` hold exactly these files and the marker. The folder is built beside the target and swapped in with
 * renames, so a reader sees the old or the new folder, never a half-written one (a hidden `.tmp-*` name, which the
 * config watcher ignores).
 */
export async function writeLocalBundle(dir: string, files: BundleFiles, marker: BundleMarker): Promise<void> {
  const parent = dirname(dir)
  const temp = join(parent, `.tmp-${crypto.randomUUID()}`)
  try {
    for (const [path, bytes] of files) {
      await mkdir(dirname(join(temp, path)), { recursive: true })
      await writeFile(join(temp, path), bytes)
    }
    await mkdir(temp, { recursive: true })
    await writeMarker(temp, marker)
    const old = join(parent, `.old-${crypto.randomUUID()}`)
    const hadOld = await rename(dir, old).then(() => true, (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? false : Promise.reject(error)))
    await rename(temp, dir)
    if (hadOld) await rm(old, { recursive: true, force: true })
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}
