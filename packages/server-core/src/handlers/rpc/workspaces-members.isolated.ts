import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run in isolation: the config dir and the database are fixed when the modules load.
const configDir = mkdtempSync(join(tmpdir(), 'otto-members-rpc-'))
process.env.OTTO_CONFIG_DIR = configDir
process.env.BETTER_AUTH_SECRET = 'x'.repeat(40)
process.env.BETTER_AUTH_URL = 'https://otto.example.com/'

const { RPC_CHANNELS } = await import('@otto/shared/protocol')
const { saveConfig, addWorkspace } = await import('@otto/shared/config')
const { initDb } = await import('@otto/shared/db')
const { pushSchema } = await import('../../../../shared/src/db/push.ts')
const { users } = await import('../../../../shared/src/users/schema.ts')
const { createWorkspaceMember, getMemberRole, getWorkspaceInvitation } = await import('@otto/shared/workspaces')
const { WsRpcServer, WsRpcClient } = await import('../../transport')
const { authorize } = await import('../../bootstrap/authorize')
const { registerWorkspaceMembersHandlers } = await import('./workspaces-members')

const C = RPC_CHANNELS.workspaces
const servers: InstanceType<typeof WsRpcServer>[] = []
const clients: InstanceType<typeof WsRpcClient>[] = []
let url = ''
let server: InstanceType<typeof WsRpcServer>
let A = ''

const connect = async (user: string) => {
  const client = new WsRpcClient(url, { token: user, workspaceId: A, clientCapabilities: [], autoReconnect: false })
  clients.push(client)
  const pushed: unknown[] = []
  client.on('test:pushed', (value) => pushed.push(value))
  client.connect()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never connected')), 3000)
    client.onConnectionStateChanged((state) => {
      if (state.status === 'connected') (clearTimeout(timer), resolve())
      else if (state.status === 'failed') (clearTimeout(timer), reject(new Error(state.lastError?.message)))
    })
  })
  return Object.assign(client, { pushed })
}
const codeOf = async (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code)
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeAll(async () => {
  const db = initDb()
  await pushSchema(db)
  saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  A = addWorkspace({ name: 'Main', rootPath: join(configDir, 'a') }).id
  const now = new Date()
  for (const id of ['owner', 'member', 'second']) {
    db.insert(users).values({ id, name: `Name ${id}`, email: `${id}@example.com`, createdAt: now, updatedAt: now }).run()
  }
  createWorkspaceMember(A, 'owner', 'owner')
  createWorkspaceMember(A, 'member', 'member')
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async (token) => ({ userId: token }), authorize })
  registerWorkspaceMembersHandlers(server)
  await server.listen()
  servers.push(server)
  url = `ws://127.0.0.1:${server.port}`
})
afterAll(() => {
  for (const client of clients) client.destroy()
  for (const server of servers) server.close()
  rmSync(configDir, { recursive: true, force: true })
})

describe('workspace members and invitations RPCs', () => {
  it('lets any member read the members, with their actor, name, email and role', async () => {
    const member = await connect('member')
    expect(await member.invoke(C.GET_MEMBERS, A)).toEqual([
      { actor: 'user:owner', userId: 'owner', name: 'Name owner', email: 'owner@example.com', role: 'owner' },
      { actor: 'user:member', userId: 'member', name: 'Name member', email: 'member@example.com', role: 'member', me: true },
    ])
  })

  it('keeps invitations and member management to owners', async () => {
    const member = await connect('member')
    const attempts: [string, unknown[]][] = [
      [C.GET_INVITATIONS, [A]],
      [C.INVITE, [A, 'new@example.com']],
      [C.REMOVE_MEMBER, [A, 'owner']],
      [C.UPDATE_MEMBER_ROLE, [A, 'member', 'owner']],
    ]
    for (const [channel, args] of attempts) expect(await codeOf(member.invoke(channel, ...args))).toBe('forbidden')
    expect(getMemberRole(A, 'member')).toBe('member')
  })

  it('invites by email with a link, refuses members and bad emails, and revokes', async () => {
    const owner = await connect('owner')
    const invitation = (await owner.invoke(C.INVITE, A, 'New@Example.com')) as { id: string; email: string; expiresAt: number; link: string }
    expect(invitation.email).toBe('new@example.com')
    expect(invitation.link).toBe(`https://otto.example.com/login?invite=${invitation.id}&email=new%40example.com`)
    expect(Math.round((invitation.expiresAt - Date.now()) / 86_400_000)).toBe(7)
    expect(await owner.invoke(C.GET_INVITATIONS, A)).toEqual([invitation])

    expect(await codeOf(owner.invoke(C.INVITE, A, 'member@example.com'))).toBe('conflict')
    expect(await codeOf(owner.invoke(C.INVITE, A, 'nope'))).toBe('invalid')

    // Only an owner of the invitation's workspace may revoke it.
    expect(await codeOf((await connect('member')).invoke(C.REVOKE_INVITATION, invitation.id))).toBe('forbidden')
    expect(await codeOf(owner.invoke(C.REVOKE_INVITATION, 'missing00000'))).toBe('not_found')
    await owner.invoke(C.REVOKE_INVITATION, invitation.id)
    expect(getWorkspaceInvitation(invitation.id)?.status).toBe('canceled')
    expect(await owner.invoke(C.GET_INVITATIONS, A)).toEqual([])
    expect(await codeOf(owner.invoke(C.REVOKE_INVITATION, invitation.id))).toBe('not_found')
  })

  it('changes roles within the allow-list and keeps one owner', async () => {
    const owner = await connect('owner')
    expect(await codeOf(owner.invoke(C.UPDATE_MEMBER_ROLE, A, 'member', 'admin'))).toBe('invalid')
    expect(await codeOf(owner.invoke(C.UPDATE_MEMBER_ROLE, A, 'owner', 'member'))).toBe('conflict')
    expect(await codeOf(owner.invoke(C.REMOVE_MEMBER, A, 'owner'))).toBe('conflict')
    expect(await codeOf(owner.invoke(C.LEAVE, A))).toBe('conflict')
    expect(await codeOf(owner.invoke(C.REMOVE_MEMBER, A, 'stranger'))).toBe('not_found')
    await owner.invoke(C.UPDATE_MEMBER_ROLE, A, 'member', 'owner')
    expect(getMemberRole(A, 'member')).toBe('owner')
    await owner.invoke(C.UPDATE_MEMBER_ROLE, A, 'member', 'member')
    expect(getMemberRole(A, 'member')).toBe('member')
  })

  it('a removed member loses access at once: requests are refused, pushes stop, they cannot reconnect', async () => {
    createWorkspaceMember(A, 'second', 'member')
    const owner = await connect('owner')
    const second = await connect('second')
    server.push('test:pushed', { to: 'workspace', workspaceId: A }, 'before')
    await settle()
    expect(second.pushed).toEqual(['before'])
    expect(await second.invoke(C.GET_MEMBERS, A)).toHaveLength(3)

    await owner.invoke(C.REMOVE_MEMBER, A, 'second')
    expect(await codeOf(second.invoke(C.GET_MEMBERS, A))).toBe('forbidden')
    server.push('test:pushed', { to: 'workspace', workspaceId: A }, 'after')
    await settle()
    expect(second.pushed).toEqual(['before'])
    expect(owner.pushed).toEqual(['before', 'after'])
    await expect(connect('second')).rejects.toThrow()
  })

  it('lets a member leave', async () => {
    const member = await connect('member')
    await member.invoke(C.LEAVE, A)
    expect(getMemberRole(A, 'member')).toBeNull()
    expect(await codeOf(member.invoke(C.GET_MEMBERS, A))).toBe('forbidden')
  })
})
