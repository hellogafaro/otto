import { afterAll, beforeAll, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import './electron-mock'
import { createMockDeps } from './electron-mock'

// Run in isolation: the config dir and the database are fixed when the modules load. The config dir is a
// throwaway sibling of `~/.otto` in the home (never the real one).
const configDir = join(homedir(), `.otto-test-${Math.random().toString(36).slice(2, 10)}`)
mkdirSync(configDir)
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../../../packages/shared/src/db/push.ts')
const { users } = await import('../../../../../../packages/shared/src/users/schema.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { registerSystemCoreHandlers } = await import('../system')

type Handler = (...args: never[]) => unknown
const handlers = new Map<string, Handler>()
const server = { handle: (channel: string, handler: Handler) => void handlers.set(channel, handler), push() {}, async invokeClient() { return {} } }
const deps = {
  ...createMockDeps(),
  windowManager: undefined,
  sessionManager: { canSeeSession: (id: string, userId: string | null) => id === 's1' && userId === 'u1' },
} as never
const ctx = (userId: string) => ({ clientId: 'c1', userId, workspaceId: workspaceId, webContentsId: null })
const call = (user: string, channel: string, ...args: unknown[]) => (handlers.get(channel) as (...a: unknown[]) => Promise<unknown>)(ctx(user), ...args)
const denied = (promise: Promise<unknown>) => promise.then(() => false, (error: Error) => error.message.includes('private'))

let workspaceId = ''
let own = ''
const dirs: string[] = []

beforeAll(async () => {
  const db = initDb()
  await pushSchema(db)
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  const now = new Date()
  for (const id of ['u1', 'u2']) db.insert(users).values({ id, name: id, email: `${id}@example.com`, createdAt: now, updatedAt: now }).run()
  const a = addWorkspace({ name: 'A', rootPath: join(configDir, 'workspaces', 'a') })
  const b = addWorkspace({ name: 'B', rootPath: join(configDir, 'workspaces', 'b') })
  workspaceId = a.id
  createWorkspaceMember(a.id, 'u1', 'owner')
  createWorkspaceMember(b.id, 'u2', 'owner')
  own = join(configDir, 'workspaces', 'a', 'library', 'doc.md')
  mkdirSync(join(own, '..'), { recursive: true })
  writeFileSync(own, 'hi')
  writeFileSync(join(configDir, 'credentials.enc'), 'secret')
  mkdirSync(join(configDir, 'workspaces', 'a', 'sessions', 's2'), { recursive: true })
  dirs.push(mkdtempSync(join(tmpdir(), 'otto-work-')))
  registerSystemCoreHandlers(server as never, deps)
})
afterAll(() => {
  rmSync(configDir, { recursive: true, force: true })
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

it('shell:openFile and shell:showInFolder refuse private paths and open the caller own files', async () => {
  const refused = [
    join(configDir, 'config.json'),
    join(configDir, 'credentials.enc'),
    join(configDir, 'otto.db'),
    join(configDir, 'workspaces', 'b', 'library', 'x'),
    join(configDir, 'workspaces', 'a', 'sessions', 's2', 'session.jsonl'),
    `~/${configDir.split('/').pop()}/credentials.enc`,
  ]
  for (const channel of [C.shell.OPEN_FILE, C.shell.SHOW_IN_FOLDER]) {
    for (const path of refused) expect([channel, path, await denied(call('u1', channel, path))]).toEqual([channel, path, true])
    expect(await denied(call('u1', channel, own))).toBe(false)
    expect(await denied(call('u1', channel, dirs[0]!))).toBe(false)
  }
})

it('git:getBranch does not run in a private folder', async () => {
  expect(await call('u1', C.git.GET_BRANCH, join(configDir, 'workspaces', 'b'))).toBeNull()
})
