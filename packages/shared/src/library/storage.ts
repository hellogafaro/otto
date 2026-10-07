import { join } from 'node:path'
import { createDiskFileStore, getLibraryDir, type FileStore } from './file-store.ts'
import { createS3Client, createS3FileStore, type S3Config } from './s3-file-store.ts'

/**
 * Which FileStore driver the library uses. Nothing here runs until `initFileStorage` is called
 * (the headless server does at boot), so the desktop app and tests stay on disk.
 *
 *   OTTO_STORAGE            disk (default) | s3
 *   OTTO_S3_ENDPOINT        https://garage.example.com   (path-style addressing)
 *   OTTO_S3_BUCKET, OTTO_S3_REGION, OTTO_S3_ACCESS_KEY_ID, OTTO_S3_SECRET_ACCESS_KEY
 *   OTTO_S3_PREFIX          optional: a folder in the bucket for everything Otto stores (default none)
 *
 * Library keys are `[<prefix>/]workspaces/<workspaceId>/library/<itemId>`; bundle keys (skills, later sources)
 * `[<prefix>/]workspaces/<workspaceId>/<kind>/<slug>/<path>`.
 */
let s3: { client: ReturnType<typeof createS3Client>; prefix: string } | undefined

const S3_VARS = ['OTTO_S3_ENDPOINT', 'OTTO_S3_BUCKET', 'OTTO_S3_REGION', 'OTTO_S3_ACCESS_KEY_ID', 'OTTO_S3_SECRET_ACCESS_KEY'] as const

/** Reads the storage env and returns the driver name; throws (naming variables, never values) when it is incomplete. */
export function initFileStorage(env: Record<string, string | undefined> = process.env): 'disk' | 's3' {
  const driver = (env.OTTO_STORAGE?.trim().toLowerCase() || 'disk')
  if (driver === 'disk') {
    s3 = undefined
    return 'disk'
  }
  if (driver !== 's3') throw new Error('OTTO_STORAGE must be "disk" or "s3"')
  const missing = S3_VARS.filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new Error(`OTTO_STORAGE=s3 needs ${missing.join(', ')}`)
  const [endpoint, bucket, region, accessKeyId, secretAccessKey] = S3_VARS.map((name) => env[name]!.trim())
  try {
    new URL(endpoint!)
  } catch {
    throw new Error('OTTO_S3_ENDPOINT must be a URL')
  }
  const config: S3Config = { endpoint: endpoint!, bucket: bucket!, region: region!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! }
  const prefix = env.OTTO_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, '')
  s3 = { client: createS3Client(config), prefix: prefix ? `${prefix}/` : '' }
  return 's3'
}

/** A workspace's library store: the S3 driver (with `<root>/library` as its cache) or the disk directory. */
export function getLibraryStore(workspaceRootPath: string, workspaceId: string): FileStore {
  if (!s3) return createDiskFileStore(getLibraryDir(workspaceRootPath))
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error(`Invalid workspace id: ${workspaceId}`)
  return createS3FileStore({ client: s3.client, keyPrefix: `${s3.prefix}workspaces/${workspaceId}/library/`, cacheDir: getLibraryDir(workspaceRootPath) })
}

/**
 * A workspace's bundle store for skills and sources: path keys `<slug>/<file>` (`chats`: `<chatId>/<file>`, see
 * sessions/pi-session-sync.ts; only used on S3). On S3 reads go straight to the
 * bucket (the bundle's materializer fills `<root>/<kind>/`, see bundles/store.ts); on disk the folder `<root>/<kind>` is
 * the store itself, so a bundle is already where agents read it.
 */
export function getBundleStore(workspaceRootPath: string, workspaceId: string, kind: 'skills' | 'sources' | 'chats'): FileStore {
  if (!s3) return createDiskFileStore(join(workspaceRootPath, kind), { paths: true })
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error(`Invalid workspace id: ${workspaceId}`)
  return createS3FileStore({ client: s3.client, keyPrefix: `${s3.prefix}workspaces/${workspaceId}/${kind}/`, paths: true })
}

/** True when `OTTO_STORAGE=s3` is active (the bundle store and the local folder are then two places). */
export const isObjectStorage = () => s3 !== undefined
