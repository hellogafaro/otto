import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load. The config dir is a sibling of
// `~/.otto` in the home (never the real one), so paths spelled with `~` reach it.
const configDirName = `.otto-test-${Math.random().toString(36).slice(2, 10)}`
const configDir = join(homedir(), configDirName)
mkdirSync(configDir)
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { users } = await import('../../../../shared/src/users/schema.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { registerFilesHandlers } = await import('./files')
const { registerSystemCoreHandlers } = await import('./system')
type Handler = import('../../transport/types').HandlerFn
type Deps = import('../handler-deps').HandlerDeps

const handlers = new Map<string, Handler>()
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push() {},
  async invokeClient() {
    return {}
  },
  hasClientCapability: () => false,
  findClientsWithCapability: () => [],
}
// Chats: u1 made s1, u2 made s2.
const chatOwner: Record<string, string> = { s1: 'u1', s2: 'u2' }
const deps = {
  sessionManager: { canSeeSession: (sessionId: string, userId: string | null) => chatOwner[sessionId] === userId },
  oauthFlowStore: {},
  platform: {
    appRootPath: '/',
    resourcesPath: '/',
    isPackaged: false,
    appVersion: '0.0.0-test',
    isDebugMode: true,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    imageProcessor: { process: async () => Buffer.from('png') },
  },
} as unknown as Deps

let rootA = ''
let rootB = ''
let workdir = ''
let paths: Record<string, string> = {}
const ctxOf = (userId: string) => ({ clientId: 'c1', userId, workspaceId: rootA && workspaceIdA, webContentsId: null })
let workspaceIdA = ''
const call = (user: string, channel: string, ...args: unknown[]) => handlers.get(channel)!(ctxOf(user), ...args)
const rejects = (promise: Promise<unknown>) => promise.then(() => false, (error: Error) => error.message.includes('private'))

function touch(path: string, content = 'secret') {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}

beforeAll(async () => {
  const db = initDb()
  await pushSchema(db)
  saveConfig({ workspaces: [] })
  const now = new Date()
  for (const id of ['u1', 'u2', 'u3']) db.insert(users).values({ id, name: id, email: `${id}@example.com`, createdAt: now, updatedAt: now }).run()
  rootA = join(configDir, 'workspaces', 'a')
  rootB = join(configDir, 'workspaces', 'b')
  workdir = mkdtempSync(join(tmpdir(), 'otto-workdir-'))
  const a = addWorkspace({ name: 'A', rootPath: rootA })
  const b = addWorkspace({ name: 'B', rootPath: rootB })
  workspaceIdA = a.id
  createWorkspaceMember(a.id, 'u1', 'owner')
  createWorkspaceMember(a.id, 'u2', 'member')
  createWorkspaceMember(b.id, 'u2', 'owner')
  execSync('git init -q -b main && git -c user.email=t@example.com -c user.name=t -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q --no-verify --allow-empty -m init', { cwd: (mkdirSync(rootB, { recursive: true }), rootB) })

  const link = join(workdir, 'innocent.txt')
  symlinkSync(join(configDir, 'config.json'), link) // saveConfig wrote it; never overwrite it
  paths = {
    'config.json': join(configDir, 'config.json'), // the real test config, written by saveConfig
    'config.json backup': touch(join(configDir, 'config.json.bak-2026-10-06')),
    'credentials.enc': touch(join(configDir, 'credentials.enc')),
    // otto.db is the real test database; the -wal, -shm and backup names need no file: the rule is on the path.
    'otto.db': join(configDir, 'otto.db'),
    'otto.db-wal': join(configDir, 'otto.db-wal'),
    'otto.db-shm': join(configDir, 'otto.db-shm'),
    'otto.db backup': join(configDir, 'otto.db.bak-2026-10-06'),
    'drafts.json': touch(join(configDir, 'drafts.json')),
    'log file': touch(join(configDir, 'logs', 'decisions.jsonl')),
    '.server.lock': touch(join(configDir, '.server.lock')),
    "another workspace's file": touch(join(rootB, 'library', 'plan.md')),
    'a folder no workspace claims': touch(join(configDir, 'workspaces', 'orphan', 'notes.md')),
    "another user's chat": touch(join(rootA, 'sessions', 's2', 'session.jsonl')),
    '.. out of the workspace': join(rootA, 'library', '..', '..', '..', 'config.json'),
    'symlink to config.json': link,
    '~ spelling': `~/${configDirName}/credentials.enc`,
    '~ spelling with ..': `~/${configDirName}/workspaces/a/../../otto.db`,
  }
  touch(join(rootA, 'sessions', 's1', 'session.jsonl'))
  touch(join(rootA, 'library', 'doc.md'), 'hello')
  touch(join(configDir, 'preferences.json'), '{}') // the old file nothing reads any more: private like config.json
  touch(join(configDir, 'window-state.json'), '{}')
  touch(join(workdir, 'main.ts'), 'code')
  touch(join(tmpdir(), 'otto-private-paths-tmp.txt'), 'tmp')
  registerFilesHandlers(server as never, deps)
  registerSystemCoreHandlers(server as never, deps)
})
afterAll(() => {
  rmSync(configDir, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
  rmSync(join(tmpdir(), 'otto-private-paths-tmp.txt'), { force: true })
})

const readers = [C.file.READ, C.file.READ_BINARY, C.file.READ_DATA_URL, C.file.READ_PREVIEW_DATA_URL, C.shell.OPEN_FILE, C.shell.SHOW_IN_FOLDER]
const nullWhenDenied = [C.file.READ_ATTACHMENT, C.file.READ_USER_ATTACHMENT]

describe('private paths', () => {
  it('refuses every private path on every file channel, for a member and for an owner', async () => {
    for (const [label, path] of Object.entries(paths)) {
      for (const channel of readers) expect([label, channel, await rejects(call('u1', channel, path))]).toEqual([label, channel, true])
      for (const channel of nullWhenDenied) expect([label, channel, await call('u1', channel, path)]).toEqual([label, channel, null])
    }
    // The sensitive files and unclaimed folders are denied to an owner too; u1's chat is denied to u2.
    for (const path of [paths['a folder no workspace claims']!, paths['config.json']!, paths['otto.db']!, join(rootA, 'sessions', 's1', 'session.jsonl')]) {
      expect([path, await rejects(call('u2', C.file.READ, path))]).toEqual([path, true])
    }
    expect(await rejects(call('u3', C.file.READ, join(rootA, 'library', 'doc.md')))).toBe(true) // not a member of A
  })

  it('reads what belongs to the caller', async () => {
    expect(await call('u1', C.file.READ, join(rootA, 'library', 'doc.md'))).toBe('hello')
    expect(await call('u1', C.file.READ, join(rootA, 'sessions', 's1', 'session.jsonl'))).toBe('secret')
    expect(await call('u1', C.file.READ, join(workdir, 'main.ts'))).toBe('code')
    expect(await call('u1', C.file.READ, join(tmpdir(), 'otto-private-paths-tmp.txt'))).toBe('tmp')
    expect(await call('u1', C.file.READ, join(configDir, 'window-state.json'))).toBe('{}')
    expect(await call('u2', C.file.READ, join(rootB, 'library', 'plan.md'))).toBe('secret')
    expect(await call('u2', C.file.READ, join(rootA, 'sessions', 's2', 'session.jsonl'))).toBe('secret')
    expect(await call('u1', C.file.READ_USER_ATTACHMENT, join(workdir, 'main.ts'))).not.toBeNull()
    expect(await call('u1', C.file.READ_ATTACHMENT, join(workdir, 'main.ts'))).not.toBeNull()
    expect(await rejects(call('u1', C.shell.OPEN_FILE, join(workdir, 'main.ts')))).toBe(false)
    expect(await rejects(call('u1', C.shell.SHOW_IN_FOLDER, join(rootA, 'library', 'doc.md')))).toBe(false)
  })

  it('lists and searches only what the caller may see', async () => {
    const dirs = async (user: string, path: string) =>
      ((await call(user, C.fs.LIST_DIRECTORY, path)) as { entries: { name: string }[] }).entries.map((entry) => entry.name)
    expect(await dirs('u1', join(configDir, 'workspaces'))).toEqual(['a'])
    expect(await dirs('u2', join(configDir, 'workspaces'))).toEqual(['a', 'b'])
    expect(await dirs('u1', configDir)).toContain('workspaces')
    expect(await dirs('u1', configDir)).not.toContain('logs')
    for (const path of [join(configDir, 'logs'), rootB, join(rootA, 'sessions'), join(rootA, 'sessions', 's2'), `~/${configDirName}/workspaces/b`]) {
      expect([path, await rejects(call('u1', C.fs.LIST_DIRECTORY, path))]).toEqual([path, true])
    }

    const found = async (user: string, base: string) =>
      ((await call(user, C.fs.SEARCH, base, '')) as { relativePath: string }[]).map((hit) => hit.relativePath)
    const results = await found('u1', configDir)
    expect(results).toContain('window-state.json')
    expect(results).not.toContain('preferences.json')
    expect(results).toContain('workspaces/a/library/doc.md')
    for (const hidden of ['config.json', 'credentials.enc', 'otto.db', 'drafts.json', 'logs', 'workspaces/b', 'workspaces/orphan', 'workspaces/a/sessions/s2']) {
      expect(results.some((result) => result === hidden || result.startsWith(`${hidden}/`))).toBe(false)
    }
    expect(await found('u1', rootB)).toEqual([])
    expect(await found('u1', join(configDir, 'logs'))).toEqual([])
  })

  it('runs git only where the caller may', async () => {
    expect(await call('u2', C.git.GET_BRANCH, rootB)).toBe('main')
    expect(await call('u1', C.git.GET_BRANCH, rootB)).toBeNull()
  })
})
