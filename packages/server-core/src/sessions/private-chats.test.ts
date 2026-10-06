import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { Workspace } from '@otto/shared/config'
import { createManagedSession, SessionManager } from './session-manager.ts'
import { getChatAudience } from './private-chats.ts'

const WS: Workspace = { id: 'ws-1', name: 'Main', rootPath: '/tmp/ws-1', createdAt: 0 } as Workspace
const OTHER_WS: Workspace = { id: 'ws-2', name: 'Side', rootPath: '/tmp/ws-2', createdAt: 0 } as Workspace
// ws-1 is owned by 'owner-1' and 'owner-2'; 'alice' and 'bob' are plain members.
const OWNERS: Record<string, string[]> = { 'ws-1': ['owner-1', 'owner-2'], 'ws-2': ['alice'] }

function setup() {
  const sm = new SessionManager()
  sm.setWorkspaceOwners((id) => OWNERS[id] ?? [])
  const pushes: Array<{ channel: string; target: any; payload: unknown[] }> = []
  sm.setEventSink((channel, target, ...payload) => pushes.push({ channel, target, payload }))
  const add = (id: string, createdBy: string | undefined, extra: Record<string, unknown> = {}, workspace = WS) =>
    (sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, createManagedSession({ id, createdBy, ...extra }, workspace))
  add('alice-chat', 'user:alice', { hasUnread: true })
  add('bob-chat', 'user:bob', { hasUnread: true })
  add('legacy-chat', undefined, { hasUnread: true })
  add('alice-elsewhere', 'user:alice', { hasUnread: true }, OTHER_WS)
  return { sm, pushes }
}

const ids = (sessions: Array<{ id: string }>) => sessions.map((s) => s.id).sort()

describe('getChatAudience', () => {
  it('is the creator, or the owners when there is no creator, or nobody for a creator that is no user', () => {
    expect(getChatAudience({ createdBy: 'user:alice' }, () => ['owner-1'])).toEqual(['alice'])
    expect(getChatAudience({}, () => ['owner-1', 'owner-2'])).toEqual(['owner-1', 'owner-2'])
    expect(getChatAudience({ createdBy: 'agent:default' }, () => ['owner-1'])).toEqual([])
  })
})

describe('who sees a chat', () => {
  it('lists only the chats of the caller; a member never sees another member chat', () => {
    const { sm } = setup()

    expect(ids(sm.getSessions('ws-1', 'alice'))).toEqual(['alice-chat'])
    expect(ids(sm.getSessions('ws-1', 'bob'))).toEqual(['bob-chat'])
    expect(ids(sm.getSessions(undefined, 'alice'))).toEqual(['alice-chat', 'alice-elsewhere'])
    expect(ids(sm.getSessions('ws-1', 'stranger'))).toEqual([])
    expect(ids(sm.getSessions('ws-1', null))).toEqual([])
  })

  it('shows a chat with no creator to the workspace owners only, and owners see no chat of a member', () => {
    const { sm } = setup()

    expect(ids(sm.getSessions('ws-1', 'owner-1'))).toEqual(['legacy-chat'])
    expect(ids(sm.getSessions('ws-1', 'owner-2'))).toEqual(['legacy-chat'])
    expect(sm.canSeeSession('legacy-chat', 'alice')).toBe(false)
    // owner of ws-2 (alice) is not an owner of ws-1
    expect(sm.canSeeSession('legacy-chat', 'alice')).toBe(false)
    expect(sm.canSeeSession('alice-chat', 'owner-1')).toBe(false)
  })

  it('has no chat that does not exist, and no owner list until the host sets one', () => {
    const { sm } = setup()
    expect(sm.canSeeSession('nope', 'alice')).toBe(false)

    const bare = new SessionManager()
    ;(bare as unknown as { sessions: Map<string, unknown> }).sessions.set('old', createManagedSession({ id: 'old' }, WS))
    expect(bare.canSeeSession('old', 'owner-1')).toBe(false)
  })

  it('narrows the unread counts, the active chats and mark-all-read to the caller', async () => {
    const { sm } = setup()

    expect(sm.getUnreadSummary('alice')).toMatchObject({ totalUnreadSessions: 2, byWorkspace: { 'ws-1': 1, 'ws-2': 1 } })
    expect(sm.getUnreadSummary('bob').totalUnreadSessions).toBe(1)
    expect(sm.getUnreadSummary('owner-1').totalUnreadSessions).toBe(1)
    expect(sm.getUnreadSummary('stranger').totalUnreadSessions).toBe(0)

    ;(sm as unknown as { sessions: Map<string, { isProcessing: boolean }> }).sessions.get('bob-chat')!.isProcessing = true
    expect(sm.getActiveSessionsInfo('alice')).toEqual([])
    expect(sm.getActiveSessionsInfo('bob').map((s) => s.sessionId)).toEqual(['bob-chat'])

    await sm.markAllSessionsRead('ws-1', 'stranger')
    expect(sm.getUnreadSummary().byWorkspace['ws-1']).toBe(3)
  })

  it('hides the output of a background task of someone else chat', async () => {
    const { sm } = setup()
    ;(sm as unknown as { taskOutputIndex: Map<string, string> }).taskOutputIndex.set('task-1', 'bob-chat')

    expect(await sm.getTaskOutput('task-1', 'alice')).toBeNull()
  })
})

describe('where a chat event goes', () => {
  it('only to the connections of the users who may see the chat', () => {
    const { sm, pushes } = setup()

    sm.notifySessionCreated('ws-1', 'alice-chat')
    sm.notifySessionCreated('ws-1', 'legacy-chat')
    sm.notifySessionCreated('ws-1', 'gone')

    expect(pushes.map((p) => [p.channel, p.target])).toEqual([
      [RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-1', userIds: ['alice'] }],
      [RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-1', userIds: ['owner-1', 'owner-2'] }],
      [RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-1', userIds: [] }],
    ])
  })

  it('pushes each user their own unread summary, and the last one a user had a chat for', () => {
    const { sm, pushes } = setup()
    const summaries = () =>
      Object.fromEntries(
        pushes.filter((p) => p.channel === RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED).map((p) => [p.target.userIds[0], (p.payload[0] as { totalUnreadSessions: number }).totalUnreadSessions]),
      )
    const emit = () => (sm as unknown as { emitUnreadSummaryChanged(): void }).emitUnreadSummaryChanged()

    emit()
    expect(summaries()).toEqual({ alice: 2, bob: 1, 'owner-1': 1, 'owner-2': 1 })

    pushes.length = 0
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.delete('bob-chat')
    emit()
    expect(summaries()).toEqual({ alice: 2, bob: 0, 'owner-1': 1, 'owner-2': 1 })
  })
})
