import { afterEach, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { createConnection, deleteConnection, getConnectionById, userScope, workspaceScope } from '@otto/shared/connections'
import { initDb } from '@otto/shared/db'
import { users } from '@otto/shared/users/schema'
import { getStoredSetting, userEntity } from '@otto/shared/settings'
import { createWorkspaceMember } from '@otto/shared/workspaces'
import { savePreferences } from '@otto/shared/config/preferences'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { registerSettingsHandlers } from './settings'

const handlers = new Map<string, HandlerFn>()
registerSettingsHandlers({ handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler) } as unknown as RpcServer, {} as HandlerDeps)
const context = (userId: string | null, workspaceId: string | null = null): RequestContext => ({ userId, workspaceId, clientId: 'fixture', webContentsId: null })
const call = (channel: string, ctx: RequestContext, ...args: unknown[]) => handlers.get(channel)!(ctx, ...args)
const connections: string[] = []
afterEach(() => { for (const id of connections.splice(0)) deleteConnection(id) })

function newUser(): string {
  const id = crypto.randomUUID()
  const now = new Date()
  initDb().insert(users).values({ id, name: 'Fixture', email: `${id}@example.test`, createdAt: now, updatedAt: now }).run()
  return id
}

function legacy(scope: string, behavior: 'steer' | 'queue') {
  const row = createConnection({ scope, slug: crypto.randomUUID(), type: 'anthropic', authType: 'api_key', title: 'Fixture', config: { midStreamBehavior: behavior } })
  connections.push(row.id)
  return row
}

it('GET_USER initializes only the authenticated user, ignoring an unrelated request workspace', async () => {
  const id = newUser()
  const other = newUser()
  const workspace = crypto.randomUUID()
  legacy(userScope(other), 'queue')
  legacy(workspaceScope(workspace), 'queue')
  expect(await call(RPC_CHANNELS.preferences.GET_USER, context(id, workspace))).toMatchObject({ midStreamBehavior: 'steer', midStreamBehaviorNeedsReview: false })
  expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBe('steer')
  expect(getStoredSetting(userEntity(other), 'midStreamBehavior')).toBeUndefined()
})

it('GET_USER exposes a readonly conflict, and UPDATE_USER requires an exact explicit decision', async () => {
  const id = newUser()
  const workspace = crypto.randomUUID()
  createWorkspaceMember(workspace, id, 'member')
  const row = legacy(workspaceScope(workspace), 'queue')
  legacy(userScope(id), 'steer')
  savePreferences({ notes: 'fixture note', timezone: 'UTC', includeCoAuthoredBy: false }, id)
  expect(await call(RPC_CHANNELS.preferences.GET_USER, context(id))).toMatchObject({ midStreamBehavior: 'queue', midStreamBehaviorNeedsReview: true })
  expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined()
  expect(await call(RPC_CHANNELS.preferences.UPDATE_USER, context(id), { midStreamBehavior: 'steer' })).toMatchObject({ midStreamBehavior: 'steer', midStreamBehaviorNeedsReview: false, notes: 'fixture note', timezone: 'UTC', includeCoAuthoredBy: false })
  await call(RPC_CHANNELS.preferences.UPDATE_USER, context(id), { timezone: 'Europe/Madrid' })
  expect(await call(RPC_CHANNELS.preferences.GET_USER, context(id))).toMatchObject({ midStreamBehavior: 'steer', midStreamBehaviorNeedsReview: false })
  expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBe('steer')
  expect(getStoredSetting(userEntity(id), 'notes')).toBe('fixture note')
  expect(getConnectionById(row.id)?.config.midStreamBehavior).toBe('queue')
})

it('typed handlers reject missing and unknown authenticated principals without a first-user fallback', async () => {
  newUser()
  for (const userId of [null, '', crypto.randomUUID()]) {
    for (const channel of [RPC_CHANNELS.preferences.GET_USER, RPC_CHANNELS.preferences.UPDATE_USER]) {
      expect(() => call(channel, context(userId), {})).toThrow()
    }
  }
})

it('typed UPDATE_USER rejects invalid and readonly patches before initialization or any mutation', async () => {
  const id = newUser()
  savePreferences({ notes: 'fixture note' }, id)
  for (const patch of [{ midStreamBehavior: 'invalid' }, { midStreamBehaviorNeedsReview: false }, { midStreamBehavior: 'queue', midStreamBehaviorNeedsReview: true }, null, [], { diffViewer: { disableBackground: 'false' } }]) {
    try {
      await call(RPC_CHANNELS.preferences.UPDATE_USER, context(id), patch)
      throw new Error('Invalid update was accepted')
    } catch (error) {
      expect((error as { code: string }).code).toBe('invalid')
      expect((error as Error).message).toBe('The preference update is invalid.')
    }
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined()
    expect(getStoredSetting(userEntity(id), 'notes')).toBe('fixture note')
  }
})
