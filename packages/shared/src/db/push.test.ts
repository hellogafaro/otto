import { expect, test } from 'bun:test'
import { openDb } from './index.ts'
import { pushSchema } from './push.ts'

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
