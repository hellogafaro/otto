import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createSecretsStore } from '../packages/shared/src/secrets/index.ts'
import { rebuildMessagesSearch } from '../packages/shared/src/sessions/messages.ts'
import { MASTRA_RUNTIME_TABLES } from '../packages/shared/src/db/mastra-tables.ts'
import {
  expandPath,
  toPortablePath,
} from '../packages/shared/src/utils/paths.ts'
import { toDmKey } from '../packages/shared/src/sessions/members.ts'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const TABLES = [
  'users',
  'users_sessions',
  'users_accounts',
  'users_verifications',
  'workspaces',
  'workspaces_members',
  'workspaces_invitations',
  'agents',
  'connections',
  'secrets',
  'projects',
  'tasks',
  'timesheets',
  'library',
  'comments',
  'notifications',
  'chats',
  'messages',
  'labels',
  'statuses',
  'skills',
  'sources',
  'routines',
  'routines_history',
]
const REFERENCES = new Set([
  'workspace_id',
  'user_id',
  'active_organization_id',
  'inviter_id',
  'agent_id',
  'secret_id',
  'project_id',
  'task_id',
  'parent_id',
  'original_id',
  'chat_id',
  'status_id',
  'label_id',
  'routine_id',
])
const TEXT_REFERENCES = new Set([
  'scope',
  'entity',
  'actor',
  'created_by',
  'origin',
  'dm_key',
  'avatar',
  'members',
  'resources',
  'assignees',
  'skills',
  'sources',
  'metadata',
  'content',
  'description',
  'notes',
  'instructions',
  'config',
  'value',
  'image',
  'logo',
])

export function convertLegacyIds(
  db: Database,
  encryptionKey: Buffer,
): Map<string, string> {
  if (encryptionKey.length !== 32)
    throw new Error('A valid encryption key is required for ID conversion.')
  const present = new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string
      }[]
    ).map((row) => row.name),
  )
  const tables = TABLES.filter((table) => present.has(table))
  for (const table of MASTRA_RUNTIME_TABLES)
    if (
      present.has(table) &&
      db.query(`SELECT 1 FROM "${table}" LIMIT 1`).get()
    )
      throw new Error(
        'Populated native runtime history needs the reviewed history import, not this legacy copy conversion.',
      )
  const map = new Map<string, string>()
  for (const table of tables) {
    const columns = db.query(`PRAGMA table_info("${table}")`).all() as {
      name: string
    }[]
    if (!columns.some((column) => column.name === 'id')) continue
    for (const row of db.query(`SELECT id FROM "${table}"`).all() as {
      id: string
    }[])
      if (
        row.id &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          row.id,
        ) &&
        !map.has(row.id)
      )
        map.set(row.id, crypto.randomUUID())
  }
  const escaped = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = escaped.length
    ? new RegExp(
        `(?<![A-Za-z0-9_-])(?:${escaped.join('|')})(?![A-Za-z0-9_-])`,
        'g',
      )
    : null
  const replace = (text: string) =>
    pattern ? text.replace(pattern, (id) => map.get(id) ?? id) : text
  const rewriteJson = (value: unknown): unknown => {
    if (typeof value === 'string') return replace(value)
    if (Array.isArray(value)) return value.map(rewriteJson)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          replace(key),
          rewriteJson(item),
        ]),
      )
    return value
  }
  const rewrite = (value: string) => {
    try {
      return JSON.stringify(rewriteJson(JSON.parse(value)))
    } catch {
      return replace(value)
    }
  }
  const secretStore = createSecretsStore(drizzle(db), encryptionKey)
  db.transaction(() => {
    if (present.has('secrets'))
      for (const row of db.query('SELECT id FROM secrets').all() as {
        id: string
      }[])
        if (map.has(row.id))
          secretStore.rebindSecretId(row.id, map.get(row.id)!)
    for (const table of [
      ...tables,
      'chats_members',
      'labels_entities',
      'settings',
    ].filter((table) => present.has(table))) {
      const columns = (
        db.query(`PRAGMA table_info("${table}")`).all() as { name: string }[]
      ).map((column) => column.name)
      for (const row of db
        .query(`SELECT rowid AS migration_rowid,* FROM "${table}"`)
        .all() as Record<string, unknown>[]) {
        const changes: Record<string, unknown> = {}
        for (const column of columns) {
          const value = row[column]
          if (typeof value !== 'string') continue
          if (
            table === 'users_accounts' &&
            column === 'account_id' &&
            row.provider_id === 'credential'
          ) {
            if (map.has(value)) changes[column] = map.get(value)
            continue
          }
          if (column === 'id' || REFERENCES.has(column)) {
            if (map.has(value)) changes[column] = map.get(value)
          } else if (TEXT_REFERENCES.has(column)) {
            if (table === 'secrets' && column === 'value') continue
            else if (
              !(
                table.startsWith('users_') &&
                ['value', 'content'].includes(column)
              )
            ) {
              const next =
                column === 'dm_key'
                  ? toDmKey(...(replace(value).split('|') as [string, string]))
                  : rewrite(value)
              if (next !== value) changes[column] = next
            }
          }
        }
        if (Object.keys(changes).length)
          db.query(
            `UPDATE "${table}" SET ${Object.keys(changes)
              .map((column) => `"${column}"=?`)
              .join(',')} WHERE rowid=?`,
          ).run(
            ...(Object.values(changes) as never[]),
            row.migration_rowid as number,
          )
      }
    }
  }).immediate()
  if (present.has('messages')) rebuildMessagesSearch(drizzle(db))
  return map
}

export function convertLegacyCopy(
  sourceConfig: string,
  destinationConfig: string,
  encryptionKey: Buffer,
): number {
  const source = resolve(sourceConfig),
    destination = resolve(destinationConfig)
  if (existsSync(destination) || destination.startsWith(source + '/'))
    throw new Error(
      'Destination must be new and outside the source configuration.',
    )
  const configPath = join(source, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    workspaces: { rootPath: string }[]
  }
  if (
    config.workspaces.some(
      (workspace) =>
        !resolve(expandPath(workspace.rootPath)).startsWith(source + '/'),
    )
  )
    throw new Error(
      'Workspace files outside this config need a separately reviewed copy procedure.',
    )
  if (process.env.OTTO_STORAGE === 's3')
    throw new Error(
      'Remote object keys need the reviewed history import, not this local copy conversion.',
    )
  const stage = destination + '.uuid-conversion-' + crypto.randomUUID()
  const from = new Database(join(source, 'otto.db'), { readonly: true })
  mkdirSync(stage, { recursive: true })
  let to: Database | undefined
  try {
    from.exec(`VACUUM INTO '${join(stage, 'otto.db').replaceAll("'", "''")}'`)
    from.close()
    to = new Database(join(stage, 'otto.db'))
    const ids = convertLegacyIds(to, encryptionKey)
    const markdown = new Set(
      (
        to.query("SELECT id FROM library WHERE type='document'").all() as {
          id: string
        }[]
      ).map((row) => row.id),
    )
    const escaped = [...ids.keys()]
      .sort((a, b) => b.length - a.length)
      .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = escaped.length
      ? new RegExp(
          `(?<![A-Za-z0-9_-])(?:${escaped.join('|')})(?![A-Za-z0-9_-])`,
          'g',
        )
      : null
    const replace = (text: string) => {
      const paths = text.replaceAll(source, destination)
      return pattern ? paths.replace(pattern, (id) => ids.get(id) ?? id) : paths
    }
    for (const table of ['chats', 'settings'].filter((name) =>
      to!
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(name),
    )) {
      const columns = (
        to.query(`PRAGMA table_info("${table}")`).all() as {
          name: string
          type: string
        }[]
      )
        .filter((column) => column.type.toLowerCase() === 'text')
        .map((column) => column.name)
      to.transaction(() => {
        for (const row of to!
          .query(`SELECT rowid AS migration_rowid,* FROM "${table}"`)
          .all() as Record<string, unknown>[])
          for (const column of columns)
            if (
              typeof row[column] === 'string' &&
              (row[column] as string).includes(source)
            )
              to!
                .query(`UPDATE "${table}" SET "${column}"=? WHERE rowid=?`)
                .run(
                  replace(row[column] as string),
                  row.migration_rowid as number,
                )
      })()
    }
    const copy = (folder: string, relative = '') => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (['otto.db', 'otto.db-wal', 'otto.db-shm'].includes(entry.name))
          continue
        if (entry.isSymbolicLink())
          throw new Error('Symlinks require a reviewed copy procedure.')
        const sourcePath = join(folder, entry.name)
        const target = join(stage, replace(join(relative, entry.name)))
        if (entry.isDirectory()) {
          mkdirSync(target, { recursive: true })
          copy(sourcePath, join(relative, entry.name))
        } else if (entry.isFile()) {
          mkdirSync(dirname(target), { recursive: true })
          const bytes = readFileSync(sourcePath)
          if (
            /\.(json|jsonl|md|txt|ya?ml)$/.test(entry.name) ||
            markdown.has(ids.get(entry.name) ?? entry.name)
          ) {
            writeFileSync(target, replace(bytes.toString('utf8')), {
              mode: statSync(sourcePath).mode,
            })
          } else copyFileSync(sourcePath, target)
        }
      }
    }
    copy(source)
    const copiedConfig = JSON.parse(
      readFileSync(join(stage, 'config.json'), 'utf8'),
    ) as { workspaces: { rootPath: string }[] }
    for (let i = 0; i < copiedConfig.workspaces.length; i++)
      copiedConfig.workspaces[i]!.rootPath = toPortablePath(
        replace(expandPath(config.workspaces[i]!.rootPath)),
      )
    writeFileSync(
      join(stage, 'config.json'),
      JSON.stringify(copiedConfig, null, 2) + '\n',
      { mode: statSync(configPath).mode },
    )
    to.close()
    renameSync(stage, destination)
    return ids.size
  } catch (error) {
    to?.close()
    from.close()
    rmSync(stage, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2)
  const raw = process.env.ENCRYPTION_KEY
  if (!source || !destination || !raw)
    throw new Error(
      'Usage: ENCRYPTION_KEY configured securely, bun run scripts/db-uuid.ts <stopped source config> <new destination config>',
    )
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes.')
  console.log(
    `Converted ${convertLegacyCopy(source, destination, key)} stored IDs into a new copy; source unchanged.`,
  )
}
