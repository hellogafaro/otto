import { Glob } from 'bun'
import { expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { openDb } from './index.ts'
import { pushSchema, SCHEMAS } from './push.ts'

test('SCHEMAS names every schema.ts', async () => {
  const domains: string[] = []
  for await (const file of new Glob('**/schema.ts').scan({ cwd: join(import.meta.dir, '..') })) domains.push(dirname(file))
  expect(Object.keys(SCHEMAS).sort()).toEqual(domains.sort())
})

const raw = (db: ReturnType<typeof openDb>) => (db as unknown as { $client: import('bun:sqlite').Database }).$client

test('leaves a populated FTS5 table alone and still applies a schema change in the same run', async () => {
  const db = openDb(':memory:')
  const sqlite = raw(db)
  await pushSchema(db)
  sqlite.exec('CREATE VIRTUAL TABLE messages_fts USING fts5(text)')
  sqlite.exec("INSERT INTO messages_fts (rowid, text) VALUES (1, 'hello world'), (2, 'goodbye')")
  // A real change: drop a table the schemas own, so the run has work to do besides the FTS table.
  sqlite.exec('DROP TABLE secrets')

  const statements = await pushSchema(db)

  expect(statements.join('\n')).toContain('CREATE TABLE `secrets`')
  expect(statements.join('\n')).not.toContain('_fts')
  expect(sqlite.query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'hello'").all()).toEqual([{ rowid: 1 }])
  const shadow = sqlite.query("SELECT name FROM sqlite_master WHERE name LIKE 'messages_fts%'").all()
  expect(shadow.length).toBeGreaterThan(1)
})

test('a second push with an FTS5 table present plans nothing', async () => {
  const db = openDb(':memory:')
  await pushSchema(db)
  raw(db).exec('CREATE VIRTUAL TABLE x_fts USING fts5(a)')
  expect(await pushSchema(db)).toEqual([])
})

test('a table rebuilt while it gains a NOT NULL column keeps its rows and gives them the default', async () => {
  const db = openDb(':memory:')
  await pushSchema(db)
  const sqlite = raw(db)
  sqlite.exec('DROP TABLE comments')
  // `id` without NOT NULL makes drizzle-kit rebuild the table (a plain ADD COLUMN never had the bug)
  sqlite.exec('CREATE TABLE comments (id text PRIMARY KEY, workspace_id text NOT NULL, entity text NOT NULL, created_by text NOT NULL, content text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL)')
  sqlite.exec("INSERT INTO comments VALUES ('aaaaaaaaaaaa', 'w', 'task:tttttttttttt', 'user:aaaaaaaaaaaa', 'hi', 1, 1)")
  expect((await pushSchema(db)).join('\n')).toContain('INSERT INTO `__new_comments`')
  expect(sqlite.query('SELECT id, type, content FROM comments').all()).toEqual([{ id: 'aaaaaaaaaaaa', type: 'comment', content: 'hi' }])
})
