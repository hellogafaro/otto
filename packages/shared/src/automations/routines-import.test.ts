import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { INSTALL, getSetting } from '../settings/index.ts'
import { users } from '../users/schema.ts'
import { createWorkspaceMember } from '../workspaces/members.ts'
import { initRoutinesImport } from './routines-import.ts'
import { getRoutines } from './routines.ts'

const roots: string[] = []
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })))

/** A workspace folder holding the given automations.json (or none). */
function workspace(file?: unknown): { id: string; rootPath: string } {
  const rootPath = mkdtempSync(join(tmpdir(), 'otto-routines-import-'))
  roots.push(rootPath)
  if (file !== undefined) writeFileSync(join(rootPath, 'automations.json'), typeof file === 'string' ? file : JSON.stringify(file))
  return { id: `ws-${roots.length}`, rootPath }
}

async function setup(withUser = true) {
  const db = openDb(':memory:')
  await pushSchema(db)
  const now = new Date()
  if (withUser) {
    db.insert(users).values({ id: 'aaaaaaaaaaaa', name: 'a', email: 'a@x.test', createdAt: now, updatedAt: now }).run()
    db.insert(users).values({ id: 'bbbbbbbbbbbb', name: 'b', email: 'b@x.test', createdAt: new Date(now.getTime() + 1), updatedAt: now }).run()
  }
  return db
}

const file = {
  version: 2,
  automations: {
    SchedulerTick: [
      { id: 'aaaaaa', name: 'Digest', cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', labels: ['bug'], actions: [{ type: 'prompt', prompt: 'Sum up' }] },
      { id: 'bbbbbb', cron: '*/15 * * * *', enabled: false, actions: [{ type: 'script', script: 'scripts/sync.ts' }] },
    ],
    LabelAdd: [{ id: 'cccccc', name: 'Triage', matcher: '^urgent$', permissionMode: 'safe', actions: [{ type: 'webhook', url: 'https://example.test/hook', auth: { type: 'bearer', token: 'secret-token' } }, { type: 'prompt', prompt: 'Look' }] }],
  },
}

test('imports each matcher as a routine of the first owner, once, and keeps the file', async () => {
  const db = await setup()
  const ws = workspace(file)
  createWorkspaceMember(ws.id, 'bbbbbbbbbbbb', 'owner', db)
  const stored: [string, string][] = []
  const report = initRoutinesImport(db, [ws], (title, value) => (stored.push([title, value]), `secret${stored.length}`))
  expect(report).toMatchObject({ workspaces: 1, routines: 3, skipped: 0, warnings: [] })

  const [digest, sync, triage] = getRoutines(ws.id, db)
  expect(digest).toMatchObject({
    title: 'Digest',
    agentId: null,
    pausedAt: null,
    createdBy: 'user:bbbbbbbbbbbb',
    config: { type: 'schedule', schedule: { cron: '0 9 * * 1-5', timezone: 'Europe/Berlin' }, actions: [{ type: 'prompt', prompt: 'Sum up', labels: ['bug'] }] },
  })
  expect(sync!.pausedAt).toBeGreaterThan(0) // enabled: false
  expect(sync!.config).toMatchObject({ type: 'schedule', schedule: { cron: '*/15 * * * *' } })
  expect(sync!.title).toContain('sync.ts')
  expect(triage!.config).toMatchObject({ type: 'event', event: 'LabelAdd', matcher: '^urgent$', permissionMode: 'safe' })
  // the webhook's plain-text credentials became a secret: the row keeps only its id
  expect(JSON.stringify(triage)).not.toContain('secret-token')
  expect(triage!.config.actions[0]).toEqual({ type: 'webhook', url: 'https://example.test/hook', secretId: 'secret1' })
  expect(stored).toEqual([['Webhook credentials: Triage', JSON.stringify({ type: 'bearer', token: 'secret-token' })]])
  expect(getSetting(INSTALL, 'imports', db)[`routines:${ws.id}`]).toBeGreaterThan(0)
})

test('is idempotent: a second run, even after the file changed or a routine was deleted, adds nothing', async () => {
  const db = await setup()
  const ws = workspace(file)
  expect(initRoutinesImport(db, [ws], () => 's')).toMatchObject({ workspaces: 1, routines: 3 })
  writeFileSync(join(ws.rootPath, 'automations.json'), JSON.stringify({ automations: { LabelAdd: [{ actions: [{ type: 'prompt', prompt: 'new' }] }] } }))
  expect(initRoutinesImport(db, [ws], () => 's')).toMatchObject({ workspaces: 0, routines: 0 })
  expect(getRoutines(ws.id, db)).toHaveLength(3)
})

test('a workspace without a file, with an unreadable one or with an invalid one imports nothing and is not fatal', async () => {
  const db = await setup()
  const none = workspace()
  const broken = workspace('{ not json')
  const invalid = workspace({ automations: { LabelAdd: [{ actions: [{ type: 'nope' }] }] } })
  const good = workspace(file)
  const report = initRoutinesImport(db, [none, broken, invalid, good], () => 's')
  expect(report).toMatchObject({ workspaces: 4, routines: 3 })
  expect(report.warnings).toHaveLength(2)
  expect(getRoutines(none.id, db)).toEqual([])
  expect(getRoutines(good.id, db)).toHaveLength(3)
})

test('a scheduled matcher without a cron is skipped with a warning, the others still import', async () => {
  const db = await setup()
  const ws = workspace({ automations: { SchedulerTick: [{ actions: [{ type: 'prompt', prompt: 'no cron' }] }], LabelAdd: [{ actions: [{ type: 'prompt', prompt: 'ok' }] }] } })
  const report = initRoutinesImport(db, [ws], () => 's')
  expect(report).toMatchObject({ routines: 1 })
  expect(report.warnings.some((warning) => warning.includes('cron'))).toBe(true)
})

test('waits for a user to own the routines when there is none, then imports on a later boot', async () => {
  const db = await setup(false)
  const ws = workspace(file)
  expect(initRoutinesImport(db, [ws], () => 's')).toMatchObject({ workspaces: 0, skipped: 1 })
  expect(getSetting(INSTALL, 'imports', db)[`routines:${ws.id}`]).toBeUndefined()
  const now = new Date()
  db.insert(users).values({ id: 'aaaaaaaaaaaa', name: 'a', email: 'a@x.test', createdAt: now, updatedAt: now }).run()
  expect(initRoutinesImport(db, [ws], () => 's')).toMatchObject({ workspaces: 1, routines: 3 })
})
