import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'bun:test'

const dir = mkdtempSync(join(tmpdir(), 'seed-demo-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const run = (...args: string[]) => {
  const out = Bun.spawnSync([process.execPath, 'run', join(import.meta.dir, 'seed-demo.ts'), '--config-dir', dir, ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' })
  expect(out.exitCode, out.stderr.toString() + out.stdout.toString()).toBe(0)
  return out.stdout.toString()
}
const manifest = () => JSON.parse(readFileSync(join(dir, 'demo-seed.json'), 'utf8')) as { workspaceId: string; tasks: string[]; chats: string[] }
const count = (table: string, where = '1') => {
  const db = new Database(join(dir, 'otto.db'), { readonly: true })
  try { return (db.query(`select count(*) n from ${table} where ${where}`).get() as { n: number }).n } finally { db.close() }
}

test('seeds twice without doubling, tags everything in the manifest, and --clear removes exactly that', () => {
  const first = run('--scale', 'small')
  expect(first).not.toContain(readFileSync(join(dir, 'demo-users.txt'), 'utf8').split('\n')[1]!) // the password is never printed
  expect(first).toContain(`demo users share password stored in ${join(dir, 'demo-users.txt')}`)
  expect(statSync(join(dir, 'demo-users.txt')).mode & 0o777).toBe(0o600)
  const one = manifest()
  expect(one.tasks).toHaveLength(30)
  expect(one.chats).toHaveLength(10)
  expect(count('tasks')).toBe(30)
  expect(count('chats')).toBe(10)
  expect(count('projects')).toBe(4)
  expect(count('users', "email like '%@demo.otto.test'")).toBe(3)
  expect(count('library', "type = 'folder'")).toBe(5)
  expect(count('routines')).toBe(6)
  expect(count('messages', `chat_id = '${one.chats[0]}'`)).toBe(80) // the long chat
  expect(readdirSync(dir).filter((name) => name.startsWith('backups-seed-'))).toHaveLength(0) // a new install has nothing to back up

  // Something the seed did not make: it must survive the second run and the clear.
  const raw = new Database(join(dir, 'otto.db'))
  const now = Date.now()
  raw.query('insert into projects (id, workspace_id, title, description, status, members, resources, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('keepme000001', one.workspaceId, 'Not demo', '', 'active', '[]', '[]', now, now)
  raw.close()

  run('--scale', 'small')
  const two = manifest()
  expect(count('tasks')).toBe(30)
  expect(count('chats')).toBe(10)
  expect(count('users', "email like '%@demo.otto.test'")).toBe(3)
  expect(count('projects')).toBe(5)
  expect(two.tasks.some((id) => one.tasks.includes(id))).toBe(false) // made again, not kept
  expect(readdirSync(dir).filter((name) => name.startsWith('backups-seed-'))).toHaveLength(1)
  expect(existsSync(join(dir, readdirSync(dir).find((name) => name.startsWith('backups-seed-'))!, 'otto.db'))).toBe(true)

  run('--clear')
  expect(existsSync(join(dir, 'demo-seed.json'))).toBe(false)
  expect(existsSync(join(dir, 'demo-users.txt'))).toBe(false)
  for (const table of ['tasks', 'chats', 'messages', 'comments', 'notifications', 'routines', 'routines_history', 'skills', 'sources', 'users', 'users_accounts', 'labels', 'labels_entities']) expect(count(table), table).toBe(0)
  expect(count('library')).toBe(0)
  expect(count('projects')).toBe(1)
  expect(count('projects', "id = 'keepme000001'")).toBe(1)
}, 120_000)

test('refuses to touch the real config dir without --yes', () => {
  const out = Bun.spawnSync([process.execPath, 'run', join(import.meta.dir, 'seed-demo.ts')], { env: { ...process.env, OTTO_CONFIG_DIR: '' }, stdout: 'pipe', stderr: 'pipe' })
  expect(out.exitCode).toBe(1)
  expect(out.stderr.toString()).toContain('--yes')
})
