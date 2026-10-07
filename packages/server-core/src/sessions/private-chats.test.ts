import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { Workspace } from '@otto/shared/config'
import { createManagedSession, SessionManager } from './session-manager.ts'
import { getChatAudience } from './private-chats.ts'

const WS: Workspace = { id: 'ws-1', name: 'Main', rootPath: '/tmp/ws-1', createdAt: 0 } as Workspace
const OTHER_WS: Workspace = { id: 'ws-2', name: 'Side', rootPath: '/tmp/ws-2', createdAt: 0 } as Workspace
// ws-1 is owned by 'owner-1' and 'owner-2'; 'alice' and 'bob' are plain members.
const OWNERS: Record<string, string[]> = { 'ws-1': ['owner-1', 'owner-2'], 'ws-2': ['alice'] }

/** Members as `chats_members` gives them: each person with a read time (null = never read). */
const members = (...entries: Array<[string, number | null]>) => entries.map(([actor, readAt]) => ({ actor, readAt }))

function setup() {
  const sm = new SessionManager()
  sm.setWorkspaceOwners((id) => OWNERS[id] ?? [])
  const pushes: Array<{ channel: string; target: any; payload: unknown[] }> = []
  sm.setEventSink((channel, target, ...payload) => pushes.push({ channel, target, payload }))
  const add = (id: string, createdBy: string | undefined, chatMembers: ReturnType<typeof members>, workspace = WS) =>
    (sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, createManagedSession({ id, createdBy, lastMessageAt: 100 }, workspace, { members: chatMembers }))
  // unread: never read, or read before the last message (100)
  add('alice-chat', 'user:alice', members(['user:alice', null], ['agent:a1', null]))
  add('bob-chat', 'user:bob', members(['user:bob', 50]))
  add('legacy-chat', undefined, [])
  add('alice-elsewhere', 'user:alice', members(['user:alice', null]), OTHER_WS)
  // shared by alice with bob: unread for bob only
  add('shared', 'user:alice', members(['user:alice', 200], ['user:bob', 10], ['agent:a1', null]))
  return { sm, pushes }
}

const ids = (sessions: Array<{ id: string }>) => sessions.map((s) => s.id).sort()

describe('getChatAudience', () => {
  it('is the member people, never an agent; a chat with no members has nobody', () => {
    expect(getChatAudience({ members: members(['user:alice', null], ['agent:a1', null], ['user:bob', 3]) })).toEqual(['alice', 'bob'])
    expect(getChatAudience({})).toEqual([])
    expect(getChatAudience({ members: members(['agent:default', null]) })).toEqual([])
  })
})

describe('who sees a chat', () => {
  it('lists only the chats the caller is a member of', () => {
    const { sm } = setup()

    expect(ids(sm.getSessions('ws-1', 'alice'))).toEqual(['alice-chat', 'shared'])
    expect(ids(sm.getSessions('ws-1', 'bob'))).toEqual(['bob-chat', 'shared'])
    expect(ids(sm.getSessions(undefined, 'alice'))).toEqual(['alice-chat', 'alice-elsewhere', 'shared'])
    expect(ids(sm.getSessions('ws-1', 'stranger'))).toEqual([])
    expect(ids(sm.getSessions('ws-1', null))).toEqual([])
  })

  it('a workspace owner who is not a member sees nothing; a chat with no members is nobody s', () => {
    const { sm } = setup()

    expect(ids(sm.getSessions('ws-1', 'owner-1'))).toEqual([])
    expect(sm.canSeeSession('legacy-chat', 'owner-1')).toBe(false)
    expect(sm.canSeeSession('alice-chat', 'owner-1')).toBe(false)
    expect(sm.canSeeSession('shared', 'bob')).toBe(true)
    expect(sm.canSeeSession('nope', 'alice')).toBe(false)
  })

  it('gives each person their own unread state, members and DM key in the list', () => {
    const { sm } = setup()
    const shared = (viewer: string) => sm.getSessions('ws-1', viewer).find((s) => s.id === 'shared')!

    expect(shared('alice')).toMatchObject({ hasUnread: false, members: ['user:alice', 'user:bob', 'agent:a1'] })
    expect(shared('bob').hasUnread).toBe(true)
    expect(sm.getUnreadSummary('alice')).toMatchObject({ totalUnreadSessions: 2, byWorkspace: { 'ws-1': 1, 'ws-2': 1 } })
    expect(sm.getUnreadSummary('bob')).toMatchObject({ totalUnreadSessions: 2, byWorkspace: { 'ws-1': 2 } })
    expect(sm.getUnreadSummary('owner-1').totalUnreadSessions).toBe(0)
  })

  it('marks read, unread and all read per person, never for someone else', async () => {
    const { sm } = setup()

    await sm.markSessionRead('shared', 'bob')
    expect(sm.getSessions('ws-1', 'bob').find((s) => s.id === 'shared')!.hasUnread).toBe(false)
    await sm.markSessionUnread('shared', 'alice')
    expect(sm.getSessions('ws-1', 'alice').find((s) => s.id === 'shared')!.hasUnread).toBe(true)
    expect(sm.getSessions('ws-1', 'bob').find((s) => s.id === 'shared')!.hasUnread).toBe(false)

    await sm.markAllSessionsRead('ws-1', 'stranger')
    expect(sm.getUnreadSummary('alice').byWorkspace['ws-1']).toBe(2)
    await sm.markAllSessionsRead('ws-1', 'alice')
    expect(sm.getUnreadSummary('alice').byWorkspace['ws-1'] ?? 0).toBe(0)
    expect(sm.getUnreadSummary('bob').byWorkspace['ws-1']).toBe(1)

    ;(sm as unknown as { sessions: Map<string, { isProcessing: boolean }> }).sessions.get('bob-chat')!.isProcessing = true
    expect(sm.getActiveSessionsInfo('alice')).toEqual([])
    expect(sm.getActiveSessionsInfo('bob').map((s) => s.sessionId)).toEqual(['bob-chat'])
  })
})

describe('members', () => {
  it('only the creator adds or removes; anyone else may leave, the creator cannot; non-members get not_found', async () => {
    const { sm, pushes } = setup()
    const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string }) => error.code)

    expect(await code(sm.addSessionMembers('shared', 'bob', ['agent:a2']))).toBe('forbidden')
    expect(await code(sm.addSessionMembers('shared', 'stranger', ['agent:a2']))).toBe('not_found')
    expect(await code(sm.addSessionMembers('shared', 'alice', ['user:nobody']))).toBe('invalid')
    expect(await code(sm.removeSessionMember('shared', 'bob', 'user:alice'))).toBe('forbidden')
    expect(await code(sm.removeSessionMember('shared', 'alice', 'user:alice'))).toBe('invalid')
    expect(await code(sm.leaveSession('shared', 'alice'))).toBe('invalid')
    expect(await code(sm.deleteSession('shared', 'bob'))).toBe('forbidden')

    pushes.length = 0
    expect(await code(sm.leaveSession('shared', 'bob'))).toBe('ok')
    expect(sm.canSeeSession('shared', 'bob')).toBe(false)
    // bob loses the chat, alice hears it changed
    expect(pushes.filter((p) => p.channel === RPC_CHANNELS.sessions.EVENT).map((p) => [(p.payload[0] as { type: string }).type, p.target.userIds])).toEqual([
      ['session_deleted', ['bob']],
      ['session_created', ['alice']],
    ])

    expect(await code(sm.removeSessionMember('shared', 'alice', 'agent:a1'))).toBe('ok')
    expect(sm.getSessions('ws-1', 'alice').find((s) => s.id === 'shared')!.members).toEqual(['user:alice'])
  })
})

describe('where a chat event goes', () => {
  it('only to the connections of the member people', () => {
    const { sm, pushes } = setup()

    sm.notifySessionCreated('ws-1', 'shared')
    sm.notifySessionCreated('ws-1', 'legacy-chat')
    sm.notifySessionCreated('ws-1', 'gone')

    expect(pushes.map((p) => [p.channel, p.target])).toEqual([
      [RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-1', userIds: ['alice', 'bob'] }],
      [RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-1', userIds: [] }],
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
    expect(summaries()).toEqual({ alice: 2, bob: 2 })

    pushes.length = 0
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.delete('bob-chat')
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.delete('shared')
    emit()
    expect(summaries()).toEqual({ alice: 2, bob: 0 })
  })
})
