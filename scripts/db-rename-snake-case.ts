import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { DEFAULT_ICON_SVGS } from '../packages/shared/src/statuses/default-icons.ts'

/**
 * One-off: converts an otto.db made before N0 (camelCase columns) to the schema of docs/schema.md, in place and in
 * one transaction, keeping the data. Run it once, with the server stopped and after a backup:
 *
 *   bun run scripts/db-rename-snake-case.ts <path-to-otto.db>
 *
 * It renames columns (`ALTER TABLE ... RENAME COLUMN`), drops the cut columns and the `projects_members` table,
 * folds `connections.account` into `config.account`, `projects_members` into `projects.members` and
 * `notifications.status` into `read_at`, adds the `archived` status to every workspace and recreates the changed
 * indexes. It refuses a database that is already migrated. Afterwards `bun run db:push` plans nothing, or only
 * creates tables the old database never had. It prints counts, never data. Delete it once every database is converted.
 */

/** The tables of the old schema, and the snake_case name of every column that changes (the rest is `camelToSnake`). */
const TABLES = [
  'users', 'users_sessions', 'users_accounts', 'users_verifications',
  'workspaces', 'workspaces_members', 'workspaces_invitations',
  'settings', 'secrets', 'connections',
  'labels', 'labels_entities', 'statuses',
  'library', 'projects', 'projects_members', 'tasks', 'timesheets', 'comments', 'notifications',
  'agents', 'skills',
]
const SPECIAL: Record<string, Record<string, string>> = {
  labels: { order: 'position' },
  statuses: { order: 'position' },
  library: { folderId: 'parent_id' },
}
const DROPPED_COLUMNS: Record<string, string[]> = {
  settings: ['updatedAt'],
  connections: ['account', 'lastUsedAt', 'updatedAt'],
  labels: ['createdAt', 'updatedAt'],
  statuses: ['isFixed', 'createdAt', 'updatedAt'],
  agents: ['description'],
}
const DROPPED_INDEXES = ['labels_workspace_parent', 'statuses_workspace_order', 'library_workspace_folder', 'notifications_user_workspace_status']

const camelToSnake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export type Summary = { renamedColumns: number; droppedColumns: number; droppedTables: string[]; connectionsFolded: number; projectsWithMembers: number; notificationsRead: number; archivedStatuses: number }

type Row = Record<string, unknown>

export function migrateSnakeCase(db: Database): Summary {
  const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((row) => row.name as string))
  const columns = (table: string) => (db.query(`PRAGMA table_info("${table}")`).all() as Row[]).map((row) => row.name as string)
  if (!tables.has('users')) throw new Error('This is not an otto.db: there is no users table')
  if (!columns('users').includes('emailVerified')) throw new Error('Already migrated (users.emailVerified is gone): nothing changed')

  const summary: Summary = { renamedColumns: 0, droppedColumns: 0, droppedTables: [], connectionsFolded: 0, projectsWithMembers: 0, notificationsRead: 0, archivedStatuses: 0 }
  const dropColumn = (table: string, column: string) => {
    if (!tables.has(table) || !columns(table).includes(column)) return
    db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`)
    summary.droppedColumns++
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const index of DROPPED_INDEXES) db.exec(`DROP INDEX IF EXISTS "${index}"`)

    // data first, while the old columns exist
    if (tables.has('connections')) {
      for (const row of db.query('SELECT id, config, account FROM connections WHERE account IS NOT NULL').all() as Row[]) {
        const account = parseObject(row.account)
        if (!Object.keys(account).length) continue
        db.query('UPDATE connections SET config = ? WHERE id = ?').run(JSON.stringify({ ...parseObject(row.config), account }), row.id as string)
        summary.connectionsFolded++
      }
    }
    if (tables.has('projects')) {
      db.exec("ALTER TABLE projects ADD COLUMN members text DEFAULT '[]' NOT NULL")
      if (tables.has('projects_members')) {
        const members = new Map<string, string[]>()
        for (const row of db.query('SELECT projectId, actor FROM projects_members ORDER BY rowid').all() as Row[]) {
          members.set(row.projectId as string, [...(members.get(row.projectId as string) ?? []), row.actor as string])
        }
        for (const [id, actors] of members) {
          summary.projectsWithMembers += db.query('UPDATE projects SET members = ? WHERE id = ?').run(JSON.stringify(actors), id).changes
        }
        db.exec('DROP TABLE projects_members')
        summary.droppedTables.push('projects_members')
      }
    }
    if (tables.has('notifications')) {
      db.exec('ALTER TABLE notifications ADD COLUMN read_at integer')
      summary.notificationsRead = db.query("UPDATE notifications SET read_at = createdAt WHERE status = 'read'").run().changes
      dropColumn('notifications', 'status')
    }

    for (const [table, list] of Object.entries(DROPPED_COLUMNS)) for (const column of list) dropColumn(table, column)

    for (const table of TABLES) {
      if (!tables.has(table) || table === 'projects_members') continue
      for (const column of columns(table)) {
        const to = SPECIAL[table]?.[column] ?? camelToSnake(column)
        if (to === column) continue
        db.exec(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "${to}"`)
        summary.renamedColumns++
      }
    }

    db.exec('CREATE INDEX `library_workspace_parent` ON `library` (`workspace_id`,`parent_id`)')
    db.exec('CREATE INDEX `notifications_user_workspace_created` ON `notifications` (`user_id`,`workspace_id`,`created_at`)')

    // every workspace that has statuses gets the fixed `archived` one, last (the others read the defaults, which include it)
    const icon = `data:image/svg+xml;base64,${Buffer.from(DEFAULT_ICON_SVGS.archived!).toString('base64')}`
    for (const { workspace_id: workspaceId } of db.query('SELECT DISTINCT workspace_id FROM statuses').all() as Row[]) {
      const has = db.query("SELECT 1 FROM statuses WHERE workspace_id = ? AND slug = 'archived'").get(workspaceId as string)
      if (has) continue
      const last = db.query('SELECT coalesce(max(position), -1) AS n FROM statuses WHERE workspace_id = ?').get(workspaceId as string) as { n: number }
      db.query("INSERT INTO statuses (id, workspace_id, slug, title, color, icon, category, is_default, position) VALUES (?, ?, 'archived', 'Archived', NULL, ?, 'archived', 0, ?)").run(crypto.randomUUID(), workspaceId as string, icon, last.n + 1)
      summary.archivedStatuses++
    }

    const problems = db.query('PRAGMA quick_check').all() as Row[]
    if (problems.length !== 1 || problems[0]!.quick_check !== 'ok') throw new Error('The database failed its integrity check after the migration; rolled back')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return summary
}

function parseObject(text: unknown): Record<string, unknown> {
  try {
    const value: unknown = typeof text === 'string' ? JSON.parse(text) : null
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path || !existsSync(path)) {
    console.error('usage: bun run scripts/db-rename-snake-case.ts <path-to-otto.db>   (the file must exist; back it up first, stop the server)')
    process.exit(2)
  }
  const db = new Database(path)
  db.exec('PRAGMA busy_timeout = 5000')
  try {
    const summary = migrateSnakeCase(db)
    console.log(`migrated ${path}`)
    console.log(JSON.stringify(summary, null, 2))
    console.log('next: bun run db:push (it should plan nothing, or only new tables)')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    db.close()
  }
}
