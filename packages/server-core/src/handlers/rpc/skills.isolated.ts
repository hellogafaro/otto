import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-skills-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir

const { RPC_CHANNELS: C } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { createWorkspaceMember } = await import('@otto/shared/workspaces')
const { createSkill, getSkill } = await import('@otto/shared/skills')
const { authorize } = await import('../../bootstrap/authorize')
const { broadcastDomainChanges } = await import('./domain-changes')
const { registerSkillsHandlers } = await import('./skills')
type Handler = import('../../transport/types').HandlerFn
type Ctx = import('../../transport/types').RequestContext

const handlers = new Map<string, Handler>()
const pushes: unknown[][] = []
const server = {
  handle: (channel: string, handler: Handler) => void handlers.set(channel, handler),
  push: (...args: unknown[]) => void pushes.push(args),
  async invokeClient() {},
}

const [OWNER, CREATOR, OTHER, OUTSIDER] = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', 'dddddddddddd']
let workspaceId = ''
const files = (name: string) => new Map([['SKILL.md', new TextEncoder().encode(`---\nname: ${name}\ndescription: About ${name}\n---\nBody\n`)]])
const ctxOf = (userId: string): Ctx => ({ clientId: 'c1', userId, workspaceId, webContentsId: null })
const call = (userId: string, channel: string, ...args: unknown[]) => handlers.get(channel)!(ctxOf(userId), ...args)
const refused = (userId: string, channel: string, ...args: unknown[]) => {
  try {
    authorize({ userId, workspaceId }, channel, args)
    return false
  } catch (error) {
    return (error as { code?: string }).code === 'forbidden'
  }
}

beforeAll(async () => {
  await pushSchema(initDb())
  saveConfig({ workspaces: [] })
  workspaceId = addWorkspace({ name: 'Test', rootPath: join(configDir, 'workspace') }).id
  createWorkspaceMember(workspaceId, OWNER, 'owner')
  createWorkspaceMember(workspaceId, CREATOR, 'member')
  createWorkspaceMember(workspaceId, OTHER, 'member')
  registerSkillsHandlers(broadcastDomainChanges(server as never, { platform: {} } as never), { platform: {} } as never)
})
afterAll(() => rmSync(configDir, { recursive: true, force: true }))

describe('skills handlers', () => {
  it('lists the rows, read from their folders, and lists a skill\'s files', async () => {
    await createSkill({ workspaceId, slug: 'review', files: new Map([...files('Review'), ['scripts/run.py', new Uint8Array([1])]]), createdBy: `user:${CREATOR}` })
    const list = (await call(OTHER, C.skills.GET, workspaceId)) as { slug: string; metadata: { name: string }; content: string }[]
    expect(list.map((s) => [s.slug, s.metadata.name, s.content.trim()])).toEqual([['review', 'Review', 'Body']])
    const tree = (await call(OTHER, C.skills.GET_FILES, 'Test', 'review')) as { name: string; type: string }[]
    expect(tree.map((f) => f.name)).toEqual(['scripts', 'SKILL.md'])
  })

  it('never turns a client\'s string into a path: only a skill that is a row has files', async () => {
    for (const slug of ['..', '../..', 'nope']) await expect(call(OTHER, C.skills.GET_FILES, workspaceId, slug)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('authorizes: members read, the creator or an owner deletes, others and outsiders are refused', () => {
    for (const channel of [C.skills.GET]) {
      expect(refused(OTHER, channel, workspaceId)).toBe(false)
      expect(refused(OUTSIDER, channel, workspaceId)).toBe(true)
    }
    expect(refused(CREATOR, C.skills.DELETE, workspaceId, 'review')).toBe(false)
    expect(refused(OWNER, C.skills.DELETE, workspaceId, 'review')).toBe(false)
    expect(refused(OTHER, C.skills.DELETE, workspaceId, 'review')).toBe(true)
    expect(refused(OTHER, C.skills.DELETE, 'Test', 'review')).toBe(true) // by name too
    expect(refused(OUTSIDER, C.skills.DELETE, workspaceId, 'review')).toBe(true)
    expect(refused(OTHER, C.skills.DELETE, workspaceId, 'missing')).toBe(false) // the handler answers not_found
  })

  it('deletes the row, the bundle and the folder, and pushes domain:changed once; a failed delete pushes nothing', async () => {
    pushes.length = 0
    await expect(call(OWNER, C.skills.DELETE, workspaceId, 'missing')).rejects.toMatchObject({ code: 'not_found' })
    expect(pushes).toHaveLength(0)
    await call(CREATOR, C.skills.DELETE, workspaceId, 'review')
    expect(getSkill(workspaceId, 'review')).toBeUndefined()
    expect(existsSync(join(configDir, 'workspace', 'skills', 'review'))).toBe(false)
    expect(pushes.filter((args) => args[0] === C.domain.CHANGED).map((args) => args[2])).toEqual([{ domain: 'skills', workspaceId }])
    expect(await call(OTHER, C.skills.GET, workspaceId)).toEqual([])
  })
})
